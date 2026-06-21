"""
Seed the Forge registry with a few pre-loaded, hand-verified capabilities.

These give the demo an immediate "reuse" story: a request that matches one of
these routes straight to the reuse path (no synthesis), while a novel request
still falls through to the full build loop. The logic here is written by hand
and run through the SAME verifier the synthesizer's output goes through, so a
broken seed fails fast instead of poisoning the registry.

Run once after the stack is up (Redis + Postgres + OPENAI_API_KEY set):

    .venv/bin/python -m backend.seed_capabilities

Idempotent: each capability gets a deterministic id (uuid5 of its slug), so
re-running overwrites in place rather than creating duplicates.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from backend.config import settings
from backend.kernel.router import embed
from backend.kernel.verifier import verify
from backend.registry.capability_store import CapabilityStore
from backend.schemas import Capability, Manifest

# Stable namespace so a given slug always maps to the same capability id.
_SEED_NAMESPACE = uuid.UUID("f0f0f0f0-0000-4000-8000-000000000000")


def _seed_id(slug: str) -> str:
    return str(uuid.uuid5(_SEED_NAMESPACE, slug))


# ── capability logic (hand-written, verifier-compliant) ──────────────────────

_DIABETES_A1C_LOGIC = '''\
async def run(clinic_data, inputs):
    year = inputs.get("measurement_year", 2023)
    period_start = date(year, 1, 1)
    period_end = date(year, 12, 31)
    diabetes_codes = ["44054006", "73211009", "46635009"]
    a1c_codes = ["4548-4", "4549-2", "17856-6"]

    eligible = await clinic_data.get_patients_in_age_range(18, 75, period_end)
    eligible_ids = set(p["id"] for p in eligible)
    with_diabetes = await clinic_data.get_patients_with_condition(diabetes_codes, period_end)
    target_ids = eligible_ids & set(with_diabetes)

    rows = []
    for pid in target_ids:
        if not await clinic_data.had_qualifying_visit(pid, period_start, period_end):
            continue
        obs = await clinic_data.get_most_recent_observation(pid, a1c_codes, period_start, period_end)
        if obs is None or obs["value"] is None:
            a1c = None
            status = "no test in period"
        else:
            a1c = float(obs["value"])
            status = "poor control (>9%)" if a1c > 9.0 else "controlled"
        rows.append({
            "patient_id": pid,
            "most_recent_a1c": a1c if a1c is not None else "no test",
            "control_status": status,
        })
    rows = sorted(rows, key=lambda r: r["patient_id"])
    return {"rows": rows, "count": len(rows)}
'''

_HYPERTENSION_BP_LOGIC = '''\
async def run(clinic_data, inputs):
    year = inputs.get("measurement_year", 2023)
    period_start = date(year, 1, 1)
    period_end = date(year, 12, 31)
    htn_codes = ["59621000"]
    systolic_codes = ["8480-6"]
    diastolic_codes = ["8462-4"]

    eligible = await clinic_data.get_patients_in_age_range(18, 85, period_end)
    eligible_ids = set(p["id"] for p in eligible)
    with_htn = await clinic_data.get_patients_with_condition(htn_codes, period_end)
    target_ids = eligible_ids & set(with_htn)

    rows = []
    for pid in target_ids:
        if not await clinic_data.had_qualifying_visit(pid, period_start, period_end):
            continue
        sys_obs = await clinic_data.get_observations_in_period(pid, systolic_codes, period_start, period_end)
        dia_obs = await clinic_data.get_observations_in_period(pid, diastolic_codes, period_start, period_end)
        sys_by_date = {}
        for o in sys_obs:
            if o["value"] is not None:
                sys_by_date[o["date"]] = float(o["value"])
        dia_by_date = {}
        for o in dia_obs:
            if o["value"] is not None:
                dia_by_date[o["date"]] = float(o["value"])
        shared = set(sys_by_date) & set(dia_by_date)
        if not shared:
            continue
        latest = max(shared)
        systolic = sys_by_date[latest]
        diastolic = dia_by_date[latest]
        if systolic < 140 and diastolic < 90:
            rows.append({
                "patient_id": pid,
                "systolic": systolic,
                "diastolic": diastolic,
                "reading_date": str(latest),
            })
    return {"rows": rows, "count": len(rows)}
'''

_OBESITY_ROSTER_LOGIC = '''\
async def run(clinic_data, inputs):
    year = inputs.get("measurement_year", 2023)
    period_end = date(year, 12, 31)
    obesity_codes = ["162864005"]

    eligible = await clinic_data.get_patients_in_age_range(18, 120, period_end)
    by_id = {}
    for p in eligible:
        by_id[p["id"]] = p
    with_obesity = await clinic_data.get_patients_with_condition(obesity_codes, period_end)

    rows = []
    for pid in set(with_obesity):
        patient = by_id.get(pid)
        if patient is None:
            continue
        rows.append({
            "patient_id": pid,
            "gender": patient["gender"],
            "birthdate": str(patient["birthdate"]),
        })
    rows = sorted(rows, key=lambda r: r["patient_id"])
    return {"rows": rows, "count": len(rows)}
'''


_SEEDS = [
    {
        "slug": "diabetes-a1c-poor-control",
        "name": "Diabetes A1c Monitoring Roster",
        "description": (
            "List diabetic patients aged 18 to 75 with a qualifying visit, showing "
            "each patient's most recent hemoglobin A1c reading in the measurement "
            "period and whether their diabetes is controlled or in poor control "
            "(A1c above 9 percent). Diabetes A1c monitoring and control tracking "
            "(based on CMS122)."
        ),
        "logic": _DIABETES_A1C_LOGIC,
        "reads": ["patients", "conditions", "observations", "encounters"],
        "columns": ["patient_id", "most_recent_a1c", "control_status"],
    },
    {
        "slug": "controlling-high-blood-pressure",
        "name": "Controlling High Blood Pressure (<140/90)",
        "description": (
            "Identify hypertensive patients aged 18 to 85 whose most recent paired "
            "blood pressure reading in the measurement period shows controlled "
            "pressure: systolic under 140 and diastolic under 90 mmHg. Controlling "
            "high blood pressure quality measure (CMS165)."
        ),
        "logic": _HYPERTENSION_BP_LOGIC,
        "reads": ["patients", "conditions", "observations", "encounters"],
        "columns": ["patient_id", "systolic", "diastolic", "reading_date"],
    },
    {
        "slug": "obesity-patient-roster",
        "name": "Obesity Patient Roster",
        "description": (
            "List all adult patients aged 18 and over who carry an obesity "
            "diagnosis, with their gender and birthdate, as a care-management "
            "roster."
        ),
        "logic": _OBESITY_ROSTER_LOGIC,
        "reads": ["patients", "conditions"],
        "columns": ["patient_id", "gender", "birthdate"],
    },
]


async def seed() -> None:
    store = CapabilityStore(settings.redis_url)
    await store.connect()

    inputs = {"measurement_year": 2023}
    now = datetime.now(timezone.utc).isoformat()

    try:
        for spec in _SEEDS:
            cap_id = _seed_id(spec["slug"])

            # Run the seed through the real verifier before persisting.
            ok, reason = await verify(spec["logic"], inputs)
            if not ok:
                raise RuntimeError(f"Seed '{spec['slug']}' failed verification: {reason}")

            manifest = Manifest(
                id=cap_id,
                name=spec["name"],
                description=spec["description"],
                inputs={"measurement_year": "int = 2023"},
                output={"columns": "list[str]", "rows": "list[dict]", "count": "int"},
                reads=spec["reads"],
                actions=[],
                scope={},
                reuse_count=0,
                created_at=now,
            )
            capability = Capability(
                manifest=manifest,
                logic=spec["logic"],
                ui_spec={"type": "table", "columns": spec["columns"], "title": spec["name"]},
                verified=True,
            )

            embedding = await embed(spec["description"])
            if not any(embedding):
                raise RuntimeError(
                    "Embedding came back all-zero — OPENAI_API_KEY is missing or invalid. "
                    "Routing/reuse needs real embeddings; set it before seeding."
                )

            await store.save(capability, embedding)
            print(f"  seeded  {spec['name']}  ({cap_id})")

        print(f"\nDone. {len(_SEEDS)} capabilities pre-loaded.")
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(seed())
