import pytest

from backend.kernel.executor import Executor, ExecutionError
from tests.conftest import (
    BAD_SHAPE_LOGIC,
    MALICIOUS_LOGIC,
    make_capability,
)

pytestmark = pytest.mark.asyncio


async def test_execute_returns_rows_count_and_latency(clinic):
    cap = make_capability()
    result = await Executor().execute(cap, {"measurement_year": 2023}, clinic)

    assert result["count"] == 3
    assert result["rows"] == [{"patient_id": p} for p in ["p1", "p2", "p3"]]
    assert "latency_ms" in result
    assert isinstance(result["latency_ms"], float)
    assert result["latency_ms"] >= 0.0


async def test_execute_rejects_scope_violation(clinic):
    # Scope check must reject imports even though "verified" — defense in depth.
    cap = make_capability(logic=MALICIOUS_LOGIC)
    with pytest.raises(ExecutionError) as ei:
        await Executor().execute(cap, {"measurement_year": 2023}, clinic)
    assert "Scope check failed" in str(ei.value)


async def test_execute_rejects_bad_result_shape(clinic):
    cap = make_capability(logic=BAD_SHAPE_LOGIC)
    with pytest.raises(ExecutionError) as ei:
        await Executor().execute(cap, {"measurement_year": 2023}, clinic)
    assert "rows" in str(ei.value) and "count" in str(ei.value)


async def test_execute_rejects_non_dict_return(clinic):
    logic = (
        "async def run(clinic_data, inputs):\n"
        "    return [1, 2, 3]\n"
    )
    cap = make_capability(logic=logic)
    with pytest.raises(ExecutionError) as ei:
        await Executor().execute(cap, {"measurement_year": 2023}, clinic)
    assert "must return a dict" in str(ei.value)


async def test_execute_surfaces_runtime_error(clinic):
    logic = (
        "async def run(clinic_data, inputs):\n"
        "    x = 1 / 0\n"
        "    return {'rows': [], 'count': 0}\n"
    )
    cap = make_capability(logic=logic)
    with pytest.raises(ExecutionError) as ei:
        await Executor().execute(cap, {"measurement_year": 2023}, clinic)
    assert "raised" in str(ei.value)
