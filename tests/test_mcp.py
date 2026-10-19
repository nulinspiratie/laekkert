import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app

HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
}


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(), data_dir=tmp_path)
    with TestClient(app, base_url="https://laekkert.serwan.me") as c:
        yield c


def rpc(client, id, method, params=None):
    body = {"jsonrpc": "2.0", "id": id, "method": method}
    if params is not None:
        body["params"] = params
    return client.post("/mcp", json=body, headers=HEADERS)


def call(client, name, arguments):
    params = {"name": name, "arguments": arguments}
    return rpc(client, 3, "tools/call", params).json()["result"]


def test_initialize_through_public_hostname(client):
    r = rpc(
        client,
        1,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "t", "version": "1"},
        },
    )
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["serverInfo"]["name"] == "laekkert"
    assert "never mixed" in result["instructions"]


def test_tools_listed(client):
    names = {t["name"] for t in rpc(client, 2, "tools/list").json()["result"]["tools"]}
    assert names == {"list_recipes", "read_recipe"}


def test_list_recipes_tool(client):
    res = call(client, "list_recipes", {"side": "drinks"})
    assert [r["slug"] for r in res["structuredContent"]["result"]] == [
        "daiquiri",
        "virgin-mojito",
    ]


def test_list_recipes_rejects_unknown_side(client):
    assert call(client, "list_recipes", {"side": "bar"})["isError"] is True


def test_read_recipe_tool(client):
    res = call(client, "read_recipe", {"side": "drinks", "slug": "daiquiri"})
    assert res["isError"] is False
    assert res["structuredContent"]["ingredients"][0]["item"] == "white rum"


@pytest.mark.parametrize("slug", ["nope", "../x", "../../food/red-lentil-dal"])
def test_read_unknown_recipe_is_tool_error(client, slug):
    res = call(client, "read_recipe", {"side": "drinks", "slug": slug})
    assert res["isError"] is True
    assert "No recipe" in res["content"][0]["text"]


def test_healthz_still_works_with_mcp_mounted(client):
    assert client.get("/healthz").json()["status"] == "ok"


def test_mcp_get_is_not_swallowed_by_spa(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<div id=root></div>")
    app = create_app(Settings(), data_dir=tmp_path / "data", static_dir=dist)
    with TestClient(app) as c:
        # A JSON-only GET is refused by the MCP transport, not served the SPA.
        # (Accepting event streams would open an SSE stream that never ends.)
        response = c.get("/mcp", headers={"Accept": "application/json"})
    assert response.status_code == 406
    assert response.json()["jsonrpc"] == "2.0"
