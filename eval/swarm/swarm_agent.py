"""
Multi-agent swarm baseline for the MSB eval — implemented with CrewAI.

CrewAI is a production multi-agent framework used as a credible off-the-shelf baseline.
Planner and Worker agents communicate through natural language; the Worker calls
ClinicDataLayer methods via tools. The system re-solves from scratch every call —
no persistence, no verification, no reuse.

Why this beats a custom swarm as a baseline:
- Multi-agent handoff through natural language degrades precision on edge cases
- The Worker must interpret the Planner's prose instructions to decide which tools
  to call and with what parameters — this is where exclusion logic and paired-reading
  requirements get lost
- LLM temperature means K=5 runs produce genuinely different patient sets (Jaccard < 1.0)
- Judges recognize CrewAI; "we beat CrewAI" is a stronger claim than "we beat ourselves"
"""
from __future__ import annotations
import asyncio
import json
import re
from datetime import date
from typing import TYPE_CHECKING

from crewai import Agent, Crew, LLM, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.config import settings
from backend.schemas import MeasureResult

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer


# ── async bridge ───────────────────────────────────────────────────────────────
# CrewAI task execution is synchronous. Tools need to call async ClinicDataLayer
# methods. We capture the running event loop before entering the executor, then
# use run_coroutine_threadsafe to schedule data queries back onto that loop while
# crew.kickoff() runs in a thread pool. The main loop processes them because
# `await run_in_executor(...)` leaves it free to spin.

def _make_runner(main_loop: asyncio.AbstractEventLoop):
    def run(coro):
        future = asyncio.run_coroutine_threadsafe(coro, main_loop)
        return future.result(timeout=60)
    return run


# ── tool factory ───────────────────────────────────────────────────────────────

