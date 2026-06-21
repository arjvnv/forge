"""
Multi-agent swarm baseline for the MSB eval — CrewAI implementation.

Architecture (CrewAI 2-agent sequential crew):
- Planner agent (Claude via LiteLLM): reads spec_text, emits a structured JSON query plan.
- Worker agent (Claude via LiteLLM): executes the plan against ClinicDataLayer using the
  six data tools below, and returns denominator/numerator/excluded patient-id lists as JSON.

The ONLY difference from Forge: no persistence, no verification artifact. The swarm
re-solves from scratch on every call, so the planner/worker's natural variance accumulates
across K runs and shows up in the consistency metric.

The swarm gets the full spec_text so the comparison is fair — same information,
different mechanism.

Sync/async bridge
-----------------
`ClinicDataLayer` is fully async (asyncpg); CrewAI tools execute synchronously inside the
crew's worker thread. We run the entire `crew.kickoff()` in `asyncio.to_thread(...)` so the
harness event loop is never blocked, and each tool drives its async DB coroutines via
`_run_async`, which spins up a private event loop, runs the coroutine, and tears it down.

Token tracking
--------------
After `crew.kickoff()` we read `crew.usage_metrics` (aggregated across both agents and all
tool-triggered LLM turns) for `prompt_tokens` / `completion_tokens`, with getattr fallbacks
so a field-name change on the installed crewai version can't crash the eval.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import date, datetime
from typing import TYPE_CHECKING, Optional, Type

from crewai import LLM, Agent, Crew, Process, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer

from backend.config import settings
from backend.schemas import MeasureResult

logger = logging.getLogger(__name__)

# Allow overriding the crew model (e.g. EVAL_CREW_MODEL=anthropic/claude-3-5-sonnet-latest)
# if LiteLLM cannot resolve the default model id.
_CREW_MODEL = os.getenv("EVAL_CREW_MODEL", f"anthropic/{settings.forge_route_model}")

# Belt-and-suspenders: some LiteLLM code paths read ANTHROPIC_API_KEY from the env directly.
if settings.anthropic_api_key:
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)


# ── async bridge ─────────────────────────────────────────────────────────────


def _run_async(coro):
    """Run an async coroutine to completion from a synchronous CrewAI tool.

    We are inside a worker thread (asyncio.to_thread) that has no running loop,
    so we spin up a private loop, run the coroutine, and tear it down.

    On exception (e.g. one coroutine in an asyncio.gather raises), sibling tasks
    can still be pending. We cancel and drain them before closing so their
    `finally`/`__aexit__` runs — otherwise `pool.acquire()` connections leak and
    the asyncpg pool (max_size=10) can exhaust across the eval's many tool calls.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            asyncio.set_event_loop(None)
            loop.close()


# ── normalization helpers ────────────────────────────────────────────────────


def _norm_date(d) -> date:
    """Normalize asyncpg date/datetime to datetime.date."""
    if isinstance(d, datetime):
        return d.date()
    return d


