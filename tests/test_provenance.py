"""Unit tests for the intelligence-dashboard provenance additions.

Covers the pure `scope_facts` AST helper against the real seed logic strings and
the `Provenance` model round-tripping through `Manifest.model_dump()`. No live
Redis/Postgres/Claude — all pure-Python.
"""
from __future__ import annotations

import pytest

from backend.kernel.verifier import ALLOWED_DATA_METHODS, scope_facts
from backend.schemas import BuildTraceStep, Manifest, Provenance
from backend.seed_capabilities import (
    _DIABETES_A1C_LOGIC,
    _HYPERTENSION_BP_LOGIC,
    _OBESITY_ROSTER_LOGIC,
)

SEED_LOGIC = {
    "diabetes": _DIABETES_A1C_LOGIC,
    "hypertension": _HYPERTENSION_BP_LOGIC,
    "obesity": _OBESITY_ROSTER_LOGIC,
}


@pytest.mark.parametrize("name,logic", list(SEED_LOGIC.items()))
def test_scope_facts_on_seed_logic(name, logic):
    facts = scope_facts(logic)
    # Verified capabilities never import and never touch dunders.
    assert facts["imports"] == 0, name
    assert facts["dunders"] == 0, name
    # Each seed performs real data-layer calls...
    assert facts["data_calls"] > 0, name
    assert facts["data_calls"] == len(facts["methods"]), name
    # ...and every method called is on the allowlist (honest "all on allowlist").
    assert all(m in ALLOWED_DATA_METHODS for m in facts["methods"]), name


def test_scope_facts_counts_imports_and_dunders():
    code = (
        "import os\n"
        "async def run(clinic_data, inputs):\n"
        "    x = ().__class__\n"
        "    return await clinic_data.get_all_patient_ids()\n"
    )
    facts = scope_facts(code)
    assert facts["imports"] == 1
    assert facts["dunders"] == 1
    assert facts["data_calls"] == 1
    assert facts["methods"] == ["get_all_patient_ids"]


def test_scope_facts_ignores_non_clinic_data_calls():
    code = (
        "async def run(clinic_data, inputs):\n"
        "    s = set()\n"
        "    s.add(1)\n"  # method call, but not on clinic_data
        "    return await clinic_data.get_all_patient_ids()\n"
    )
    facts = scope_facts(code)
    assert facts["data_calls"] == 1
    assert facts["methods"] == ["get_all_patient_ids"]


def test_provenance_round_trips_through_manifest_dump():
    prov = Provenance(
        build_cost=2410,
        input_tokens=1800,
        output_tokens=610,
        trace=[
            BuildTraceStep(stage="routing", ts=1.0, detail="checking library"),
            BuildTraceStep(stage="done", ts=9.0, detail="3 rows returned"),
        ],
        verification={
            "data_calls": 3,
            "imports": 0,
            "dunders": 0,
            "methods": ["get_all_patient_ids"],
            "sandbox_valid": True,
            "all_on_allowlist": True,
        },
        first_run_ms=18400,
        best_similarity=0.41,
    )
    m = Manifest(name="X", description="y", provenance=prov)
    dumped = m.model_dump()
    assert dumped["provenance"]["build_cost"] == 2410
    assert dumped["provenance"]["best_similarity"] == 0.41
    assert len(dumped["provenance"]["trace"]) == 2

    # Reconstruct from the dump (mirrors the RedisJSON write/read path).
    restored = Manifest(**dumped)
    assert restored.provenance is not None
    assert restored.provenance.build_cost == 2410
    assert restored.provenance.trace[1].detail == "3 rows returned"
    assert restored.provenance.verification["data_calls"] == 3


def test_seed_manifest_has_null_provenance_by_default():
    m = Manifest(name="Seed", description="baseline")
    assert m.provenance is None
    assert m.model_dump()["provenance"] is None