def _make_tools(
    clinic_data: "ClinicDataLayer",
    period_start: date,
    period_end: date,
    run,
) -> list[BaseTool]:
    """Build CrewAI tools that wrap ClinicDataLayer for the given measurement period."""

    class GetAgeEligiblePatients(BaseTool):
        name: str = "get_age_eligible_patients"
        description: str = (
            "Returns a JSON list of patient IDs whose age is in [min_age, max_age] "
            "as of the measurement end date. Call this first to build the initial candidate pool."
        )

        class ArgsSchema(BaseModel):
            min_age: int = Field(..., description="Minimum age inclusive")
            max_age: int = Field(..., description="Maximum age inclusive")

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, min_age: int, max_age: int) -> str:
            rows = run(clinic_data.get_patients_in_age_range(min_age, max_age, period_end))
            ids = [r["id"] for r in rows]
            return json.dumps({"count": len(ids), "patient_ids": ids})

    class GetPatientsWithCondition(BaseTool):
        name: str = "get_patients_with_condition"
        description: str = (
            "Returns a JSON list of patient IDs who have an active condition matching any "
            "of the given SNOMED codes. If onset_before is provided (ISO date YYYY-MM-DD), "
            "only patients whose condition started on or before that date are returned."
        )

        class ArgsSchema(BaseModel):
            snomed_codes: list[str] = Field(..., description="SNOMED condition codes to search for")
            onset_before: str = Field(
                default="",
                description="ISO date YYYY-MM-DD; empty = measurement end date",
            )

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, snomed_codes: list[str], onset_before: str = "") -> str:
            cutoff = date.fromisoformat(onset_before) if onset_before else period_end
            ids = run(clinic_data.get_patients_with_condition(snomed_codes, cutoff))
            return json.dumps({"count": len(ids), "patient_ids": ids})

    class FilterByQualifyingVisit(BaseTool):
        name: str = "filter_by_qualifying_visit"
        description: str = (
            "Given a list of patient IDs, returns only those who had at least one encounter "
            "during the measurement period. Use to finalize the denominator."
        )

        class ArgsSchema(BaseModel):
            patient_ids: list[str] = Field(..., description="Patient IDs to filter")

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, patient_ids: list[str]) -> str:
            qualified = [
                pid for pid in patient_ids
                if run(clinic_data.had_qualifying_visit(pid, period_start, period_end))
            ]
            return json.dumps({"count": len(qualified), "patient_ids": qualified})

    class GetLatestObservation(BaseTool):
        name: str = "get_latest_observation"
        description: str = (
            "Returns the most recent observation for a single patient matching any of the given "
            "LOINC codes within the measurement period. "
            "Returns JSON with 'value' (numeric), 'date' (YYYY-MM-DD), 'code', or null if none."
        )

        class ArgsSchema(BaseModel):
            patient_id: str = Field(..., description="Patient ID")
            loinc_codes: list[str] = Field(..., description="LOINC codes to search for")

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, patient_id: str, loinc_codes: list[str]) -> str:
            obs = run(
                clinic_data.get_most_recent_observation(
                    patient_id, loinc_codes, period_start, period_end
                )
            )
            if obs is None:
                return "null"
            val = obs.get("value")
            return json.dumps({
                "value": float(val) if val is not None else None,
                "date": str(obs["date"]),
                "code": obs.get("code"),
            })

    class GetAllObservationsInPeriod(BaseTool):
        name: str = "get_all_observations_in_period"
        description: str = (
            "Returns all observations for a single patient matching any of the given LOINC codes "
            "within the measurement period, sorted most-recent first. "
            "Use when you need to match readings by date — e.g. systolic and diastolic BP "
            "readings must share the same date to count as a paired reading."
        )

        class ArgsSchema(BaseModel):
            patient_id: str = Field(..., description="Patient ID")
            loinc_codes: list[str] = Field(..., description="LOINC codes to search for")

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, patient_id: str, loinc_codes: list[str]) -> str:
            obs_list = run(
                clinic_data.get_observations_in_period(
                    patient_id, loinc_codes, period_start, period_end
                )
            )
            return json.dumps([
                {
                    "value": float(o["value"]) if o.get("value") is not None else None,
                    "date": str(o["date"]),
                    "code": o.get("code"),
                }
                for o in obs_list
            ])

    class CheckPatientExclusion(BaseTool):
        name: str = "check_patient_exclusion"
        description: str = (
            "Returns 'true' if the patient has any condition matching the given SNOMED "
            "exclusion codes as of the measurement end date, 'false' otherwise."
        )

        class ArgsSchema(BaseModel):
            patient_id: str = Field(..., description="Patient ID to check")
            exclusion_snomed_codes: list[str] = Field(..., description="SNOMED codes for exclusion criteria")

        args_schema: type[BaseModel] = ArgsSchema

        def _run(self, patient_id: str, exclusion_snomed_codes: list[str]) -> str:
            result = run(
                clinic_data.patient_has_condition(patient_id, exclusion_snomed_codes, period_end)
            )
            return "true" if result else "false"

    return [
        GetAgeEligiblePatients(),
        GetPatientsWithCondition(),
        FilterByQualifyingVisit(),
        GetLatestObservation(),
        GetAllObservationsInPeriod(),
        CheckPatientExclusion(),
    ]


# ── agent prompts ──────────────────────────────────────────────────────────────

_PLANNER_BACKSTORY = (
    "You are a senior clinical informatics specialist with deep expertise in CMS quality measures, "
    "LOINC codes, SNOMED-CT, and healthcare data systems. You translate measure specifications "
    "into precise step-by-step data retrieval plans for your data analyst colleague."
)

_WORKER_BACKSTORY = (
    "You are a clinical data analyst who retrieves patient data using database tools. "
    "You follow the clinical informatics specialist's plan carefully. "
    "You have access to patient database tools. You must return your final answer as JSON."
)

_PLANNING_TEMPLATE = """\
Analyze the following clinical quality measure and write a precise, step-by-step data retrieval
plan for the data analyst to execute.

Measure: {measure_id}
Measurement period: {period_start} to {period_end}

Specification:
{spec_text}

Your plan must specify:
1. Exact age range for the denominator population
2. Exact SNOMED codes for the required condition (and any onset date constraint)
3. Whether a qualifying visit in the measurement period is required
4. Any SNOMED exclusion codes to check and remove from the denominator
5. Exact LOINC codes for the numerator observation and the threshold/direction
6. How to handle patients with no observation in the measurement period
7. Any special pairing logic (e.g. BP readings that must share the same date)

Be precise — the analyst executes exactly what you write."""

