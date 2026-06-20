"""
Measure Synthesis Benchmark (MSB) harness.
Steven: wire up run_eval() once reference impls and swarm are implemented.

Procedure (per spec §4.5):
  load synthetic population + reference implementations (ground truth)
  for each measure task:
      FORGE:  cycle 1 → build → verify → install → execute
              cycles 2..N → route → reuse → execute
      SWARM:  cycles 1..N → solve from scratch each time
      for each system, run K times per cycle
      compare outputs to reference → accuracy, exclusion accuracy, consistency
      log tokens + latency
  aggregate → emit charts
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from datetime import date
from pathlib import Path

from backend.config import settings
from backend.data.clinic_data import ClinicDataLayer
from backend.schemas import MeasureTask, MeasureResult
from eval.metrics import (
    precision_recall_f1,
    exclusion_accuracy,
    mean_pairwise_jaccard,
)
from eval.reference.cms122_diabetes import run as cms122_ref
from eval.reference.cms165_hypertension import run as cms165_ref
from eval.swarm.swarm_agent import SwarmAgent

MEASUREMENT_START = date(2023, 1, 1)
MEASUREMENT_END = date(2023, 12, 31)
K_RUNS: int = int(os.getenv("EVAL_K_RUNS", "5"))
N_CYCLES: int = int(os.getenv("EVAL_N_CYCLES", "6"))


async def build_ground_truth(clinic_data: ClinicDataLayer) -> dict[str, dict]:
    """Run reference implementations to produce ground-truth patient sets."""
    cms122 = await cms122_ref(clinic_data)
    cms165 = await cms165_ref(clinic_data)
    return {
        "CMS122": cms122,  # {denominator, numerator, excluded}
        "CMS165": cms165,
    }


async def run_forge_cycle(
    measure_id: str,
    spec_text: str,
    cycle: int,
    clinic_data: ClinicDataLayer,
) -> tuple[MeasureResult, int, int, float]:
    """
    Returns (result, input_tokens, output_tokens, latency_ms).
    TODO (Arjun): call the Forge kernel here — route → (build if cycle 1) → execute.
    For now this is a stub.
    """
    raise NotImplementedError("Arjun: wire Forge kernel into harness")


async def run_swarm_cycle(
    measure_id: str,
    spec_text: str,
    clinic_data: ClinicDataLayer,
) -> tuple[MeasureResult, int, int, float]:
    agent = SwarmAgent()
    t0 = time.perf_counter()
    result = await agent.solve(
        measure_id=measure_id,
        spec_text=spec_text,
        clinic_data=clinic_data,
        measurement_start=MEASUREMENT_START.isoformat(),
        measurement_end=MEASUREMENT_END.isoformat(),
    )
    latency_ms = (time.perf_counter() - t0) * 1000
    return result, agent.last_input_tokens, agent.last_output_tokens, latency_ms


MEASURE_SPECS = {
    "CMS122": """CMS122 — Diabetes: Hemoglobin A1c Poor Control (>9%)
Denominator: patients 18–75 with diabetes diagnosis and qualifying visit in 2023.
Numerator: most recent A1c >9% OR no A1c performed in 2023.
A1c LOINC: 4548-4, 4549-2, 17856-6.
Diabetes SNOMED: 44054006, 73211009, 46635009.""",

    "CMS165": """CMS165 — Controlling High Blood Pressure
Denominator: patients 18–85 with essential hypertension starting before July 1 2023 and qualifying visit in 2023.
Numerator: most recent BP in 2023 has systolic <140 AND diastolic <90.
BP LOINC: systolic=8480-6, diastolic=8462-4 (same-date paired reading).
Hypertension SNOMED: 59621000.""",
}


async def run_eval() -> dict:
    clinic_data = ClinicDataLayer(settings.database_url)
    await clinic_data.connect()

    print("Building ground truth from reference implementations...")
    ground_truth = await build_ground_truth(clinic_data)

    results = {}
    for measure_id, gt in ground_truth.items():
        spec_text = MEASURE_SPECS[measure_id]
        forge_numerator_runs = []
        swarm_numerator_runs = []
        forge_tokens_total = 0
        swarm_tokens_total = 0

        print(f"\n=== {measure_id} ===")
        for cycle in range(1, N_CYCLES + 1):
            for k in range(K_RUNS):
                # Forge
                try:
                    f_result, f_in, f_out, f_ms = await run_forge_cycle(
                        measure_id, spec_text, cycle, clinic_data
                    )
                    forge_numerator_runs.append(f_result.numerator)
                    forge_tokens_total += f_in + f_out
                    print(f"  Forge  cycle={cycle} k={k} latency={f_ms:.0f}ms tokens={f_in+f_out}")
                except NotImplementedError:
                    print(f"  Forge  cycle={cycle} k={k} STUB — skipping")

                # Swarm
                try:
                    s_result, s_in, s_out, s_ms = await run_swarm_cycle(
                        measure_id, spec_text, clinic_data
                    )
                    swarm_numerator_runs.append(s_result.numerator)
                    swarm_tokens_total += s_in + s_out
                    print(f"  Swarm  cycle={cycle} k={k} latency={s_ms:.0f}ms tokens={s_in+s_out}")
                except NotImplementedError:
                    print(f"  Swarm  cycle={cycle} k={k} STUB — skipping")

        # Score (only if we have runs)
        gt_numerator = gt.get("numerator", [])
        gt_excluded = gt.get("excluded", [])

        measure_results = {"measure_id": measure_id}
        if forge_numerator_runs:
            last_forge = forge_numerator_runs[-1]
            measure_results["forge"] = {
                **precision_recall_f1(last_forge, gt_numerator),
                "exclusion_accuracy": exclusion_accuracy([], gt_excluded),
                "consistency": mean_pairwise_jaccard(forge_numerator_runs),
                "total_tokens": forge_tokens_total,
            }
        if swarm_numerator_runs:
            last_swarm = swarm_numerator_runs[-1]
            measure_results["swarm"] = {
                **precision_recall_f1(last_swarm, gt_numerator),
                "exclusion_accuracy": exclusion_accuracy([], gt_excluded),
                "consistency": mean_pairwise_jaccard(swarm_numerator_runs),
                "total_tokens": swarm_tokens_total,
            }

        results[measure_id] = measure_results

    await clinic_data.close()
    return results


if __name__ == "__main__":
    results = asyncio.run(run_eval())
    print("\n=== EVAL RESULTS ===")
    print(json.dumps(results, indent=2))
