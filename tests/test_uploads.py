import os
import time

import pytest

from app.recipes import uploads
from app.recipes.uploads import (
    IMAGE_TYPES,
    ImageTooLarge,
    UnsupportedImage,
    UploadStore,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
GIF = b"GIF89a" + b"\x00" * 16
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 8
AVIF = b"\x00\x00\x00\x18ftypavif\x00\x00\x00\x00avifmif1"
HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"


@pytest.fixture
def store(tmp_path):
    return UploadStore(tmp_path)


def test_save_png_returns_name_and_file(store, tmp_path):
    name = store.save("image/png", PNG)
    assert name.startswith("img-") and name.endswith(".png")
    assert (tmp_path / "uploads" / name).read_bytes() == PNG
    assert store.path(name) == tmp_path / "uploads" / name


@pytest.mark.parametrize(
    ("content_type", "body", "ext"),
    [
        ("image/jpeg", JPEG, ".jpg"),
        ("image/gif", GIF, ".gif"),
        ("image/webp", WEBP, ".webp"),
        ("image/avif", AVIF, ".avif"),
        ("image/heic", HEIC, ".heic"),
        ("image/heif", HEIC, ".heic"),
        ("IMAGE/PNG; charset=binary", PNG, ".png"),
    ],
)
def test_save_accepts_every_listed_type(store, content_type, body, ext):
    assert store.save(content_type, body).endswith(ext)


def test_image_types_match_the_brief():
    assert set(IMAGE_TYPES.values()) == {
        ".jpg",
        ".png",
        ".webp",
        ".gif",
        ".avif",
        ".heic",
    }


def test_rejects_html_labelled_png(store):
    with pytest.raises(UnsupportedImage):
        store.save("image/png", b"<html><script>alert(1)</script></html>")
    assert not store.dir.exists() or not list(store.dir.iterdir())


def test_rejects_png_bytes_labelled_jpeg(store):
    with pytest.raises(UnsupportedImage):
        store.save("image/jpeg", PNG)


@pytest.mark.parametrize(
    "content_type", ["image/svg+xml", "text/html", "", "image/x-icon"]
)
def test_rejects_svg_type(store, content_type):
    with pytest.raises(UnsupportedImage):
        store.save(content_type, b"<svg xmlns='http://www.w3.org/2000/svg'/>")


def test_rejects_oversize(store, monkeypatch):
    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 100)
    with pytest.raises(ImageTooLarge):
        store.save("image/png", PNG + b"\x00" * 100)
    assert store.save("image/png", PNG)  # at the limit is fine


def test_limit_is_20_mib():
    assert uploads.MAX_UPLOAD_BYTES == 20 * 1024 * 1024


def test_old_uploads_are_removed(store):
    old = store.save("image/png", PNG)
    fresh = store.save("image/png", PNG)
    stale = time.time() - 25 * 3600
    os.utime(store.dir / old, (stale, stale))
    store.save("image/png", PNG)
    assert store.path(old) is None
    assert store.path(fresh) is not None


@pytest.mark.parametrize(
    "name",
    [
        "../x.jpg",
        "recipe.json",
        "img-zz.jpg",
        "img-0123456789abcdef.svg",
        "img-0123456789abcdef.jpg",  # well formed, but nothing parked under it
        "img-0123456789ABCDEF.jpg",
        "x/img-0123456789abcdef.jpg",
    ],
)
def test_path_refuses_other_names(store, name):
    assert store.path(name) is None


def test_save_detected_png(store, tmp_path):
    name = store.save_detected(PNG)
    assert name.startswith("img-") and name.endswith(".png")
    assert (tmp_path / "uploads" / name).read_bytes() == PNG
    assert store.save_detected(JPEG).endswith(".jpg")
    assert store.save_detected(HEIC).endswith(".heic")


@pytest.mark.parametrize(
    "body",
    [
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        b"<?xml version='1.0'?><svg/>",
        b"<!doctype html><html><script>alert(1)</script></html>",
        b"",
    ],
)
def test_save_detected_refuses_svg_and_html(store, body):
    with pytest.raises(UnsupportedImage, match="^That link isn't a supported photo$"):
        store.save_detected(body)
    assert not store.dir.exists() or not list(store.dir.iterdir())


def test_save_detected_too_big(store, monkeypatch):
    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 100)
    with pytest.raises(ImageTooLarge, match="^That photo is over 20 MB$"):
        store.save_detected(PNG + b"\x00" * 100)
    assert store.save_detected(PNG)  # at the limit is fine
