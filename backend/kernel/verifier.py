"""
Verifier: checks generated logic before it's installed.
Two checks:
1. Scope check — AST scan ensures the logic only calls allowed methods.
2. Sandbox run — executes the logic against a tiny test fixture, confirms it returns the right shape.
"""
from __future__ import annotations
import ast
import asyncio
from typing import Any

# Data-layer methods the generated logic is permitted to call on `clinic_data`.
ALLOWED_DATA_METHODS = {
    "get_patients_in_age_range",
    "get_patients_with_condition",
    "patient_has_condition",
    "get_most_recent_observation",
    "get_observations_in_period",
    "had_qualifying_visit",
    "get_encounters_in_period",
    "patient_has_medication",
    "get_all_patient_ids",
}

# Single source of truth for the builtins available to generated logic. BOTH the
# verifier's sandbox run AND the executor's live run import this exact dict, so
# the two namespaces can never drift apart (a capability that passed
# verification is only safe to run in an identical namespace).
#
# Every entry is a pure, side-effect-free builtin: no IO (open/input), no
# introspection (type/getattr/vars/dir/globals), no code execution
# (eval/exec/compile/__import__). Clinical aggregation logic needs set/sum/
# tuple/round/abs constantly — omitting them was causing legitimate generated
# capabilities to fail verification.
SAFE_BUILTINS = {
    "len": len, "list": list, "dict": dict, "str": str, "int": int,
    "float": float, "bool": bool, "set": set, "tuple": tuple,
    "frozenset": frozenset,
    "abs": abs, "round": round, "sum": sum, "min": min, "max": max,
    "divmod": divmod, "pow": pow,
    "range": range, "enumerate": enumerate, "zip": zip, "sorted": sorted,
    "reversed": reversed, "map": map, "filter": filter,
    "any": any, "all": all,
    "isinstance": isinstance, "print": print,
}

# Bare names the generated logic may reference as an ast.Name. Derived from the
# safe builtins above plus the injected sandbox names and literals. Anything
# else is rejected. This is an allowlist, not a denylist — denylists are
# trivially bypassable.
ALLOWED_NAMES = set(SAFE_BUILTINS) | {
    # injected into the sandbox namespace
    "clinic_data", "inputs", "date", "datetime",
    # literals / control
    "None", "True", "False",
}


class ScopeViolation(Exception):
    pass


class VerificationError(Exception):
    pass


def _scope_check(code: str) -> None:
    """AST walk that fails closed.

    Rejects:
      - any import (generated logic needs none)
      - any attribute access to a dunder (blocks ().__class__ sandbox escapes)
      - any method call on clinic_data outside the data-method allowlist
      - any bare Name reference outside ALLOWED_NAMES
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise VerificationError(f"Syntax error in generated logic: {e}")

    # Names defined locally inside the logic (function/arg/assignment targets,
    # comprehension vars). These are safe to reference even though they are not
    # in ALLOWED_NAMES.
    local_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            # Lambdas have args but no name; named functions have both.
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                local_names.add(node.name)
            for arg in (*node.args.posonlyargs, *node.args.args,
                        *node.args.kwonlyargs):
                local_names.add(arg.arg)
            if node.args.vararg:
                local_names.add(node.args.vararg.arg)
            if node.args.kwarg:
                local_names.add(node.args.kwarg.arg)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            local_names.add(node.id)
        elif isinstance(node, ast.comprehension):
            for t in ast.walk(node.target):
                if isinstance(t, ast.Name):
                    local_names.add(t.id)

    for node in ast.walk(tree):
        # No imports, ever.
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ScopeViolation("Imports are not allowed in generated logic")

        # No dunder attribute access — blocks __class__/__bases__/__subclasses__
        # / __globals__ traversal that defeats the namespace sandbox.
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                raise ScopeViolation(
                    f"Dunder attribute access is forbidden: {node.attr}"
                )

        # Method calls: only allow clinic_data.<allowed_method>(...).
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            target = node.func.value
            method = node.func.attr
            if isinstance(target, ast.Name) and target.id == "clinic_data":
                if method not in ALLOWED_DATA_METHODS:
                    raise ScopeViolation(
                        f"Disallowed data-layer method: {method}"
                    )

        # Bare names must be locals or in the allowlist.
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            if node.id not in ALLOWED_NAMES and node.id not in local_names:
                raise ScopeViolation(
                    f"Reference to disallowed name: {node.id}"
                )


class MockClinicData:
    """Minimal mock that returns safe empty results — used for sandbox run."""
    async def get_patients_in_age_range(self, *a, **kw): return []
    async def get_patients_with_condition(self, *a, **kw): return []
    async def patient_has_condition(self, *a, **kw): return False
    async def get_most_recent_observation(self, *a, **kw): return None
    async def get_observations_in_period(self, *a, **kw): return []
    async def had_qualifying_visit(self, *a, **kw): return False
    async def get_encounters_in_period(self, *a, **kw): return []
    async def patient_has_medication(self, *a, **kw): return False
    async def get_all_patient_ids(self, *a, **kw): return []


async def _sandbox_run(logic: str, inputs: dict) -> dict:
    """Execute the generated `run` function in a restricted namespace."""
    from datetime import date, datetime
    namespace: dict[str, Any] = {
        "__builtins__": dict(SAFE_BUILTINS),
        "date": date,
        "datetime": datetime,
    }
    try:
        exec(compile(logic, "<capability>", "exec"), namespace)  # noqa: S102
    except Exception as e:
        raise VerificationError(f"Failed to compile logic: {e}")

    run_fn = namespace.get("run")
    if not callable(run_fn):
        raise VerificationError("Generated logic has no `run` function")

    mock = MockClinicData()
    try:
        result = await run_fn(mock, inputs)
    except Exception as e:
        raise VerificationError(f"Sandbox run raised: {e}")

    if not isinstance(result, dict):
        raise VerificationError(f"run() must return dict, got {type(result)}")
    return result


async def verify(logic: str, inputs: dict) -> tuple[bool, str]:
    """
    Returns (ok, message).
    Raises nothing — catches all errors and returns False + reason.
    """
    try:
        _scope_check(logic)
    except (ScopeViolation, VerificationError) as e:
        return False, str(e)

    try:
        result = await _sandbox_run(logic, inputs)
    except VerificationError as e:
        return False, str(e)

    return True, f"Verified — sandbox returned {len(result)} top-level keys"
