import asyncio
import socket

import httpx2
import pytest

from app.recipes import fetch
from app.recipes.fetch import Fetcher, FetchError, page_image

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
ADDRESSES = {
    "example.com": ["93.184.216.34"],
    "cdn.example.com": ["93.184.216.35"],
    "evil.test": ["10.0.0.5"],
}


def fake_resolve(table=None):
    table = ADDRESSES if table is None else table

    async def resolve(host, port):
        if host not in table:
            raise socket.gaierror(socket.EAI_NONAME, "not known")
        return table[host]

    return resolve


def fetcher(routes, table=None, calls=None):
    """A Fetcher whose transport serves `routes` (URL -> Response or callable)."""
    calls = [] if calls is None else calls

    def handler(request):
        calls.append(request)
        route = routes.get(str(request.url))
        if route is None:
            return httpx2.Response(404)
        return route(request) if callable(route) else route

    return Fetcher(transport=httpx2.MockTransport(handler), resolve=fake_resolve(table))


def run(coro):
    return asyncio.run(coro)


def html(head):
    return httpx2.Response(
        200,
        headers={"content-type": "text/html; charset=utf-8"},
        text=f"<html><head>{head}</head><body></body></html>",
    )


# page_image


def test_page_image_reads_og_image():
    page = """<meta name="twitter:image" content="https://example.com/t.jpg">
    <meta property="og:image" content="https://example.com/og.jpg">"""
    assert page_image(page, "https://example.com/r") == "https://example.com/og.jpg"


def test_page_image_falls_back_to_twitter_and_link():
    twitter = '<meta name="twitter:image" content="https://example.com/t.jpg">'
    link = '<link rel="image_src" href="https://example.com/l.jpg">'
    assert (
        page_image(link + twitter, "https://example.com/r")
        == "https://example.com/t.jpg"
    )
    assert page_image(link, "https://example.com/r") == "https://example.com/l.jpg"
    secure = '<meta property="og:image:secure_url" content="https://example.com/s.jpg">'
    assert (
        page_image(twitter + secure, "https://example.com/r")
        == "https://example.com/s.jpg"
    )


def test_page_image_resolves_relative():
    protocol_relative = '<meta property="og:image" content="//cdn.example.com/a.jpg">'
    assert (
        page_image(protocol_relative, "https://example.com/r/1")
        == "https://cdn.example.com/a.jpg"
    )
    escaped = '<meta property="og:image" content="/img/a.jpg?w=1&amp;h=2">'
    assert (
        page_image(escaped, "https://example.com/r/1")
        == "https://example.com/img/a.jpg?w=1&h=2"
    )


def test_page_image_none_when_missing():
    page = "<html><head><title>Dal</title></head></html>"
    assert page_image(page, "https://example.com/") is None
    assert page_image("", "https://example.com/") is None
    assert page_image("<p>no photo</p>", "https://example.com/") is None


def test_page_image_reads_meta_with_both_attributes():
    page = '<meta name="og:image" property="other" content="https://example.com/a.jpg">'
    assert page_image(page, "https://example.com/") == "https://example.com/a.jpg"


def test_page_image_skips_non_http_results():
    page = """<meta property="og:image" content="data:image/png;base64,AAAA">
    <meta property="og:image" content="javascript:alert(1)">
    <meta name="twitter:image" content="https://example.com/t.jpg">"""
    assert page_image(page, "https://example.com/") == "https://example.com/t.jpg"
    only_bad = '<meta property="og:image" content="file:///etc/passwd">'
    assert page_image(only_bad, "https://example.com/") is None


# URL checks


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://example.com/a.jpg", "gopher://example.com/"]
)
def test_refuses_non_http_scheme(url):
    calls = []
    with pytest.raises(FetchError, match="^Only http and https links can be fetched$"):
        run(fetcher({}, calls=calls).image(url))
    assert calls == []


def test_refuses_odd_port():
    calls = []
    with pytest.raises(FetchError):
        run(fetcher({}, calls=calls).image("https://example.com:8080/"))
    assert calls == []


def test_allows_standard_ports():
    routes = {
        "https://example.com:443/a.png": httpx2.Response(200, content=PNG),
        "https://example.com/a.png": httpx2.Response(200, content=PNG),
        "http://example.com:80/a.png": httpx2.Response(200, content=PNG),
        "http://example.com/a.png": httpx2.Response(200, content=PNG),
    }
    f = fetcher(routes)
    assert run(f.image("https://example.com:443/a.png")) == PNG
    assert run(f.image("http://example.com:80/a.png")) == PNG


def test_refuses_credentials_in_url():
    calls = []
    with pytest.raises(FetchError):
        run(fetcher({}, calls=calls).image("https://user:pw@example.com/a.png"))
    with pytest.raises(FetchError):
        run(fetcher({}, calls=calls).image("https://user@example.com/a.png"))
    assert calls == []


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "169.254.169.254",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "224.0.0.1",
    ],
)
def test_refuses_private_hosts(address):
    calls = []
    f = fetcher({}, table={"private.test": [address]}, calls=calls)
    with pytest.raises(FetchError, match="^That link points to a private address$"):
        run(f.image("http://private.test/a.png"))
    assert calls == []


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://[::1]/"])
def test_refuses_private_literal_ips(url):
    calls = []

    async def resolve(host, port):
        raise AssertionError("literal IPs are not resolved")

    f = Fetcher(
        transport=httpx2.MockTransport(lambda r: calls.append(r)), resolve=resolve
    )
    with pytest.raises(FetchError, match="^That link points to a private address$"):
        run(f.image(url))
    assert calls == []


