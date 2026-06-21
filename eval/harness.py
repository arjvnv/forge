"""
Measure Synthesis Benchmark (MSB) harness.

Procedure (per spec §4.5):
  load synthetic population + reference implementations (ground truth)
  for each measure task:
      FORGE:  cycle 1 → build → verify → install → execute
              cycles 2..N → route → reuse → execute
      SWARM:  cycles 1..N → solve from scratch each time (CrewAI baseline)
      for each system, run K times per cycle
      compare outputs to reference → accuracy, exclusion accuracy, consistency
      log tokens + latency
  aggregate → emit JSON

Running:
  The CrewAI baseline requires Python <3.14, so the harness runs from a dedicated
  3.11 venv:  /Users/arjunvivek/forge/.venv-eval/bin/python -m eval.harness
  The Forge server keeps running under the existing 3.14 .venv (it does not import
  crewai). The two communicate over HTTP only.

Env vars:
  FORGE_API_BASE   Forge server base URL (default http://localhost:8000)
  EVAL_K_RUNS      runs per cycle (default 5)
  EVAL_N_CYCLES    cycles per measure (default 6)
  EVAL_CREW_MODEL  override the CrewAI model id (default anthropic/<forge_route_model>)
  OPENAI_API_KEY   required server-side for routing/reuse; without it every Forge
                   cycle rebuilds (the reuse/token-savings story is lost).

Token accounting: Forge build cost = synthesis tokens only (emitted on the
`synthesized` SSE event). Reuse cycles emit no `synthesized` event, so they report
zero synthesis tokens. OpenAI embedding tokens (routing) are intentionally excluded.
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from datetime import date

import httpx

from backend.config import settings
from backend.data.clinic_data import ClinicDataLayer
from backend.schemas import MeasureResult
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

# Forge runs server-side over HTTP. The harness venv (3.11, crewai) and the server
# venv (3.14) are deliberately different — they only need to agree on the HTTP contract.
FORGE_API_BASE = os.getenv("FORGE_API_BASE", "http://localhost:8000")

# measure_id -> capability_id, remembered across cycles (informational; the router
# decides build-vs-reuse server-side, so this is not used to gate behavior).
_forge_capability_ids: dict[str, str] = {}

# Appended to the raw spec for Forge's /intent so the synthesized run() emits a
# parseable per-patient row shape. The CrewAI baseline gets the RAW spec (it returns
# the three lists directly), keeping the "same clinical info, different mechanism" claim.
_FORGE_OUTPUT_CONTRACT = (
    "\n\nOutput requirement: return rows as a list of objects, one per DENOMINATOR patient, "
    'each {"patient_id": <id>, "classification": <one of "numerator", '
    '"denominator_only", "excluded">}. \'numerator\' = meets the numerator criteria; '
    "'excluded' = meets a denominator exclusion; 'denominator_only' = in denominator but "
    "neither numerator nor excluded. Set count = number of rows. Do not include patients "
    "outside the denominator."
)


def _forge_intent_text(spec_text: str) -> str:
    """Build the /intent text from a raw measure spec by appending the output contract."""
    return spec_text + _FORGE_OUTPUT_CONTRACT


def _parse_sse_line(line: str) -> dict | None:
    """Parse one SSE framing line into an event dict, or None for non-data/blank lines."""
    line = line.strip()
    if not line.startswith("data:"):
        return None
    raw = line[len("data:"):].strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _parse_forge_result(result: dict) -> MeasureResult:
    """Parse a Forge capability {rows, count} result into a MeasureResult.

    Each row is expected to carry patient_id + classification. Degrades gracefully:
    unknown/missing classification counts toward the denominator only (lower recall,
    never a crash). numerator/excluded are enforced to be subsets of the denominator.
    """
    rows = result.get("rows", []) if isinstance(result, dict) else []
    denominator: list[str] = []
    numerator: list[str] = []
    excluded: list[str] = []
    recognized = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("patient_id", "")).strip()
        if not pid:
            continue
        cls = str(row.get("classification", "denominator_only")).strip().lower()
        denominator.append(pid)
        if cls == "numerator":
            numerator.append(pid)
            recognized += 1
        elif cls == "excluded":
            excluded.append(pid)
            recognized += 1
        elif cls == "denominator_only":
            recognized += 1

    if rows and recognized == 0:
        print(
            "  [warn] Forge result rows carried no recognized classification — "
            "treating all as denominator_only (possible contract miss)."
        )

    denom_set = set(denominator)
    numerator = [p for p in dict.fromkeys(numerator) if p in denom_set]
    excluded = [p for p in dict.fromkeys(excluded) if p in denom_set]
    return MeasureResult(
        denominator=list(dict.fromkeys(denominator)),
        numerator=numerator,
        excluded=excluded,
    )


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
    Drive the real Forge kernel over HTTP + SSE and return
    (result, input_tokens, output_tokens, latency_ms).

    Forge runs server-side, so `clinic_data` is unused here (kept for signature
    stability) and `cycle` is advisory only — Forge's router decides build-vs-reuse:
      - build path: routing -> gap -> synthesizing -> synthesized -> verifying ->
        verified -> approved -> installed -> executing -> done
      - reuse path: routing -> reuse -> executing -> done (no synthesis, zero tokens)
    Both paths emit the executed result inside the `done` event, so no separate
    /run call is needed in the normal case.
    """
    t0 = time.perf_counter()
    in_tok = out_tok = 0
    result_payload = None

    async with httpx.AsyncClient(
        base_url=FORGE_API_BASE, timeout=httpx.Timeout(120.0)
    ) as client:
        resp = await client.post(
            "/intent",
            json={
                "text": _forge_intent_text(spec_text),
                "measurement_year": MEASUREMENT_START.year,
            },
        )
        resp.raise_for_status()
        cap_id = resp.json()["capability_id"]

        async with client.stream("GET", f"/events/{cap_id}") as stream:
            async for line in stream.aiter_lines():
                event = _parse_sse_line(line)
                if event is None:
                    continue
                stage = event.get("stage", "")
                payload = event.get("payload", {}) or {}
                if stage == "synthesized":
                    in_tok = int(payload.get("input_tokens", 0) or 0)
                    out_tok = int(payload.get("output_tokens", 0) or 0)
                elif stage == "verified":
                    # Only the build path reaches `verified`; reuse never does.
                    await client.post(f"/approve/{cap_id}")
                elif stage == "done":
                    result_payload = payload.get("result")
                    break
                elif stage in ("error", "verify_failed", "timeout"):
                    raise RuntimeError(
                        f"Forge build failed at {stage}: {event.get('message')}"
                    )

        # Normally the `done` payload already carries the executed result (both build
        # and reuse paths). Only fall back to an explicit /run if it's missing, so we
        # never double-execute (which would also inflate reuse_count).
        if result_payload is None:
            run_resp = await client.post(
                f"/capabilities/{cap_id}/run",
                json={"measurement_year": MEASUREMENT_START.year},
            )
            run_resp.raise_for_status()
            result_payload = run_resp.json()

    _forge_capability_ids[measure_id] = cap_id
    measure_result = _parse_forge_result(result_payload or {})
    latency_ms = (time.perf_counter() - t0) * 1000
    return measure_result, in_tok, out_tok, latency_ms


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
                except Exception as e:
                    # Fail-soft: one failed cycle (server down, timeout, build error)
                    # must not abort the whole eval — log and continue.
                    print(f"  Forge  cycle={cycle} k={k} FAILED: {e}")

                # Swarm
                try:
                    s_result, s_in, s_out, s_ms = await run_swarm_cycle(
                        measure_id, spec_text, clinic_data
                    )
                    swarm_numerator_runs.append(s_result.numerator)
                    swarm_tokens_total += s_in + s_out
                    print(f"  Swarm  cycle={cycle} k={k} latency={s_ms:.0f}ms tokens={s_in+s_out}")
                except Exception as e:
                    # Fail-soft: a single crew failure must not abort the eval.
                    print(f"  Swarm  cycle={cycle} k={k} FAILED: {e}")

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
