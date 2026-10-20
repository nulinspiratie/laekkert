"""The app's only outbound HTTP: a recipe page's main photo, or a photo by link.

Claude hands us links, so every fetch is guarded against reaching the NAS's own
network. Only http and https on ports 80 and 443 are allowed, with no
credentials in the link. The host must resolve only to global unicast
addresses, checked before the first request and again before every redirect,
which we follow by hand (at most three). Each request has a 10 s timeout and
the whole fetch a 15 s deadline. The body is streamed and the fetch stops as
soon as it passes the limit: 2 MiB for a page, MAX_UPLOAD_BYTES for a photo.
Proxy settings from the environment are ignored.

One gap remains: the HTTP client resolves the host again when it connects, so
a DNS server that answers with a public address for our check and a private
one a moment later (DNS rebinding) could still steer a request inward. We
accept that window: this is a private app behind Cloudflare Access, the fetch
is a GET for a photo or a page we only search for a photo link, and the body is
never shown as HTML. A photo body is kept only if its bytes are a real image.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx2

from app.recipes.uploads import MAX_UPLOAD_BYTES

MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
REQUEST_TIMEOUT = 10
FETCH_DEADLINE = 15
USER_AGENT = "Mozilla/5.0 (compatible; Laekkert/1.0)"

ALLOWED_PORTS = {80, 443}
DEFAULT_PORTS = {"http": 80, "https": 443}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# Meta keys, best first. `<link rel="image_src">` comes after all of them.
IMAGE_KEYS = ("og:image", "og:image:secure_url", "twitter:image")

Resolve = Callable[[str, int], Awaitable[list[str]]]


class FetchError(Exception):
    """A fetch was refused or failed; the message is one sentence for the user."""


async def _resolve(host: str, port: int) -> list[str]:
    """Every address the system resolver gives for host."""
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM
    )
    return [info[4][0] for info in infos]


# IPv6 prefixes whose last 32 bits are an IPv4 address: IPv4-compatible (::/96),
# NAT64 (64:ff9b::/96) and SIIT (::ffff:0:0:0/96). Python counts them as global.
_IPV4_IN_LAST_32 = [
    ipaddress.IPv6Network("::/96"),
    ipaddress.IPv6Network("64:ff9b::/96"),
    ipaddress.IPv6Network("::ffff:0:0:0/96"),
]


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for a global unicast address, looking inside IPv6 forms of IPv4."""
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = [ip.ipv4_mapped, ip.sixtofour, *(ip.teredo or ())]
        if any(ip in net for net in _IPV4_IN_LAST_32):
            embedded.append(ipaddress.IPv4Address(ip.packed[12:]))
        if any(inner is not None and not _is_public(inner) for inner in embedded):
            return False
    return ip.is_global and not ip.is_multicast


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _address_is_public(address: str) -> bool:
    try:
        return _is_public(ipaddress.ip_address(address))
    except ValueError:
        return False