def test_refuses_when_any_address_is_private():
    calls = []
    f = fetcher({}, table={"mixed.test": ["93.184.216.34", "127.0.0.1"]}, calls=calls)
    with pytest.raises(FetchError, match="^That link points to a private address$"):
        run(f.image("https://mixed.test/a.png"))
    assert calls == []


def test_unknown_host_sentence():
    with pytest.raises(FetchError, match="^That address could not be found$"):
        run(fetcher({}).image("https://nowhere.test/a.png"))


def test_client_ignores_environment_and_redirects(monkeypatch):
    seen = {}
    real = httpx2.AsyncClient

    def spy(**kwargs):
        seen.update(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(fetch.httpx2, "AsyncClient", spy)
    f = fetcher({"https://example.com/a.png": httpx2.Response(200, content=PNG)})
    assert run(f.image("https://example.com/a.png")) == PNG
    assert seen["trust_env"] is False
    assert seen["follow_redirects"] is False
    assert seen["timeout"] == httpx2.Timeout(10)


def test_sends_user_agent():
    calls = []
    f = fetcher(
        {"https://example.com/a.png": httpx2.Response(200, content=PNG)}, calls=calls
    )
    run(f.image("https://example.com/a.png"))
    assert calls[0].headers["user-agent"] == "Mozilla/5.0 (compatible; Laekkert/1.0)"


# Redirects


def redirect(location, status=302):
    return httpx2.Response(status, headers={"location": location})


def test_redirect_to_private_refused():
    calls = []
    routes = {
        "https://example.com/a.png": redirect("http://evil.test/"),
        "http://evil.test/": httpx2.Response(200, content=PNG),
    }
    with pytest.raises(FetchError, match="^That link points to a private address$"):
        run(fetcher(routes, calls=calls).image("https://example.com/a.png"))
    assert [str(c.url) for c in calls] == ["https://example.com/a.png"]


def test_bad_redirect_location_refused():
    routes = {"https://example.com/a.png": redirect("https://[::1/")}
    with pytest.raises(FetchError, match="^The site could not be reached$"):
        run(fetcher(routes).image("https://example.com/a.png"))


def test_redirect_to_file_refused():
    routes = {"https://example.com/a.png": redirect("file:///etc/passwd")}
    with pytest.raises(FetchError, match="^Only http and https links can be fetched$"):
        run(fetcher(routes).image("https://example.com/a.png"))


def test_relative_redirect_followed():
    routes = {
        "https://example.com/dal": redirect("/r/1", status=301),
        "https://example.com/r/1": html('<meta property="og:image" content="a.jpg">'),
    }
    found = run(fetcher(routes).page_image_url("https://example.com/dal"))
    assert found == "https://example.com/r/a.jpg"


def test_three_redirects_allowed():
    routes = {f"https://example.com/{i}": redirect(f"/{i + 1}") for i in range(3)}
    routes["https://example.com/3"] = httpx2.Response(200, content=PNG)
    assert run(fetcher(routes).image("https://example.com/0")) == PNG


def test_too_many_redirects():
    routes = {f"https://example.com/{i}": redirect(f"/{i + 1}") for i in range(4)}
    routes["https://example.com/4"] = httpx2.Response(200, content=PNG)
    with pytest.raises(FetchError, match="^The site redirected too many times$"):
        run(fetcher(routes).image("https://example.com/0"))


# Errors and limits


def test_status_error_sentence():
    with pytest.raises(FetchError, match="^The site answered 404$"):
        run(fetcher({}).image("https://example.com/missing.png"))


def test_timeout_sentence():
    def slow(request):
        raise httpx2.ReadTimeout("slow", request=request)

    f = fetcher({"https://example.com/a.png": slow})
    with pytest.raises(FetchError, match="^The site took too long to answer$"):
        run(f.image("https://example.com/a.png"))


def test_unreachable_sentence():
    def down(request):
        raise httpx2.ConnectError("refused", request=request)

    f = fetcher({"https://example.com/a.png": down})
    with pytest.raises(FetchError, match="^The site could not be reached$"):
        run(f.image("https://example.com/a.png"))


def test_image_returns_body():
    f = fetcher({"https://example.com/a.png": httpx2.Response(200, content=PNG)})
    assert run(f.image("https://example.com/a.png")) == PNG


def test_image_too_big_stops_early():
    chunk = 64 * 1024
    total = 21 * 1024 * 1024
    sent = []

    async def body():
        for _ in range(total // chunk):
            sent.append(chunk)
            yield b"\x00" * chunk

    f = fetcher({"https://example.com/big.png": httpx2.Response(200, content=body())})
    with pytest.raises(FetchError, match="^That photo is over 20 MB$"):
        run(f.image("https://example.com/big.png"))
    assert sum(sent) < total


def test_page_too_big():
    big = "<html><head>" + " " * (2 * 1024 * 1024) + "</head></html>"
    f = fetcher({"https://example.com/dal": httpx2.Response(200, text=big)})
    with pytest.raises(FetchError, match="^The page is too big to read$"):
        run(f.page_image_url("https://example.com/dal"))


def test_page_image_url_reads_page():
    routes = {
        "https://example.com/dal": html('<meta property="og:image" content="/dal.jpg">')
    }
    found = run(fetcher(routes).page_image_url("https://example.com/dal"))
    assert found == "https://example.com/dal.jpg"


def test_page_image_url_none_without_photo():
    routes = {"https://example.com/dal": html("<title>Dal</title>")}
    assert run(fetcher(routes).page_image_url("https://example.com/dal")) is None
