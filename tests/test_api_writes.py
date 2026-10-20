import asyncio
import json

import pytest
from starlette.testclient import TestClient

from app.api import MAX_JSON_BYTES
from app.config import Settings
from app.main import create_app
from app.recipes.store import VERSION_CONFLICT
from app.recipes.uploads import MAX_UPLOAD_BYTES

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
ERROR_503 = {"error": "could not save; nothing was changed"}

DRAFT = {
    "name": "Margarita",
    "category": "cocktails",
    "servings": 1,
    "time_minutes": 5,
    "ingredients": [
        {"amount": 50, "unit": "ml", "item": "tequila"},
        {"amount": 25, "unit": "ml", "item": "lime juice"},
    ],
    "steps": ["Shake."],
    "source": None,
    "tags": [],
    "image": None,
}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(), data_dir=tmp_path)) as c:
        yield c


def post_json(client, path, body, method="post"):
    return getattr(client, method)(
        path, content=json.dumps(body), headers={"Content-Type": "application/json"}
    )


def create(client, **over):
    response = post_json(client, "/api/recipes", {"side": "drinks", **DRAFT, **over})
    assert response.status_code == 201, response.text
    return response.json()


def snapshot(tmp_path):
    """Every file under the recipes folder, by path, with its bytes."""
    root = tmp_path / "recipes"
    return {str(p): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_create_then_detail(client):
    body = create(client)
    assert body["slug"] == "margarita" and body["side"] == "drinks"
    detail = client.get("/api/recipes/drinks/margarita")
    assert detail.status_code == 200
    assert detail.json()["slug"] == "margarita"
    assert detail.json()["rating"] is None and detail.json()["last_made"] is None


def test_create_converts_tsp(client):
    response = post_json(
        client,
        "/api/recipes",
        {
            **DRAFT,
            "side": "food",
            "name": "Rub",
            "category": "sauces",
            "ingredients": [
                {"amount": 2, "unit": "tsp", "item": "smoked paprika"},
                {"amount": 1, "unit": "tsp", "item": "mystery spice"},
            ],
        },
    )
    assert response.status_code == 201, response.text
    paprika, mystery = response.json()["ingredients"]
    assert (paprika["unit"], paprika["amount"]) == ("g", 4.6)
    assert (mystery["unit"], mystery["amount"]) == ("ml", 5)


def test_put_keeps_groups_and_notes(client):
    create(client)
    grouped = {
        **DRAFT,
        "ingredients": [
            {"amount": 50, "unit": "ml", "item": "tequila", "group": "Spirit"},
            {"amount": 25, "unit": "ml", "item": "lime juice"},
        ],
        "steps": [{"text": "Shake.", "group": "Make"}],
        "notes": "**Best** cold.",
    }
    response = post_json(client, "/api/recipes/drinks/margarita", grouped, "put")
    assert response.status_code == 200, response.text
    for body in (response.json(), client.get("/api/recipes/drinks/margarita").json()):
        assert body["ingredients"][0]["group"] == "Spirit"
        assert body["steps"] == [{"text": "Shake.", "group": "Make"}]
        assert body["notes"] == "**Best** cold."


def test_update_and_timeline_newest_first(client):
    create(client)
    changed = {**DRAFT, "steps": ["Shake hard.", "Strain."]}
    response = post_json(client, "/api/recipes/drinks/margarita", changed, "put")
    assert response.status_code == 200
    assert response.json()["steps"] == [
        {"text": "Shake hard.", "group": ""},
        {"text": "Strain.", "group": ""},
    ]
    body = client.get("/api/recipes/drinks/margarita/timeline").json()
    assert [e["kind"] for e in body["entries"]] == ["edit", "created"]
    assert body["entries"][0]["changes"]
    assert body["entries"][0]["restored_from"] is None
    assert body["current_version"] == 2


def test_put_with_stale_base_version_is_409(client, tmp_path):
    create(client)
    changed = {**DRAFT, "steps": ["Shake hard."]}
    ok = post_json(
        client, "/api/recipes/drinks/margarita", {**changed, "base_version": 1}, "put"
    )
    assert ok.status_code == 200 and ok.json()["version"] == 2
    before = snapshot(tmp_path)
    stale = post_json(
        client,
        "/api/recipes/drinks/margarita",
        {**DRAFT, "steps": ["Stir."], "base_version": 1},
        "put",
    )
    assert stale.status_code == 409
    assert stale.json() == {"error": VERSION_CONFLICT}
    assert snapshot(tmp_path) == before


@pytest.mark.parametrize("bad", ["x", True, 1.5, None])
def test_put_with_bad_base_version_is_400(client, bad):
    create(client)
    response = post_json(
        client, "/api/recipes/drinks/margarita", {**DRAFT, "base_version": bad}, "put"
    )
    assert response.status_code == 400
    assert response.json() == {"error": "The version must be a whole number"}


def test_put_without_base_version_saves(client):
    create(client)
    changed = {**DRAFT, "steps": ["Shake hard."]}
    response = post_json(client, "/api/recipes/drinks/margarita", changed, "put")
    assert response.status_code == 200
    assert response.json()["version"] == 2


def test_validation_error_is_400_sentence(client):
    response = post_json(
        client, "/api/recipes", {"side": "drinks", **DRAFT, "name": ""}
    )
    assert response.status_code == 400
    assert response.json() == {"error": "Give the recipe a name"}
    create(client)
    response = post_json(
        client, "/api/recipes/drinks/margarita", {**DRAFT, "name": " "}, "put"
    )
    assert response.status_code == 400
    assert response.json() == {"error": "Give the recipe a name"}


@pytest.mark.parametrize("side", [None, "bar", 3])
def test_create_needs_a_known_side(client, side):
    body = {**DRAFT, **({} if side is None else {"side": side})}
    response = post_json(client, "/api/recipes", body)
    assert response.status_code == 400
    assert response.json() == {"error": "Choose food or drinks"}


def test_unknown_recipe_is_404(client, tmp_path):
    before = snapshot(tmp_path)
    base = "/api/recipes/drinks/nope"
    calls = [
        post_json(client, base, DRAFT, "put"),
        client.delete(base),
        post_json(client, f"{base}/restore", {"version": 1}),
        post_json(client, f"{base}/marks", {"add": ["tried"]}),
        post_json(client, f"{base}/timeline", {"kind": "note", "text": "hi"}),
        client.get(f"{base}/timeline"),
    ]
    for response in calls:
        assert response.status_code == 404, response.request.url
        assert response.json() == {"error": "not found"}
    assert snapshot(tmp_path) == before


def test_restore(client):
    create(client)
    post_json(client, "/api/recipes/drinks/margarita", {**DRAFT, "steps": ["x"]}, "put")
    response = post_json(
        client, "/api/recipes/drinks/margarita/restore", {"version": 1}
    )
    assert response.status_code == 200
    assert response.json()["steps"] == [{"text": "Shake.", "group": ""}]
    entries = client.get("/api/recipes/drinks/margarita/timeline").json()["entries"]
    assert entries[0]["restored_from"] == 1
    missing = post_json(client, "/api/recipes/drinks/margarita/restore", {"version": 9})
    assert missing.status_code == 404


@pytest.mark.parametrize("body", [{}, {"version": "1"}, {"version": True}, [1]])
def test_restore_needs_an_integer_version(client, body):
    create(client)
    response = post_json(client, "/api/recipes/drinks/margarita/restore", body)
    assert response.status_code == 400
    assert response.json()["error"]


def test_marks_route_applies_rules(client):
    create(client)
    url = "/api/recipes/drinks/margarita/marks"
    response = post_json(client, url, {"add": ["favourite"]})
    assert response.status_code == 200
    assert response.json()["marks"] == ["favourite", "tried"]
    response = post_json(client, url, {"remove": ["tried"]})
    assert response.json()["marks"] == []
    response = post_json(client, url, {"add": ["favourite"], "remove": ["tried"]})
    assert response.status_code == 400
    assert response.json() == {"error": "A favourite has to be tried"}


@pytest.mark.parametrize(
    "body",
    [
        {"add": "tried"},
        {"add": ["kid_approved"]},
        {"remove": [1]},
        {"add": [["tried"]]},
        ["tried"],
    ],
)
def test_marks_body_is_checked(client, body):
    create(client)
    response = post_json(client, "/api/recipes/drinks/margarita/marks", body)
    assert response.status_code == 400
    assert response.json()["error"]


def test_rating_appears_in_list_and_detail(client):
    create(client)
    url = "/api/recipes/drinks/margarita/timeline"
    response = post_json(client, url, {"kind": "rating", "rating": 4.5})
    assert response.status_code == 201
    assert response.json()["entry"]["kind"] == "rating"
    assert response.json()["recipe"]["rating"] == 4.5
    assert response.json()["recipe"]["marks"] == ["tried"]
    listed = client.get("/api/recipes?side=drinks").json()["recipes"]
    assert {r["slug"]: r["rating"] for r in listed}["margarita"] == 4.5
    assert {r["slug"]: r["rating"] for r in listed}["daiquiri"] is None
    assert client.get("/api/recipes/drinks/margarita").json()["rating"] == 4.5


def test_last_made_in_list(client):
    create(client)
    url = "/api/recipes/drinks/margarita/timeline"
    response = post_json(client, url, {"kind": "made", "rating": 3, "note": " nice "})
    assert response.status_code == 201
    entry = response.json()["entry"]
    assert entry["kind"] == "made" and entry["note"] == "nice"
    listed = client.get("/api/recipes?side=drinks").json()["recipes"]
    by_slug = {r["slug"]: r for r in listed}
    assert by_slug["margarita"]["last_made"] == entry["at"]
    assert by_slug["margarita"]["rating"] == 3
    assert by_slug["daiquiri"]["last_made"] is None
    # A made entry with no rating or note is fine.
    assert post_json(client, url, {"kind": "made"}).status_code == 201


def test_note_entry(client):
    create(client)
    url = "/api/recipes/drinks/margarita/timeline"
    response = post_json(client, url, {"kind": "note", "text": "Less sweet next time"})
    assert response.status_code == 201
    assert response.json()["entry"]["text"] == "Less sweet next time"
    assert response.json()["recipe"]["slug"] == "margarita"
    entries = client.get(url).json()["entries"]
    assert entries[0]["kind"] == "note"


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "shrug"},
        {},
        {"kind": "note"},
        {"kind": "note", "text": 3},
        {"kind": "note", "text": "  "},
        {"kind": "rating"},
        {"kind": "rating", "rating": "5"},
        {"kind": "rating", "rating": True},
        {"kind": "rating", "rating": None},
        {"kind": "rating", "rating": 4.2},
        {"kind": "rating", "rating": 6},
        {"kind": "made", "rating": "4"},
        {"kind": "made", "rating": False},
        {"kind": "made", "note": 4},
        {"kind": "made", "note": None},
        [1],
    ],
)
def test_timeline_body_is_checked(client, tmp_path, body):
    create(client)
    before = snapshot(tmp_path)
    response = post_json(client, "/api/recipes/drinks/margarita/timeline", body)
    assert response.status_code == 400
    assert set(response.json()) == {"error"}
    assert "pydantic" not in response.json()["error"]
    assert snapshot(tmp_path) == before


