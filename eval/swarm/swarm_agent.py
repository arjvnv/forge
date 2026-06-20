"""
Multi-agent swarm baseline for the MSB eval.

Architecture:
- Planner agent (Claude): reads spec_text, extracts a structured JSON query plan
- Worker (Python): executes the plan against ClinicDataLayer — calls the same data methods
  Forge uses, but with parameters re-derived fresh every run from the planner's output

The ONLY difference from Forge: no persistence, no verification artifact.
The swarm re-solves from scratch on every call, so the planner's natural variance
(missed exclusion codes, threshold ambiguities, LOINC interpretation) accumulates
across K runs and shows up in the consistency metric.

The swarm gets the full spec_text so the comparison is fair — same information,
different mechanism.
"""
from __future__ import annotations
import json
import re
import time
from datetime import date, datetime
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer
from backend.schemas import MeasureResult
from backend.config import settings

# Planner plan schema (JSON fields the planner must emit)
_PLANNER_SYSTEM = """\
You are a clinical quality measure analyst. Given a measure specification and measurement period,
extract a JSON query plan with EXACTLY these fields:

{
  "age_min": <int>,
  "age_max": <int>,
  "condition_snomed_codes": [<string>, ...],
  "condition_onset_before": <"YYYY-MM-DD" or null>,
  "primary_loinc_codes": [<string>, ...],
  "secondary_loinc_codes": [<string>, ...],
  "paired_obs_required": <bool>,
  "primary_threshold": <float or null>,
  "primary_direction": <"gt" or "lt" or null>,
  "secondary_threshold": <float or null>,
  "secondary_direction": <"gt" or "lt" or null>,
  "numerator_if_no_primary_obs": <bool>,
  "inverse_measure": <bool>,
  "exclusion_snomed_codes": [<string>, ...]
}

Rules:
- paired_obs_required: true when the measure needs two LOINC codes on the same date (e.g. systolic + diastolic BP)
- inverse_measure: true when numerator = poor outcome (lower rate is better)
- numerator_if_no_primary_obs: true when a missing observation counts as the bad outcome
- condition_onset_before: ISO date string if the spec restricts when the condition must have started, else null
- Return ONLY the JSON object, no explanation or markdown."""


def _norm_date(d) -> date:
    """Normalize asyncpg date/datetime to datetime.date."""
    if isinstance(d, datetime):
        return d.date()
    return d


