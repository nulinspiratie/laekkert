import logging
import os

import pytest
from pydantic import ValidationError

from app.recipes.files import atomic_write
from app.recipes.timeline import (
    Made,
    Note,
    Rating,
    append_entries,
    current_rating,
    last_made,
    new_entry,
    read_timeline,
)


def test_append_then_read_round_trips(tmp_path):
    note = new_entry(Note, "app", text="Less salt next time")
    rating = new_entry(Rating, "claude", rating=4.5, previous=4)
    append_entries(tmp_path, [note, rating])

    entries = read_timeline(tmp_path)

    assert [e.kind for e in entries] == ["note", "rating"]
    assert entries == [note, rating]
    assert entries[0].text == "Less salt next time"
    assert (entries[1].rating, entries[1].previous, entries[1].via) == (
        4.5,
        4,
        "claude",
    )
    assert entries[0].at.endswith("Z") and len(entries[0].at) == len(
        "2026-10-20T14:03:12Z"
    )
    assert len(entries[0].id) == 12


def test_append_keeps_earlier_entries_and_writes_one_line_each(tmp_path):
    append_entries(tmp_path, [new_entry(Note, "app", text="one")])
    append_entries(tmp_path, [new_entry(Note, "app", text="two")])

    lines = (tmp_path / "timeline.jsonl").read_text().splitlines()
    assert len(lines) == 2
    assert [e.text for e in read_timeline(tmp_path)] == ["one", "two"]


def test_missing_file_reads_as_empty(tmp_path):
    assert read_timeline(tmp_path) == []
    assert read_timeline(tmp_path / "nope") == []


def test_bad_lines_are_skipped(tmp_path, caplog):
    good_note = new_entry(Note, "app", text="fine").model_dump_json()
    good_made = new_entry(Made, "app", rating=None).model_dump_json()
    (tmp_path / "timeline.jsonl").write_text(
        "\n".join([good_note, "{not json", '{"kind": "party"}', good_made]) + "\n"
    )

    with caplog.at_level(logging.WARNING):
        entries = read_timeline(tmp_path)

    assert [e.kind for e in entries] == ["note", "made"]
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 2


def test_append_keeps_hand_edited_lines(tmp_path):
    path = tmp_path / "timeline.jsonl"
    path.write_text('{"kind": "party"}')  # no trailing newline
    append_entries(tmp_path, [new_entry(Note, "app", text="hi")])

    lines = path.read_text().splitlines()
    assert lines[0] == '{"kind": "party"}'
    assert len(lines) == 2


def test_current_rating_is_latest_rating_or_made(tmp_path):
    assert current_rating([]) is None
    entries = [
        new_entry(Rating, "app", rating=4, previous=None),
        new_entry(Made, "app", rating=4.5),
        new_entry(Made, "app", rating=None),
    ]
    assert current_rating(entries) == 4.5
    assert current_rating(entries[:1]) == 4
    assert current_rating([new_entry(Made, "app")]) is None


def test_last_made_is_latest_made():
    first = new_entry(Made, "app")
    second = new_entry(Made, "app")
    first.at, second.at = "2026-10-01T10:00:00Z", "2026-10-05T18:30:00Z"
    note = new_entry(Note, "app", text="x")

    assert last_made([first, second, note]) == "2026-10-05T18:30:00Z"
    assert last_made([note]) is None
    assert last_made([]) is None


@pytest.mark.parametrize("bad", [0, 5.5, 3.3, -1])
def test_rating_must_be_half_steps(bad):
    with pytest.raises(ValidationError):
        new_entry(Rating, "app", rating=bad, previous=None)
    with pytest.raises(ValidationError):
        new_entry(Made, "app", rating=bad)


@pytest.mark.parametrize("good", [0.5, 3.5, 5])
def test_half_step_ratings_pass(good):
    assert new_entry(Rating, "app", rating=good, previous=None).rating == good
    assert new_entry(Made, "app", rating=good).rating == good


def test_note_text_is_stripped_and_bounded():
    assert new_entry(Note, "app", text="  hi  ").text == "hi"
    for bad in ["", "   ", "x" * 2001]:
        with pytest.raises(ValidationError):
            new_entry(Note, "app", text=bad)
    assert new_entry(Made, "app").note == ""
    assert new_entry(Made, "app", note="  ").note == ""
    with pytest.raises(ValidationError):
        new_entry(Made, "app", note="x" * 2001)


def test_atomic_write_creates_parent_dirs(tmp_path):
    target = tmp_path / "a" / "b" / "file.txt"
    atomic_write(target, b"hello")
    assert target.read_bytes() == b"hello"
    assert [p.name for p in target.parent.iterdir()] == ["file.txt"]


def test_atomic_write_failure_leaves_original(tmp_path, monkeypatch):
    target = tmp_path / "timeline.jsonl"
    target.write_bytes(b"original\n")

    def boom(src, dst):
        raise OSError("disk on fire")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError, match="disk on fire"):
        atomic_write(target, b"new content\n")

    assert target.read_bytes() == b"original\n"
    assert [p.name for p in tmp_path.iterdir()] == ["timeline.jsonl"]
    assert not list(tmp_path.glob(".tmp-*"))
