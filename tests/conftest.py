"""Shared set-up for the MCP tests: an app with a mock network, and JSON-RPC helpers."""

import socket

import httpx2
import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.recipes.catalog import Catalog
from app.recipes.fetch import Fetcher
from app.recipes.store import RecipeStore
from app.recipes.uploads import UploadStore

HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
}

# What the fake resolver knows; every other name does not resolve.
ADDRESSES = {
    "example.com": ["93.184.216.34"],
    "evil.test": ["10.0.0.5"],
}


def fake_fetcher(routes):
    """A Fetcher that never touches the network.

    `routes` maps a URL to an httpx2.Response or a function from request to
    response; any other URL answers 404. It is read per request, so a test can
    add routes after the client is built.
    """

    def handler(request):
        route = routes.get(str(request.url))
        if route is None:
            return httpx2.Response(404)
        return route(request) if callable(route) else route

    async def resolve(host, port):
        if host not in ADDRESSES:
            raise socket.gaierror(socket.EAI_NONAME, "not known")
        return ADDRESSES[host]

    return Fetcher(transport=httpx2.MockTransport(handler), resolve=resolve)


@pytest.fixture
def routes():
    """The mock network's routes; a test fills it in."""
    return {}


@pytest.fixture
def client(tmp_path, routes):
    app = create_app(Settings(), data_dir=tmp_path, fetcher=fake_fetcher(routes))
    with TestClient(app, base_url="https://laekkert.serwan.me") as c:
        yield c


@pytest.fixture
def store(client, tmp_path):
    """A second store on the app's data folder, to set up state the tools read."""
    return RecipeStore(tmp_path, Catalog(tmp_path), UploadStore(tmp_path))


def rpc(client, id, method, params=None):
    body = {"jsonrpc": "2.0", "id": id, "method": method}
    if params is not None:
        body["params"] = params
    return client.post("/mcp", json=body, headers=HEADERS)


def call(client, name, arguments):
    params = {"name": name, "arguments": arguments}
    return rpc(client, 3, "tools/call", params).json()["result"]