def _as_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _coerce_date(value, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return default


# ── tool argument schemas ────────────────────────────────────────────────────


class _AgeRangeArgs(BaseModel):
    min_age: int = Field(..., description="Minimum age (inclusive) on the period end date.")
    max_age: int = Field(..., description="Maximum age (inclusive) on the period end date.")


class _WithConditionArgs(BaseModel):
    snomed_codes: list[str] = Field(..., description="SNOMED condition codes to match.")
    on_or_before: Optional[str] = Field(
        None,
        description="ISO date (YYYY-MM-DD) the condition must be active on or before; "
        "defaults to the measurement period end.",
    )


class _PatientIdsArgs(BaseModel):
    patient_ids: list[str] = Field(..., description="Patient ids to evaluate.")


class _ObservationArgs(BaseModel):
    patient_ids: list[str] = Field(..., description="Patient ids to evaluate.")
    loinc_codes: list[str] = Field(..., description="LOINC observation codes to match.")


class _PairedObservationArgs(BaseModel):
    patient_ids: list[str] = Field(..., description="Patient ids to evaluate.")
    primary_loinc: list[str] = Field(..., description="Primary LOINC codes (e.g. systolic BP).")
    secondary_loinc: list[str] = Field(..., description="Secondary LOINC codes (e.g. diastolic BP).")


class _HasConditionArgs(BaseModel):
    patient_ids: list[str] = Field(..., description="Patient ids to evaluate.")
    snomed_codes: list[str] = Field(..., description="SNOMED condition codes to match (exclusions).")


# ── tools (BaseTool subclasses bound to a SwarmAgent) ─────────────────────────
#
# Each tool holds a reference to the owning SwarmAgent so it can reach
# `_clinic_data`, `_period_start`, `_period_end` and the `_run_async` bridge.
# Tools take patient-id LISTS and batch-gather coroutines so the agent never
# triggers one tool call per patient (which would explode tokens/latency).


class GetPatientsInAgeRangeTool(BaseTool):
    name: str = "get_patients_in_age_range"
    description: str = (
        "Return the ids of all patients whose age on the measurement period end date is "
        "within [min_age, max_age] (inclusive). Use this first to find age-eligible patients."
    )
    args_schema: Type[BaseModel] = _AgeRangeArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(self, min_age: int, max_age: int) -> list[str]:
        rows = _run_async(
            self._agent._clinic_data.get_patients_in_age_range(
                int(min_age), int(max_age), self._agent._period_end
            )
        )
        return [r["id"] for r in rows]


class GetPatientsWithConditionTool(BaseTool):
    name: str = "get_patients_with_condition"
    description: str = (
        "Return the ids of all patients who have any of the given SNOMED condition codes "
        "active on or before the cutoff date (defaults to the period end). Use this to find "
        "patients with the measure's qualifying condition."
    )
    args_schema: Type[BaseModel] = _WithConditionArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(self, snomed_codes: list[str], on_or_before: Optional[str] = None) -> list[str]:
        cutoff = _coerce_date(on_or_before, self._agent._period_end)
        return _run_async(
            self._agent._clinic_data.get_patients_with_condition(list(snomed_codes), cutoff)
        )


class HadQualifyingVisitTool(BaseTool):
    name: str = "had_qualifying_visit"
    description: str = (
        "Given a list of patient ids, return the subset that had at least one qualifying "
        "encounter/visit within the measurement period. Use this to narrow age+condition "
        "patients down to the denominator."
    )
    args_schema: Type[BaseModel] = _PatientIdsArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(self, patient_ids: list[str]) -> list[str]:
        agent = self._agent

        async def _gather():
            results = await asyncio.gather(
                *[
                    agent._clinic_data.had_qualifying_visit(
                        pid, agent._period_start, agent._period_end
                    )
                    for pid in patient_ids
                ]
            )
            return [pid for pid, ok in zip(patient_ids, results) if ok]

        return _run_async(_gather())


class MostRecentObservationTool(BaseTool):
    name: str = "most_recent_observation"
    description: str = (
        "Given a list of patient ids and LOINC codes, return a mapping {patient_id: value} "
        "for each patient's most recent matching observation within the measurement period. "
        "Patients with no matching observation map to null. Use this to read lab/vital values "
        "for numerator classification."
    )
    args_schema: Type[BaseModel] = _ObservationArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(self, patient_ids: list[str], loinc_codes: list[str]) -> dict[str, Optional[float]]:
        agent = self._agent
        codes = list(loinc_codes)

        async def _gather():
            obs = await asyncio.gather(
                *[
                    agent._clinic_data.get_most_recent_observation(
                        pid, codes, agent._period_start, agent._period_end
                    )
                    for pid in patient_ids
                ]
            )
            out: dict[str, Optional[float]] = {}
            for pid, row in zip(patient_ids, obs):
                out[pid] = _as_float(row["value"]) if row else None
            return out

        return _run_async(_gather())


class PairedObservationTool(BaseTool):
    name: str = "paired_observation"
    description: str = (
        "Given a list of patient ids, primary LOINC codes, and secondary LOINC codes, return "
        "a mapping {patient_id: [primary_value, secondary_value]} taken from the most recent "
        "date on which BOTH a primary and a secondary observation exist within the period "
        "(e.g. systolic + diastolic blood pressure on the same date). Patients with no such "
        "paired reading map to null."
    )
    args_schema: Type[BaseModel] = _PairedObservationArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(
        self,
        patient_ids: list[str],
        primary_loinc: list[str],
        secondary_loinc: list[str],
    ) -> dict[str, Optional[list[float]]]:
        agent = self._agent
        primary = list(primary_loinc)
        secondary = list(secondary_loinc)

        async def _for_patient(pid: str) -> Optional[list[float]]:
            prim_obs, sec_obs = await asyncio.gather(
                agent._clinic_data.get_observations_in_period(
                    pid, primary, agent._period_start, agent._period_end
                ),
                agent._clinic_data.get_observations_in_period(
                    pid, secondary, agent._period_start, agent._period_end
                ),
            )
            prim_by_date: dict[date, float] = {}
            for o in prim_obs:
                v = _as_float(o["value"])
                if v is not None:
                    prim_by_date[_norm_date(o["date"])] = v
            sec_by_date: dict[date, float] = {}
            for o in sec_obs:
                v = _as_float(o["value"])
                if v is not None:
                    sec_by_date[_norm_date(o["date"])] = v
            shared = sorted(set(prim_by_date) & set(sec_by_date), reverse=True)
            if not shared:
                return None
            most_recent = shared[0]
            return [prim_by_date[most_recent], sec_by_date[most_recent]]

        async def _gather():
            pairs = await asyncio.gather(*[_for_patient(pid) for pid in patient_ids])
            return {pid: pair for pid, pair in zip(patient_ids, pairs)}

        return _run_async(_gather())


class PatientHasConditionTool(BaseTool):
    name: str = "patient_has_condition"
    description: str = (
        "Given a list of patient ids and SNOMED codes, return the subset of patients who have "
        "any of those conditions active on or before the period end. Use this to identify "
        "denominator exclusions."
    )
    args_schema: Type[BaseModel] = _HasConditionArgs
    _agent: "SwarmAgent" = PrivateAttr()

    def __init__(self, agent: "SwarmAgent", **kwargs):
        super().__init__(**kwargs)
        self._agent = agent

    def _run(self, patient_ids: list[str], snomed_codes: list[str]) -> list[str]:
        agent = self._agent
        codes = list(snomed_codes)

        async def _gather():
            results = await asyncio.gather(
                *[
                    agent._clinic_data.patient_has_condition(pid, codes, agent._period_end)
                    for pid in patient_ids
                ]
            )
            return [pid for pid, ok in zip(patient_ids, results) if ok]

        return _run_async(_gather())


# ── crew prompts ─────────────────────────────────────────────────────────────

_PLAN_TASK_DESCRIPTION = (
    "Measurement period: {start} to {end}\n\n"
    "Measure spec:\n{spec}\n\n"
    "Produce the query plan as a single JSON object with EXACTLY these fields: "
    "age_min (int), age_max (int), condition_snomed_codes (list of strings), "
    "condition_onset_before (YYYY-MM-DD or null), primary_loinc_codes (list of strings), "
    "secondary_loinc_codes (list of strings), paired_obs_required (bool), "
    "primary_threshold (number or null), primary_direction (\"gt\" or \"lt\"), "
    "secondary_threshold (number or null), secondary_direction (\"gt\" or \"lt\"), "
    "numerator_if_no_primary_obs (bool), inverse_measure (bool), "
    "exclusion_snomed_codes (list of strings). "
    "Use ONLY codes that appear in the spec; never invent codes."
)

_WORK_TASK_DESCRIPTION = (
    "Using the query plan from the previous task and ONLY the provided tools, compute the "
    "measure. Steps: "
    "(1) call get_patients_in_age_range for the plan's age range to get age-eligible patients. "
    "(2) call get_patients_with_condition for the plan's condition codes; intersect with the "
    "age-eligible set. "
    "(3) call had_qualifying_visit on that intersection; the returned subset is the DENOMINATOR. "
    "(4) call patient_has_condition on the denominator with the plan's exclusion codes (if any); "
    "the returned subset is EXCLUDED. The active denominator is denominator minus excluded. "
    "(5) classify the active denominator into the NUMERATOR using the plan's thresholds and "
    "direction. If paired_obs_required is true, use paired_observation (numerator when both "
    "primary and secondary values satisfy their thresholds/directions); otherwise use "
    "most_recent_observation (numerator when the value satisfies primary_threshold/"
    "primary_direction). When a patient has no observation, count them in the numerator only if "
    "numerator_if_no_primary_obs is true. "
    "Pass patient ids to the tools as LISTS — never one patient at a time. "
    "Return ONLY a JSON object of the form "
    '{"denominator": [...], "numerator": [...], "excluded": [...]} where each value is a list '
    "of patient id strings. Never fabricate patient ids — use only ids returned by the tools."
)


class SwarmAgent:
    def __init__(self):
        self.last_input_tokens = 0
        self.last_output_tokens = 0
        # Populated by solve() before the crew runs; read by the tools.
        self._clinic_data: Optional["ClinicDataLayer"] = None
        self._period_start: Optional[date] = None
        self._period_end: Optional[date] = None

    async def solve(
        self,
        measure_id: str,
        spec_text: str,
        clinic_data: "ClinicDataLayer",
        measurement_start: str,
        measurement_end: str,
    ) -> MeasureResult:
        """
        Re-solves from scratch every call — no persistence, no reuse.
        Returns MeasureResult with denominator/numerator/excluded patient_id lists.
        """
        self._clinic_data = clinic_data
        self._period_start = date.fromisoformat(measurement_start)
        self._period_end = date.fromisoformat(measurement_end)
        self.last_input_tokens = 0
        self.last_output_tokens = 0

        # Offload the entire blocking CrewAI run to a worker thread so the harness
        # event loop is never blocked by crew.kickoff().
        result = await asyncio.to_thread(
            self._run_crew_blocking, spec_text, measurement_start, measurement_end
        )

        denominator, numerator, excluded = result
        return MeasureResult(
            denominator=denominator,
            numerator=numerator,
            excluded=excluded,
            tokens_used=self.last_input_tokens + self.last_output_tokens,
        )

    # ── crew (runs entirely inside a worker thread) ──────────────────────────

    def _build_crew(self, spec_text: str) -> Crew:
        llm = LLM(
            model=_CREW_MODEL,
            api_key=settings.anthropic_api_key,
            max_tokens=2048,
            temperature=0.2,
        )

        planner = Agent(
            role="Clinical Quality Measure Analyst",
            goal=(
                "Read a quality-measure spec and produce a precise, structured query plan "
                "(age range, condition SNOMED codes, onset cutoff, LOINC codes, thresholds, "
                "directions, paired-observation flag, missing-observation rule, exclusions)."
            ),
            backstory=(
                "You translate CMS measure specs into executable query plans. You never invent "
                "codes; you use only the codes in the spec."
            ),
            llm=llm,
            tools=[],
            verbose=False,
            allow_delegation=False,
        )

        worker = Agent(
            role="Clinical Data Worker",
            goal=(
                "Execute the planner's query plan against the clinic data tools and return the "
                "final denominator, numerator, and excluded patient-id lists as JSON."
            ),
            backstory=(
                "You run database queries via the provided tools and apply the plan's logic "
                "exactly. You only use the tools; you never fabricate patient ids."
            ),
            llm=llm,
            tools=[
                GetPatientsInAgeRangeTool(self),
                GetPatientsWithConditionTool(self),
                HadQualifyingVisitTool(self),
                MostRecentObservationTool(self),
                PairedObservationTool(self),
                PatientHasConditionTool(self),
            ],
            verbose=False,
            allow_delegation=False,
        )

        plan_task = Task(
            description=_PLAN_TASK_DESCRIPTION,
            expected_output="A single JSON object with exactly the requested fields.",
            agent=planner,
        )
        work_task = Task(
            description=_WORK_TASK_DESCRIPTION,
            expected_output='JSON: {"denominator":[...],"numerator":[...],"excluded":[...]}',
            agent=worker,
            context=[plan_task],
        )

        return Crew(
            agents=[planner, worker],
            tasks=[plan_task, work_task],
            process=Process.sequential,
            verbose=False,
        )

    def _run_crew_blocking(
        self, spec_text: str, measurement_start: str, measurement_end: str
    ) -> tuple[list[str], list[str], list[str]]:
        crew = self._build_crew(spec_text)
        out = crew.kickoff(
            inputs={
                "start": measurement_start,
                "end": measurement_end,
                "spec": spec_text,
            }
        )

        self._record_tokens(crew, out)

        text = getattr(out, "raw", None) or str(out)
        denominator, numerator, excluded = self._parse_worker_output(text)

        # Enforce subset invariants: numerator/excluded must be within denominator so a
        # hallucinated id can't inflate scores.
        denom_set = set(denominator)
        denominator = list(dict.fromkeys(denominator))
        numerator = [p for p in dict.fromkeys(numerator) if p in denom_set]
        excluded = [p for p in dict.fromkeys(excluded) if p in denom_set]
        return denominator, numerator, excluded

    def _record_tokens(self, crew: Crew, out) -> None:
        um = getattr(crew, "usage_metrics", None)
        if um is not None:
            self.last_input_tokens = int(getattr(um, "prompt_tokens", 0) or 0)
            self.last_output_tokens = int(getattr(um, "completion_tokens", 0) or 0)
            if self.last_input_tokens or self.last_output_tokens:
                return
        # Fallback: some versions expose token_usage on the CrewOutput.
        tu = getattr(out, "token_usage", None)
        if tu is not None:
            self.last_input_tokens = int(getattr(tu, "prompt_tokens", 0) or 0)
            self.last_output_tokens = int(getattr(tu, "completion_tokens", 0) or 0)
            if self.last_input_tokens or self.last_output_tokens:
                return
        logger.warning("CrewAI usage metrics unavailable; reporting 0 tokens for this run.")

    @staticmethod
    def _parse_worker_output(text: str) -> tuple[list[str], list[str], list[str]]:
        match = re.search(r"\{[\s\S]*\}", text or "")
        raw = match.group() if match else (text or "")
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return [], [], []
        if not isinstance(parsed, dict):
            return [], [], []

        def _ids(key: str) -> list[str]:
            val = parsed.get(key)
            if not isinstance(val, list):
                return []
            return [s for item in val if item is not None and (s := str(item).strip())]

        return _ids("denominator"), _ids("numerator"), _ids("excluded")