class Fetcher:
    def __init__(
        self,
        transport: httpx2.AsyncBaseTransport | None = None,
        resolve: Resolve | None = None,
    ):
        self.transport = transport
        self.resolve = resolve or _resolve

    async def page_image_url(self, page_url: str) -> str | None:
        """The main photo link of a recipe page, or None if it names none."""
        body, final_url, charset = await self._fetch(
            page_url, MAX_PAGE_BYTES, "The page is too big to read"
        )
        try:
            text = body.decode(charset or "utf-8", errors="replace")
        except LookupError:
            text = body.decode("utf-8", errors="replace")
        return page_image(text, final_url)

    async def image(self, url: str) -> bytes:
        """The body at url, at most MAX_UPLOAD_BYTES long."""
        too_big = "That photo is over 20 MB"
        body, _, _ = await self._fetch(url, MAX_UPLOAD_BYTES, too_big)
        return body

    async def _fetch(
        self, url: str, limit: int, too_big: str
    ) -> tuple[bytes, str, str | None]:
        """GET url within the limits; returns body, final URL and charset."""
        try:
            async with asyncio.timeout(FETCH_DEADLINE):
                return await self._follow(url, limit, too_big)
        except TimeoutError:
            raise FetchError("The site took too long to answer") from None
        except httpx2.TimeoutException:
            raise FetchError("The site took too long to answer") from None
        except httpx2.HTTPError:
            raise FetchError("The site could not be reached") from None

    async def _follow(
        self, url: str, limit: int, too_big: str
    ) -> tuple[bytes, str, str | None]:
        async with httpx2.AsyncClient(
            transport=self.transport,
            trust_env=False,
            timeout=httpx2.Timeout(REQUEST_TIMEOUT),
            follow_redirects=False,
            headers={"user-agent": USER_AGENT, "accept-encoding": "identity"},
        ) as client:
            target = await self._checked(url)
            redirects = 0
            while True:
                async with client.stream("GET", target) as response:
                    status = response.status_code
                    location = response.headers.get("location")
                    if status in REDIRECT_STATUSES and location:
                        if redirects == MAX_REDIRECTS:
                            raise FetchError("The site redirected too many times")
                        redirects += 1
                        target = await self._checked(location, base=target)
                        continue
                    if status != 200:
                        raise FetchError(f"The site answered {status}")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body += chunk
                        if len(body) > limit:
                            raise FetchError(too_big)
                    return bytes(body), str(target), response.charset_encoding

    async def _checked(self, url: str, base: httpx2.URL | None = None) -> httpx2.URL:
        """url (joined to base) parsed, refusing all but a public http(s) address."""
        try:
            parsed = base.join(url) if base is not None else httpx2.URL(url)
        except (httpx2.InvalidURL, TypeError):
            raise FetchError("Only http and https links can be fetched") from None
        if parsed.scheme not in DEFAULT_PORTS:
            raise FetchError("Only http and https links can be fetched")
        port = parsed.port or DEFAULT_PORTS[parsed.scheme]
        if port not in ALLOWED_PORTS or parsed.userinfo:
            raise FetchError("Only http and https links can be fetched")
        host = parsed.raw_host.decode("ascii")
        if not host:
            raise FetchError("That address could not be found")
        # A literal IP is checked as it is; a name is checked by every address.
        addresses = [host] if _is_ip(host) else await self._lookup(host, port)
        if not all(_address_is_public(a) for a in addresses):
            raise FetchError("That link points to a private address")
        return parsed

    async def _lookup(self, host: str, port: int) -> list[str]:
        try:
            addresses = await self.resolve(host, port)
        except (OSError, UnicodeError):
            raise FetchError("That address could not be found") from None
        if not addresses:
            raise FetchError("That address could not be found")
        return addresses


class _ImageLinks(HTMLParser):
    """Collects the photo links a page offers, by kind, in document order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found: dict[str, list[str]] = {}

    def handle_starttag(self, tag, attrs):
        attrs = {name: (value or "").strip() for name, value in attrs}
        if tag == "meta":
            keys = {attrs.get("property", "").lower(), attrs.get("name", "").lower()}
            for key in keys & set(IMAGE_KEYS):
                if attrs.get("content"):
                    self.found.setdefault(key, []).append(attrs["content"])
        elif tag == "link":
            rels = attrs.get("rel", "").lower().split()
            if "image_src" in rels and attrs.get("href"):
                self.found.setdefault("image_src", []).append(attrs["href"])


def page_image(html: str, base_url: str) -> str | None:
    """The page's main photo as an absolute http(s) link, or None."""
    parser = _ImageLinks()
    parser.feed(html)
    parser.close()
    for key in (*IMAGE_KEYS, "image_src"):
        for link in parser.found.get(key, []):
            try:
                absolute = urljoin(base_url, link)
                parts = urlsplit(absolute)
            except ValueError:
                continue  # a malformed link, such as "http://[oops"
            if parts.scheme in DEFAULT_PORTS and parts.netloc:
                return absolute
    return None