def test_delete_then_404(client, tmp_path):
    create(client)
    response = client.delete("/api/recipes/drinks/margarita")
    assert response.status_code == 204 and response.content == b""
    assert client.get("/api/recipes/drinks/margarita").status_code == 404
    assert client.delete("/api/recipes/drinks/margarita").status_code == 404
    assert any((tmp_path / "trash/drinks").iterdir())


def upload(client, body=PNG, content_type="image/png"):
    return client.post(
        "/api/uploads", content=body, headers={"Content-Type": content_type}
    )


def test_upload_then_use_in_update(client):
    create(client)
    response = upload(client)
    assert response.status_code == 201
    name = response.json()["name"]
    assert name.endswith(".png")
    response = post_json(
        client, "/api/recipes/drinks/margarita", {**DRAFT, "image": name}, "put"
    )
    assert response.status_code == 200 and response.json()["image"] == name
    served = client.get(f"/api/recipes/drinks/margarita/files/{name}")
    assert served.status_code == 200 and served.content == PNG


def test_upload_media_type_ignores_case_and_parameters(client):
    assert upload(client, content_type="Image/PNG; charset=binary").status_code == 201


def test_upload_rejects_non_images(client):
    response = upload(client, b"<html></html>", "text/html")
    assert response.status_code == 415
    assert response.json()["error"]
    response = upload(client, b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert response.status_code == 415
    assert response.json()["error"]
    assert upload(client, b"", "image/png").status_code == 415


def test_upload_rejects_oversize(client, tmp_path):
    big = PNG + b"\x00" * MAX_UPLOAD_BYTES
    response = upload(client, big)
    assert response.status_code == 413
    assert response.json()["error"]
    assert not list((tmp_path / "uploads").glob("*"))


def test_upload_oversize_without_content_length_stops_at_the_cap(client, tmp_path):
    chunk = b"\x00" * (1024 * 1024)

    def body():
        yield PNG
        for _ in range(MAX_UPLOAD_BYTES // len(chunk) + 1):
            yield chunk

    # An iterator body is sent chunked, with no Content-Length header.
    response = client.post(
        "/api/uploads", content=body(), headers={"Content-Type": "image/png"}
    )
    assert response.status_code == 413
    assert not list((tmp_path / "uploads").glob("*"))


WRITES = [
    ("post", "/api/recipes"),
    ("put", "/api/recipes/drinks/daiquiri"),
    ("post", "/api/recipes/drinks/daiquiri/restore"),
    ("post", "/api/recipes/drinks/daiquiri/marks"),
    ("post", "/api/recipes/drinks/daiquiri/timeline"),
]


@pytest.mark.parametrize(
    "content_type",
    [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "application/jsonp",
    ],
)
def test_write_routes_reject_simple_content_types(client, tmp_path, content_type):
    before = snapshot(tmp_path)
    body = json.dumps({"side": "drinks", **DRAFT, "version": 1, "kind": "note"})
    for method, path in WRITES:
        response = getattr(client, method)(
            path, content=body, headers={"Content-Type": content_type}
        )
        assert response.status_code == 415, (method, path)
        assert "error" in response.json()
    no_type = client.post("/api/recipes", content=body, headers={"Content-Type": ""})
    assert no_type.status_code == 415
    assert snapshot(tmp_path) == before
    assert not (tmp_path / "recipes/drinks/margarita").exists()


def test_json_content_type_may_have_parameters_and_any_case(client):
    response = client.post(
        "/api/recipes",
        content=json.dumps({"side": "drinks", **DRAFT}),
        headers={"Content-Type": "Application/JSON; charset=utf-8"},
    )
    assert response.status_code == 201


@pytest.mark.parametrize("content", [b"{nope", b"", b"\xff\xfe", b"NaN"])
def test_bad_json_is_400(client, tmp_path, content):
    before = snapshot(tmp_path)
    for method, path in WRITES:
        response = getattr(client, method)(
            path, content=content, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 400, (method, path)
        assert response.json()["error"]
    assert snapshot(tmp_path) == before


def test_write_failure_is_503(client, tmp_path, monkeypatch):
    create(client)
    before = snapshot(tmp_path)

    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("app.recipes.store.atomic_write", fail)
    base = "/api/recipes/drinks/margarita"
    calls = [
        post_json(client, "/api/recipes", {"side": "drinks", **DRAFT, "name": "Other"}),
        post_json(client, base, {**DRAFT, "steps": ["x"]}, "put"),
        post_json(client, f"{base}/marks", {"add": ["tried"]}),
        post_json(client, f"{base}/timeline", {"kind": "rating", "rating": 4}),
    ]
    for response in calls:
        assert response.status_code == 503
        assert response.json() == ERROR_503
    assert snapshot(tmp_path) == before


def test_incomplete_save_is_503_with_its_own_sentence(client, monkeypatch):
    from app.recipes.store import SaveIncomplete

    create(client)

    def partly(*args, **kwargs):
        raise SaveIncomplete("could not restore recipe.json")

    monkeypatch.setattr("app.recipes.store.RecipeStore.update", partly)
    response = post_json(
        client, "/api/recipes/drinks/margarita", {**DRAFT, "steps": ["x"]}, "put"
    )
    assert response.status_code == 503
    assert response.json() == {
        "error": "could not save, and the recipe may be partly changed; "
        "check its history"
    }


def test_upload_write_failure_is_503(client, monkeypatch):
    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("app.recipes.uploads.atomic_write", fail)
    response = upload(client)
    assert response.status_code == 503
    assert response.json() == ERROR_503


def test_write_routes_send_no_cors_headers(client):
    response = client.options(
        "/api/recipes", headers={"Origin": "https://evil.example"}
    )
    assert not any(k.lower().startswith("access-control-") for k in response.headers)
    response = upload(client)
    assert not any(k.lower().startswith("access-control-") for k in response.headers)


TOO_MUCH = {"error": "That's too much to save at once"}
NOT_JSON = {"error": "That isn't valid JSON"}
BAD_RATING = {"error": "Ratings go from 0.5 to 5 in half stars"}


def raw_post(client, path, content, method="post"):
    return getattr(client, method)(
        path, content=content, headers={"Content-Type": "application/json"}
    )


@pytest.mark.parametrize("content", [b"[" * 200000, b'{"a":' * 200000])
def test_deeply_nested_json_is_400(client, tmp_path, content):
    before = snapshot(tmp_path)
    for method, path in WRITES:
        response = raw_post(client, path, content, method)
        assert response.status_code == 400, (method, path)
        assert response.json() == NOT_JSON
    assert snapshot(tmp_path) == before


@pytest.mark.parametrize("kind", ["rating", "made"])
@pytest.mark.parametrize("value", ["1" + "0" * 400, "-1" + "0" * 400, "1e999", "0"])
def test_absurd_ratings_are_400(client, tmp_path, kind, value):
    create(client)
    before = snapshot(tmp_path)
    content = f'{{"kind": "{kind}", "rating": {value}}}'
    response = raw_post(client, "/api/recipes/drinks/margarita/timeline", content)
    assert response.status_code == 400
    assert response.json() == BAD_RATING
    assert snapshot(tmp_path) == before


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"servings": 10**400}, "Servings can be at most 1000"),
        ({"time_minutes": 10**400}, "Cooking time can be at most a week"),
        (
            {"ingredients": [{"amount": 1e308, "unit": "tbsp", "item": "salt"}]},
            "Ingredient 1's amount is too large",
        ),
    ],
)
def test_absurd_draft_numbers_are_400(client, tmp_path, over, message):
    before = snapshot(tmp_path)
    response = post_json(client, "/api/recipes", {"side": "drinks", **DRAFT, **over})
    assert response.status_code == 400
    assert response.json() == {"error": message}
    assert snapshot(tmp_path) == before


