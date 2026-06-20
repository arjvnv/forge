"""
Shared test fixtures and fakes for the Forge kernel.

These tests run without live Redis / Postgres / Claude. We set a dummy
ANTHROPIC_API_KEY so config + the Synthesizer client can construct, then inject
in-memory fakes that mimic the Phase 1 contracts (CapabilityStore,
ClinicDataLayer).
"""
from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
# Force the embed() graceful-degrade path so tests never hit OpenAI.
os.environ["OPENAI_API_KEY"] = ""

import pytest

from backend.schemas import BuildEvent, Capability, Manifest


# A valid capability whose logic passes _scope_check and returns rows/count.
GOOD_LOGIC = (
    "async def run(clinic_data, inputs):\n"
    "    year = inputs['measurement_year']\n"
    "    ids = await clinic_data.get_all_patient_ids()\n"
    "    rows = [{'patient_id': pid} for pid in ids]\n"
    "    return {'columns': ['patient_id'], 'rows': rows, 'count': len(rows)}\n"
)

# Logic that violates scope (imports os) — must be rejected at execute time.
MALICIOUS_LOGIC = (
    "import os\n"
    "async def run(clinic_data, inputs):\n"
    "    return {'rows': [], 'count': 0}\n"
)

# Logic that returns the wrong shape (no rows/count).
BAD_SHAPE_LOGIC = (
    "async def run(clinic_data, inputs):\n"
    "    return {'total': 0}\n"
)


def make_capability(logic: str = GOOD_LOGIC, cap_id: str = "cap-1") -> Capability:
    return Capability(
        manifest=Manifest(
            id=cap_id,
            name="Test Capability",
            description="Counts patients",
            inputs={"measurement_year": "int = 2023"},
            output={"rows": "list[dict]", "count": "int"},
            reads=["patients"],
        ),
        logic=logic,
        ui_spec={"type": "table", "columns": ["patient_id"], "title": "Patients"},
    )


class FakeClinicData:
    """Mimics ClinicDataLayer's async surface with deterministic data."""

    def __init__(self, patient_ids=None):
        self._ids = patient_ids if patient_ids is not None else ["p1", "p2", "p3"]

    async def get_all_patient_ids(self):
        return list(self._ids)

    async def get_patients_in_age_range(self, *a, **kw):
        return [{"id": pid} for pid in self._ids]

    async def get_patients_with_condition(self, *a, **kw):
        return list(self._ids)

    async def patient_has_condition(self, *a, **kw):
        return True

    async def get_most_recent_observation(self, *a, **kw):
        return {"code": "x", "value": 1.0}

    async def get_observations_in_period(self, *a, **kw):
        return []

    async def had_qualifying_visit(self, *a, **kw):
        return True

    async def get_encounters_in_period(self, *a, **kw):
        return []

    async def patient_has_medication(self, *a, **kw):
        return False

    async def close(self):
        pass


class FakeStore:
    """In-memory CapabilityStore replacement.

    Mirrors save/get/list_all/increment_reuse/emit/read_events/search and the
    semantics the kernel relies on (emit serializes payload like the real store).
    """

    def __init__(self):
        self._caps: dict[str, Capability] = {}
        self._embeddings: dict[str, list[float]] = {}
        self.events: list[dict] = []
        self._stream: list[dict] = []
        self._route_hit: tuple[float, str] | None = None  # (distance, cap_id)

    # write
    async def save(self, cap, embedding):
        self._caps[cap.manifest.id] = cap
        self._embeddings[cap.manifest.id] = embedding
        return cap.manifest.id

    async def increment_reuse(self, cap_id):
        cap = self._caps.get(cap_id)
        if cap:
            cap.manifest.reuse_count += 1

    # read
    async def get(self, cap_id):
        return self._caps.get(cap_id)

    async def list_all(self):
        return [c.manifest for c in self._caps.values()]

    # routing
    def set_route_hit(self, cap_id, distance=0.05):
        self._route_hit = (distance, cap_id)

    async def search(self, query_embedding, top_k=3):
        if self._route_hit is None:
            return []
        distance, cap_id = self._route_hit
        cap = self._caps.get(cap_id)
        name = cap.manifest.name if cap else ""
        return [{"id": cap_id, "name": name, "vector_distance": distance}]

    # event bus
    async def emit(self, event: BuildEvent):
        import json

        record = {
            "id": str(len(self._stream)),
            "capability_id": event.capability_id,
            "stage": event.stage,
            "message": event.message,
            "payload": json.dumps(event.payload),
        }
        self._stream.append(record)
        self.events.append(record)

    async def read_events(self, last_id="0", count=100):
        start = int(last_id) if last_id != "0" else 0
        # last_id is exclusive in the real stream after the first read; emulate by
        # treating "0" as "from beginning" and any other id as "strictly after".
        if last_id == "0":
            return self._stream[:count]
        return self._stream[start + 1 : start + 1 + count]


@pytest.fixture
def clinic():
    return FakeClinicData()


@pytest.fixture
def store():
    return FakeStore()
