import asyncio

import pytest

import backend.kernel.build_loop as bl_module
from backend.kernel.build_loop import BuildLoop
from backend.kernel.synthesizer import SynthesisError
from backend.schemas import IntentRequest
from tests.conftest import GOOD_LOGIC, make_capability

pytestmark = pytest.mark.asyncio


class StubSynth:
    """Drop-in for Synthesizer.synthesize without calling Claude."""

    def __init__(self, capability=None, error=None):
        self._cap = capability
        self._error = error

    async def synthesize(self, intent, measurement_year=2023):
        if self._error:
            raise self._error
        return self._cap


def _build_loop(store, clinic):
    loop = BuildLoop.__new__(BuildLoop)  # skip __init__ (avoids real Anthropic client)
    loop.store = store
    loop.clinic_data = clinic
    from backend.kernel.executor import Executor
    from backend.kernel.installer import Installer
    from backend.kernel.router import Router

    loop.executor = Executor()
    loop.installer = Installer()
    loop.router = Router(store)
    loop.synthesizer = StubSynth()
    loop._approval_gates = {}
    return loop


async def _collect(gen):
    return [e async for e in gen]


async def test_reuse_path(store, clinic):
    existing = make_capability(cap_id="existing-1")
    await store.save(existing, [0.0] * 1536)
    store.set_route_hit("existing-1", distance=0.01)

    loop = _build_loop(store, clinic)
    events = await _collect(loop.run(IntentRequest(text="count patients"), "build-1"))
    stages = [e.stage for e in events]

    assert stages == ["routing", "reuse", "executing", "done"]
    # All events carry the pre-generated build id, not the existing cap id.
    assert all(e.capability_id == "build-1" for e in events)
    done = events[-1]
    assert done.payload["result"]["count"] == 3
    assert done.payload["reuse_count"] == 1


async def test_full_build_happy_path(store, clinic):
    synthesized = make_capability(logic=GOOD_LOGIC, cap_id="claude-generated-id")
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(capability=synthesized)

    events = []
    gen = loop.run(IntentRequest(text="new tool"), "build-2")

    # Drive the generator, releasing the approval gate when we reach "verified".
    async def driver():
        async for e in gen:
            events.append(e)
            if e.stage == "verified":
                # Approve out-of-band, like the /approve endpoint would.
                assert await loop.approve("build-2") is True

    await driver()
    stages = [e.stage for e in events]
    assert stages == [
        "routing", "gap", "synthesizing", "synthesized", "verifying",
        "verified", "approved", "installed", "executing", "done",
    ]
    # Manifest id was overridden to the pre-generated build id everywhere.
    assert all(e.capability_id == "build-2" for e in events)
    installed = await store.get("build-2")
    assert installed is not None
    assert installed.verified is True
    assert installed.manifest.id == "build-2"
    assert events[-1].payload["result"]["count"] == 3


async def test_synthesis_error_stops(store, clinic):
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(error=SynthesisError("bad json"))

    events = await _collect(loop.run(IntentRequest(text="x"), "build-3"))
    stages = [e.stage for e in events]
    assert stages == ["routing", "gap", "synthesizing", "error"]
    assert events[-1].message == "bad json"


async def test_verify_failed_stops(store, clinic):
    bad = make_capability(
        logic="import os\nasync def run(clinic_data, inputs):\n    return {'rows': [], 'count': 0}\n",
        cap_id="will-fail",
    )
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(capability=bad)

    events = await _collect(loop.run(IntentRequest(text="x"), "build-4"))
    stages = [e.stage for e in events]
    assert stages == [
        "routing", "gap", "synthesizing", "synthesized", "verifying", "verify_failed",
    ]
    # No approval gate should linger after a verify failure.
    assert "build-4" not in loop._approval_gates


async def test_approval_timeout(store, clinic, monkeypatch):
    monkeypatch.setattr(bl_module, "APPROVAL_TIMEOUT_S", 0.05)
    synthesized = make_capability(logic=GOOD_LOGIC)
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(capability=synthesized)

    events = await _collect(loop.run(IntentRequest(text="x"), "build-5"))
    stages = [e.stage for e in events]
    assert stages[-2:] == ["verified", "error"]
    assert events[-1].message == "Approval timed out"
    assert "build-5" not in loop._approval_gates


async def test_approve_returns_false_when_no_gate(store, clinic):
    loop = _build_loop(store, clinic)
    assert await loop.approve("nonexistent") is False


async def test_reuse_falls_through_when_indexed_cap_missing(store, clinic):
    # Index points at a cap id that isn't in the store -> treat as a gap.
    store.set_route_hit("ghost", distance=0.01)
    synthesized = make_capability(logic=GOOD_LOGIC)
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(capability=synthesized)

    events = []
    gen = loop.run(IntentRequest(text="x"), "build-6")
    async for e in gen:
        events.append(e)
        if e.stage == "verified":
            await loop.approve("build-6")
    stages = [e.stage for e in events]
    assert stages[:3] == ["routing", "gap", "synthesizing"]
    assert stages[-1] == "done"
