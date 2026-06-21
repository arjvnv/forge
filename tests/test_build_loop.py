import asyncio

import pytest

import backend.kernel.build_loop as bl_module
from backend.kernel.build_loop import BuildLoop
from backend.kernel.synthesizer import SynthesisError
from backend.schemas import IntentRequest
from tests.conftest import GOOD_LOGIC, make_capability

pytestmark = pytest.mark.asyncio


class StubSynth:
    """Drop-in for Synthesizer.synthesize without calling Claude.

    Mirrors the real Synthesizer's token attributes (set after synthesize()), which
    BuildLoop now reads into the `synthesized` event payload.
    """

    def __init__(self, capability=None, error=None, input_tokens=11, output_tokens=7):
        self._cap = capability
        self._error = error
        self.last_input_tokens = 0
        self.last_output_tokens = 0
        self._input_tokens = input_tokens
        self._output_tokens = output_tokens
        self.received_prior = None

    async def synthesize(self, intent, measurement_year=2023, prior_patterns=None):
        self.received_prior = prior_patterns
        if self._error:
            raise self._error
        self.last_input_tokens = self._input_tokens
        self.last_output_tokens = self._output_tokens
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
        "verified", "approved", "executing", "installed", "done",
    ]
    # Manifest id was overridden to the pre-generated build id everywhere.
    assert all(e.capability_id == "build-2" for e in events)
    installed = await store.get("build-2")
    assert installed is not None
    assert installed.verified is True
    assert installed.manifest.id == "build-2"
    assert events[-1].payload["result"]["count"] == 3

    # The synthesized event carries the synthesizer's token counts (consumed by the
    # eval harness to report Forge build cost).
    synth_event = next(e for e in events if e.stage == "synthesized")
    assert synth_event.payload["input_tokens"] == 11
    assert synth_event.payload["output_tokens"] == 7
    # No in-band neighbor seeded -> synthesized from scratch.
    assert synth_event.payload["built_from"] == []


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


async def test_compounding_injects_in_band_neighbor(store, clinic):
    # Seed a neighbor whose similarity falls in [floor, threshold): distance 0.5 -> sim 0.5.
    neighbor = make_capability(cap_id="neighbor-1")
    neighbor.manifest.name = "Diabetes Eye Exam"
    await store.save(neighbor, [0.0] * 1536)
    # Below the reuse threshold (0.62) -> routing MISS, but in-band for compounding.
    store.set_route_hit("neighbor-1", distance=0.5)

    synthesized = make_capability(logic=GOOD_LOGIC, cap_id="claude-generated-id")
    loop = _build_loop(store, clinic)
    loop.synthesizer = StubSynth(capability=synthesized)

    events = []
    gen = loop.run(IntentRequest(text="similar tool"), "build-7")
    async for e in gen:
        events.append(e)
        if e.stage == "verified":
            await loop.approve("build-7")

    synth_event = next(e for e in events if e.stage == "synthesized")
    built_from = synth_event.payload["built_from"]
    assert len(built_from) == 1
    assert built_from[0] == {
        "id": "neighbor-1",
        "name": "Diabetes Eye Exam",
        "similarity": 0.5,
    }
    # The synthesizer received the prior pattern.
    assert loop.synthesizer.received_prior is not None
    assert len(loop.synthesizer.received_prior) == 1
    assert loop.synthesizer.received_prior[0].manifest.id == "neighbor-1"
