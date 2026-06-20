import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import backend.main as main
from backend.kernel.build_loop import BuildLoop
from tests.conftest import (
    GOOD_LOGIC,
    FakeClinicData,
    FakeStore,
    make_capability,
)
from tests.test_build_loop import StubSynth, _build_loop


@pytest.fixture
def app_client():
    """TestClient with fakes wired onto app.state, bypassing the real lifespan."""
    store = FakeStore()
    clinic = FakeClinicData()
    build_loop = _build_loop(store, clinic)

    main.app.state.store = store
    main.app.state.clinic_data = clinic
    main.app.state.build_loop = build_loop
    main.app.state.build_tasks = set()

    # TestClient triggers lifespan; we don't want the real connect(). Disable it.
    with TestClient(main.app, raise_server_exceptions=True) as client:
        yield client, store, clinic, build_loop


@pytest.fixture(autouse=True)
def _no_real_lifespan(monkeypatch):
    """Replace the lifespan so TestClient startup doesn't hit Redis/Postgres.

    We pre-populate app.state in app_client; here we just make startup/shutdown
    no-ops by patching the connect/close paths used inside lifespan.
    """
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_lifespan(app):
        yield

    monkeypatch.setattr(main.app.router, "lifespan_context", fake_lifespan)


def test_health_reports_down_when_no_connections(app_client):
    client, store, clinic, _ = app_client
    # FakeStore/FakeClinicData lack _redis/_pool -> health degrades gracefully.
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["redis"] is False
    assert body["postgres"] is False


def test_intent_returns_pregenerated_id_and_stream_url(app_client):
    client, *_ = app_client
    resp = client.post("/intent", json={"text": "count patients", "measurement_year": 2023})
    assert resp.status_code == 200
    body = resp.json()
    assert body["capability_id"]
    assert body["stream_url"] == f"/events/{body['capability_id']}"


def test_capabilities_list_and_get(app_client):
    client, store, *_ = app_client
    cap = make_capability(cap_id="listed-1")
    asyncio.run(store.save(cap, [0.0] * 1536))

    resp = client.get("/capabilities")
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()]
    assert "listed-1" in ids

    resp = client.get("/capabilities/listed-1")
    assert resp.status_code == 200
    assert resp.json()["manifest"]["id"] == "listed-1"

    assert client.get("/capabilities/missing").status_code == 404


def test_run_capability_executes_and_increments_reuse(app_client):
    client, store, *_ = app_client
    cap = make_capability(logic=GOOD_LOGIC, cap_id="runnable-1")
    asyncio.run(store.save(cap, [0.0] * 1536))

    resp = client.post("/capabilities/runnable-1/run", json={"measurement_year": 2023})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 3
    assert "latency_ms" in body
    assert store._caps["runnable-1"].manifest.reuse_count == 1


def test_run_missing_capability_404(app_client):
    client, *_ = app_client
    resp = client.post("/capabilities/nope/run", json={"measurement_year": 2023})
    assert resp.status_code == 404


def test_approve_returns_false_without_gate(app_client):
    client, *_ = app_client
    resp = client.post("/approve/no-such-build")
    assert resp.status_code == 200
    assert resp.json() == {"ok": False}


def test_sse_stream_replays_events_until_terminal(app_client):
    client, store, clinic, build_loop = app_client
    # Pre-load the stream with a routing event and a terminal done event for one id.
    loop = asyncio.new_event_loop()
    from backend.schemas import BuildEvent

    loop.run_until_complete(store.emit(BuildEvent(capability_id="sse-1", stage="routing", message="Checking...")))
    loop.run_until_complete(
        store.emit(
            BuildEvent(
                capability_id="sse-1",
                stage="done",
                message="Complete",
                payload={"result": {"count": 3, "rows": []}},
            )
        )
    )
    # An event for a different build must be filtered out.
    loop.run_until_complete(store.emit(BuildEvent(capability_id="other", stage="routing")))
    loop.close()

    received = []
    with client.stream("GET", "/events/sse-1") as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line.startswith("data:"):
                received.append(json.loads(line[len("data:"):].strip()))
            if received and received[-1]["stage"] in ("done", "error", "timeout"):
                break

    stages = [r["stage"] for r in received]
    assert stages == ["routing", "done"]
    assert received[-1]["payload"]["result"]["count"] == 3