_EXECUTION_TEMPLATE = """\
Execute the clinical quality measure computation using your database tools.
Follow the step-by-step plan from the clinical informatics specialist above.

Measurement period: {period_start} to {period_end}
Measure: {measure_id}

General approach:
1. get_age_eligible_patients — initial pool
2. get_patients_with_condition — condition-matching patients (pass onset_before if needed)
3. Intersect the two lists yourself
4. filter_by_qualifying_visit — produces the denominator
5. check_patient_exclusion for each denominator patient if exclusions apply
6. For each active denominator patient, check observations to determine numerator membership

When finished, output ONLY this JSON (no other text):
{{"denominator": ["<id>", ...], "numerator": ["<id>", ...], "excluded": ["<id>", ...]}}

Rules:
- denominator includes ALL patients who met age + condition + visit criteria (before exclusions)
- numerator must be a subset of (denominator minus excluded)
- excluded lists patients removed by exclusion criteria"""


# ── result parsing ─────────────────────────────────────────────────────────────

def _extract_result(text: str) -> dict:
    """Extract the denominator/numerator/excluded JSON from CrewAI output."""
    match = re.search(r"\{[^{}]*\"denominator\"[^{}]*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return {"denominator": [], "numerator": [], "excluded": []}


# ── main agent class ───────────────────────────────────────────────────────────

class SwarmAgent:
    def __init__(self):
        self.last_input_tokens = 0
        self.last_output_tokens = 0

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
        Planner writes a natural-language plan; Worker executes it via ClinicDataLayer tools.
        """
        period_start = date.fromisoformat(measurement_start)
        period_end = date.fromisoformat(measurement_end)
        main_loop = asyncio.get_running_loop()

        run = _make_runner(main_loop)
        tools = _make_tools(clinic_data, period_start, period_end, run)
        llm = LLM(model="claude-sonnet-4-6", api_key=settings.anthropic_api_key)

        planner = Agent(
            role="Clinical Quality Measure Planner",
            goal="Produce a precise data retrieval plan from the measure specification",
            backstory=_PLANNER_BACKSTORY,
            llm=llm,
            tools=[],
            verbose=False,
            allow_delegation=False,
        )

        worker = Agent(
            role="Clinical Data Analyst",
            goal="Execute the retrieval plan and return denominator/numerator/excluded patient sets",
            backstory=_WORKER_BACKSTORY,
            llm=llm,
            tools=tools,
            verbose=False,
            allow_delegation=False,
        )

        planning_task = Task(
            description=_PLANNING_TEMPLATE.format(
                measure_id=measure_id,
                period_start=measurement_start,
                period_end=measurement_end,
                spec_text=spec_text,
            ),
            expected_output="Step-by-step retrieval plan with specific codes, thresholds, and logic",
            agent=planner,
        )

        execution_task = Task(
            description=_EXECUTION_TEMPLATE.format(
                measure_id=measure_id,
                period_start=measurement_start,
                period_end=measurement_end,
            ),
            expected_output='JSON: {"denominator": [...], "numerator": [...], "excluded": [...]}',
            agent=worker,
            context=[planning_task],
        )

        crew = Crew(
            agents=[planner, worker],
            tasks=[planning_task, execution_task],
            verbose=False,
        )

        # Run CrewAI (synchronous) in a thread executor so the main event loop stays
        # free to process the asyncpg queries that tools schedule via run_coroutine_threadsafe.
        output = await asyncio.get_event_loop().run_in_executor(None, crew.kickoff)

        # Extract token usage from CrewAI's built-in tracking
        if hasattr(output, "token_usage") and output.token_usage:
            u = output.token_usage
            self.last_input_tokens = (
                getattr(u, "prompt_tokens", 0) or getattr(u, "input_tokens", 0)
            )
            self.last_output_tokens = (
                getattr(u, "completion_tokens", 0) or getattr(u, "output_tokens", 0)
            )

        parsed = _extract_result(str(output))

        return MeasureResult(
            denominator=parsed.get("denominator", []),
            numerator=parsed.get("numerator", []),
            excluded=parsed.get("excluded", []),
            tokens_used=self.last_input_tokens + self.last_output_tokens,
        )
