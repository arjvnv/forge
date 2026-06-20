"""
Multi-agent swarm baseline for the MSB eval.

Steven: implement SwarmAgent.solve() using Claude (Sonnet for planning, same model as Forge).
The swarm gets the same spec_text and same data access as Forge — the ONLY difference
is no persistence and no verification artifact: it re-solves from scratch every run.

Architecture:
- Planner agent: reads spec_text, writes a SQL-like plan
- Worker agent: executes the plan against ClinicDataLayer, returns patient sets

Give the swarm the full spec_text so the comparison is fair (same information, different mechanism).
"""
from __future__ import annotations
import time
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer
from backend.schemas import MeasureResult
from backend.config import settings


class SwarmAgent:
    def __init__(self):
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
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
        # TODO (Steven): implement planner → worker multi-agent loop
        # The planner should reason over spec_text and produce a step-by-step plan.
        # The worker should execute each step using clinic_data methods.
        # Track token usage in self.last_input_tokens / self.last_output_tokens.
        raise NotImplementedError("Steven: implement swarm planner + worker")
