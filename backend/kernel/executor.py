"""
Executor: runs an installed Capability's logic against the REAL ClinicDataLayer.

This is the production counterpart to verifier._sandbox_run — same restricted
namespace, but the mock data layer is swapped for the live one and the inputs
are real. The scope check is re-run here as defense in depth: a capability could
have been mutated in the registry between verification and execution, so we never
trust that "verified" means "still safe".
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from backend.data.clinic_data import ClinicDataLayer
from backend.kernel.verifier import (
    _scope_check,
    ScopeViolation,
    VerificationError,
    SAFE_BUILTINS,
)
from backend.schemas import Capability


class ExecutionError(Exception):
    """Raised when a capability fails scope check, compilation, or execution."""
    pass


# Restricted builtins for exec'd logic. Imported directly from the verifier so
# the live-run namespace is byte-for-byte identical to the one logic was
# verified against — they can never drift.
def _restricted_builtins() -> dict[str, Any]:
    return dict(SAFE_BUILTINS)


class Executor:
    async def execute(
        self,
        capability: Capability,
        inputs: dict,
        clinic_data: ClinicDataLayer,
    ) -> dict:
        # Defense in depth: re-verify scope before exec'ing untrusted code.
        try:
            _scope_check(capability.logic)
        except (ScopeViolation, VerificationError) as e:
            raise ExecutionError(f"Scope check failed at execution time: {e}")

        from datetime import date, datetime

        namespace: dict[str, Any] = {
            "__builtins__": _restricted_builtins(),
            "date": date,
            "datetime": datetime,
        }

        try:
            exec(compile(capability.logic, "<capability>", "exec"), namespace)  # noqa: S102
        except Exception as e:
            raise ExecutionError(f"Failed to compile capability logic: {e}")

        run_fn = namespace.get("run")
        if not callable(run_fn):
            raise ExecutionError("Capability logic has no callable `run` function")

        start = time.perf_counter()
        try:
            result = await run_fn(clinic_data, inputs)
        except Exception as e:
            raise ExecutionError(f"Capability execution raised: {e}")
        latency_ms = (time.perf_counter() - start) * 1000.0

        if not isinstance(result, dict):
            raise ExecutionError(
                f"Capability run() must return a dict, got {type(result).__name__}"
            )
        if "rows" not in result or "count" not in result:
            raise ExecutionError(
                "Capability result must contain 'rows' and 'count' keys"
            )

        result["latency_ms"] = latency_ms
        return result