class SwarmAgent:
    def __init__(self):
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
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
        Returns MeasureResult with denominator/numerator/excluded patient_id lists.
        """
        period_start = date.fromisoformat(measurement_start)
        period_end = date.fromisoformat(measurement_end)

        # Planner agent: extract query parameters from spec (fresh LLM call every run)
        plan = await self._plan(spec_text, measurement_start, measurement_end)

        # Worker: execute the plan against the data layer
        denominator, numerator, excluded = await self._execute_plan(
            plan, clinic_data, period_start, period_end
        )

        return MeasureResult(
            denominator=denominator,
            numerator=numerator,
            excluded=excluded,
            tokens_used=self.last_input_tokens + self.last_output_tokens,
        )

    # ── planner ────────────────────────────────────────────────────────────

    async def _plan(
        self, spec_text: str, measurement_start: str, measurement_end: str
    ) -> dict:
        """
        Planner agent: call Claude to extract a structured query plan from spec_text.
        Called fresh every solve() — this is the source of the swarm's natural variance.
        """
        user_msg = (
            f"Measurement period: {measurement_start} to {measurement_end}\n\n"
            f"Measure spec:\n{spec_text}"
        )

        response = await self._client.messages.create(
            model=settings.forge_route_model,
            max_tokens=1024,
            system=_PLANNER_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )

        self.last_input_tokens += response.usage.input_tokens
        self.last_output_tokens += response.usage.output_tokens

        content = response.content[0].text.strip()
        json_match = re.search(r"\{[\s\S]*\}", content)
        return json.loads(json_match.group() if json_match else content)

    # ── worker ─────────────────────────────────────────────────────────────

    async def _execute_plan(
        self,
        plan: dict,
        clinic_data: "ClinicDataLayer",
        period_start: date,
        period_end: date,
    ) -> tuple[list[str], list[str], list[str]]:
        """
        Worker: execute the planner's query plan against ClinicDataLayer.
        Uses only the same data-layer methods the reference implementations use.
        """
        # Age-eligible patients
        age_rows = await clinic_data.get_patients_in_age_range(
            plan["age_min"], plan["age_max"], period_end
        )
        age_ids = {r["id"] for r in age_rows}

        # Patients with the required condition
        onset_cutoff = (
            date.fromisoformat(plan["condition_onset_before"])
            if plan.get("condition_onset_before")
            else period_end
        )
        condition_ids = set(
            await clinic_data.get_patients_with_condition(
                plan["condition_snomed_codes"], onset_cutoff
            )
        )

        # Denominator: age + condition + qualifying visit
        denominator: list[str] = []
        for pid in age_ids & condition_ids:
            if await clinic_data.had_qualifying_visit(pid, period_start, period_end):
                denominator.append(pid)

        # Exclusions
        excluded: list[str] = []
        exclusion_codes = plan.get("exclusion_snomed_codes") or []
        if exclusion_codes:
            excl_set: set[str] = set()
            for pid in denominator:
                if await clinic_data.patient_has_condition(pid, exclusion_codes, period_end):
                    excl_set.add(pid)
            excluded = list(excl_set)

        active_denom = [p for p in denominator if p not in set(excluded)]

        # Numerator
        numerator = await self._classify_numerator(plan, active_denom, clinic_data, period_start, period_end)

        return denominator, numerator, excluded

    async def _classify_numerator(
        self,
        plan: dict,
        active_denom: list[str],
        clinic_data: "ClinicDataLayer",
        period_start: date,
        period_end: date,
    ) -> list[str]:
        primary_loinc: list[str] = plan.get("primary_loinc_codes") or []
        secondary_loinc: list[str] = plan.get("secondary_loinc_codes") or []
        paired: bool = plan.get("paired_obs_required", False)
        numerator_if_missing: bool = plan.get("numerator_if_no_primary_obs", False)
        p_threshold = plan.get("primary_threshold")
        p_direction: str = plan.get("primary_direction") or "gt"
        s_threshold = plan.get("secondary_threshold")
        s_direction: str = plan.get("secondary_direction") or "lt"

        numerator: list[str] = []

        for pid in active_denom:
            if paired and secondary_loinc:
                in_num = await self._check_paired_obs(
                    pid, clinic_data, period_start, period_end,
                    primary_loinc, secondary_loinc,
                    p_threshold, p_direction, s_threshold, s_direction,
                    numerator_if_missing,
                )
            else:
                in_num = await self._check_single_obs(
                    pid, clinic_data, period_start, period_end,
                    primary_loinc, p_threshold, p_direction, numerator_if_missing,
                )
            if in_num:
                numerator.append(pid)

        return numerator

    async def _check_single_obs(
        self,
        pid: str,
        clinic_data: "ClinicDataLayer",
        period_start: date,
        period_end: date,
        loinc: list[str],
        threshold,
        direction: str,
        numerator_if_missing: bool,
    ) -> bool:
        obs = await clinic_data.get_most_recent_observation(
            pid, loinc, period_start, period_end
        )
        if obs is None:
            return numerator_if_missing
        try:
            value = float(obs["value"])
        except (TypeError, ValueError):
            return numerator_if_missing
        if threshold is None:
            return False
        return value > threshold if direction == "gt" else value < threshold

    async def _check_paired_obs(
        self,
        pid: str,
        clinic_data: "ClinicDataLayer",
        period_start: date,
        period_end: date,
        primary_loinc: list[str],
        secondary_loinc: list[str],
        p_threshold,
        p_direction: str,
        s_threshold,
        s_direction: str,
        numerator_if_missing: bool,
    ) -> bool:
        sys_obs = await clinic_data.get_observations_in_period(
            pid, primary_loinc, period_start, period_end
        )
        dia_obs = await clinic_data.get_observations_in_period(
            pid, secondary_loinc, period_start, period_end
        )

        sys_by_date: dict[date, float] = {}
        for o in sys_obs:
            try:
                sys_by_date[_norm_date(o["date"])] = float(o["value"])
            except (TypeError, ValueError):
                pass

        dia_by_date: dict[date, float] = {}
        for o in dia_obs:
            try:
                dia_by_date[_norm_date(o["date"])] = float(o["value"])
            except (TypeError, ValueError):
                pass

        paired_dates = sorted(
            set(sys_by_date.keys()) & set(dia_by_date.keys()), reverse=True
        )
        if not paired_dates:
            return numerator_if_missing

        most_recent = paired_dates[0]
        p_val = sys_by_date[most_recent]
        s_val = dia_by_date[most_recent]

        p_ok = (p_val < p_threshold) if p_direction == "lt" else (p_val > p_threshold)
        s_ok = (s_val < s_threshold) if s_direction == "lt" else (s_val > s_threshold)
        return p_ok and s_ok
