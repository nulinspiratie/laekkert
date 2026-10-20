"""Uploaded photos wait in <data_dir>/uploads/ until a recipe save moves them in.

Cancelling the editor therefore leaves every recipe untouched. A file is only
accepted when its content type is an image type we serve and its first bytes
agree with that type: an HTML or SVG file labelled `image/png` is refused.
"""

import contextlib
import re
import secrets
import time
from pathlib import Path

from app.recipes.files import atomic_write

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_AGE_SECONDS = 24 * 60 * 60

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/heic": ".heic",
    "image/heif": ".heic",
}

NAME_PATTERN = re.compile(r"^img-[0-9a-f]{16}\.(jpg|png|webp|gif|avif|heic)$")

_AVIF_BRANDS = {b"avif", b"avis"}
_HEIC_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"}


class UnsupportedImage(ValueError):
    """The content type is not an accepted image type, or the bytes don't match it."""


class ImageTooLarge(ValueError):
    """The body is over MAX_UPLOAD_BYTES."""


def _brands(body: bytes) -> set[bytes]:
    """The major and compatible brands of an ISO base media `ftyp` box."""
    if body[4:8] != b"ftyp":
        return set()
    size = int.from_bytes(body[:4], "big")
    box = body[8 : size if 16 <= size <= len(body) else 32]
    # major brand, 4 bytes of minor version, then compatible brands.
    return {box[:4], *(box[i : i + 4] for i in range(8, len(box) - 3, 4))}


def _extension(body: bytes) -> str | None:
    """The file extension the first bytes say this is, or None if unknown."""
    if body.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return ".webp"
    brands = _brands(body)
    if brands & _AVIF_BRANDS:
        return ".avif"
    if brands & _HEIC_BRANDS:
        return ".heic"
    return None


class UploadStore:
    def __init__(self, data_dir: Path):
        self.dir = Path(data_dir) / "uploads"

    def save(self, content_type: str, body: bytes) -> str:
        """Park an image and return its name.

        Raises UnsupportedImage or ImageTooLarge.
        """
        ext = IMAGE_TYPES.get(content_type.split(";")[0].strip().lower())
        if ext is None:
            raise UnsupportedImage("That file type isn't a supported photo")
        if len(body) > MAX_UPLOAD_BYTES:
            raise ImageTooLarge("That photo is over 20 MB")
        if _extension(body) != ext:
            raise UnsupportedImage("That file isn't the kind of photo it says it is")
        return self._park(ext, body)

    def save_detected(self, body: bytes) -> str:
        """Park an image whose type is read from its first bytes; return its name.

        For fetched photos, whose content type we don't trust. Raises
        UnsupportedImage or ImageTooLarge.
        """
        ext = _extension(body)
        if ext is None:
            raise UnsupportedImage("That link isn't a supported photo")
        if len(body) > MAX_UPLOAD_BYTES:
            raise ImageTooLarge("That photo is over 20 MB")
        return self._park(ext, body)

    def _park(self, ext: str, body: bytes) -> str:
        """Write a checked image under a fresh name and return the name."""
        self._remove_old()
        name = f"img-{secrets.token_hex(8)}{ext}"
        atomic_write(self.dir / name, body)
        return name

    def path(self, name: str) -> Path | None:
        """The parked file with this name, if the name is one we hand out."""
        if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
            return None
        path = self.dir / name
        return path if path.is_file() and not path.is_symlink() else None

    def _remove_old(self) -> None:
        """Delete parked files (and stray temp files) older than a day."""
        cutoff = time.time() - MAX_AGE_SECONDS
        try:
            children = list(self.dir.iterdir())
        except OSError:
            return
        for child in children:
            with contextlib.suppress(OSError):
                if child.is_file() and child.stat().st_mtime < cutoff:
                    child.unlink()