def test_unexpected_error_is_json_500(client, monkeypatch):
    create(client)

    def boom(*args, **kwargs):
        raise RuntimeError("bug")

    monkeypatch.setattr("app.recipes.store.RecipeStore.set_marks", boom)
    response = post_json(client, "/api/recipes/drinks/margarita/marks", {"add": []})
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"error": "something went wrong; nothing was changed"}


def test_odd_content_length_is_ignored(tmp_path):
    # b"\xb2" decodes to a superscript two: str.isdigit() is true, int() fails.
    app = create_app(Settings(), data_dir=tmp_path)
    sent = []

    async def call():
        events = [{"type": "http.request", "body": PNG, "more_body": False}]

        async def receive():
            return events.pop(0)

        async def send(message):
            sent.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "path": "/api/uploads",
            "raw_path": b"/api/uploads",
            "query_string": b"",
            "root_path": "",
            "scheme": "http",
            "server": ("test", 80),
            "headers": [
                (b"content-type", b"image/png"),
                (b"content-length", b"\xb2"),
            ],
        }
        await app.router(scope, receive, send)

    asyncio.run(call())
    assert sent[0]["status"] == 201


@pytest.mark.parametrize(("method", "path"), WRITES)
def test_json_body_over_the_cap_is_413_by_declared_length(
    client, tmp_path, method, path
):
    before = snapshot(tmp_path)
    body = b'{"pad": "' + b"x" * MAX_JSON_BYTES + b'"}'
    response = raw_post(client, path, body, method)
    assert response.status_code == 413
    assert response.json() == TOO_MUCH
    assert snapshot(tmp_path) == before


@pytest.mark.parametrize(("method", "path"), WRITES)
def test_json_body_over_the_cap_is_413_when_chunked(client, tmp_path, method, path):
    before = snapshot(tmp_path)
    chunk = b"x" * 65536

    def body():
        yield b'{"pad": "'
        for _ in range(MAX_JSON_BYTES // len(chunk) + 1):
            yield chunk
        yield b'"}'

    # An iterator body is sent chunked, with no Content-Length header.
    response = raw_post(client, path, body(), method)
    assert response.status_code == 413
    assert response.json() == TOO_MUCH
    assert snapshot(tmp_path) == before


def test_json_body_just_under_the_cap_is_still_read(client):
    steps = ["x" * (MAX_JSON_BYTES - 2000)]
    response = post_json(
        client, "/api/recipes", {"side": "drinks", **DRAFT, "steps": steps}
    )
    assert response.status_code == 201
