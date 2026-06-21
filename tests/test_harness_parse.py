"""
Unit tests for the Forge harness SSE/result parse helpers.

These import eval.harness, which transitively imports the CrewAI baseline, so they
only run under the 3.11 eval venv (.venv-eval) where crewai is installed. Under the
backend 3.14 venv the module is skipped at import time rather than failing collection.

Run:  /Users/arjunvivek/forge/.venv-eval/bin/python -m pytest tests/test_harness_parse.py
"""
from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("OPENAI_API_KEY", "")

import pytest

harness = pytest.importorskip(
    "eval.harness",
    reason="eval.harness needs the crewai eval venv (.venv-eval); skipped elsewhere",
)

_parse_sse_line = harness._parse_sse_line
_parse_forge_result = harness._parse_forge_result
_forge_intent_text = harness._forge_intent_text


# ── _parse_sse_line ──────────────────────────────────────────────────────────


def test_parse_sse_line_synthesized():
    line = 'data: {"stage":"synthesized","payload":{"input_tokens":10,"output_tokens":5}}'
    event = _parse_sse_line(line)
    assert event["stage"] == "synthesized"
    assert event["payload"]["input_tokens"] == 10
    assert event["payload"]["output_tokens"] == 5


def test_parse_sse_line_done_with_result():
    line = (
        'data: {"stage":"done","payload":{"result":'
        '{"rows":[{"patient_id":"p1","classification":"numerator"}],"count":1}}}'
    )
    event = _parse_sse_line(line)
    assert event["stage"] == "done"
    assert event["payload"]["result"]["count"] == 1


def test_parse_sse_line_blank_and_non_data_return_none():
    assert _parse_sse_line("") is None
    assert _parse_sse_line("\n") is None
    assert _parse_sse_line(": keep-alive comment") is None
    assert _parse_sse_line("event: message") is None
    assert _parse_sse_line("data:") is None  # data prefix but empty body
    assert _parse_sse_line("data: ") is None


def test_parse_sse_line_malformed_json_returns_none():
    assert _parse_sse_line("data: {not valid json") is None


def test_parse_sse_line_strips_leading_whitespace():
    assert _parse_sse_line('  data: {"stage":"routing"}  ')["stage"] == "routing"


# ── _parse_forge_result ──────────────────────────────────────────────────────


def test_parse_forge_result_each_classification():
    result = {
        "rows": [
            {"patient_id": "p1", "classification": "numerator"},
            {"patient_id": "p2", "classification": "denominator_only"},
            {"patient_id": "p3", "classification": "excluded"},
        ],
        "count": 3,
    }
    mr = _parse_forge_result(result)
    assert set(mr.denominator) == {"p1", "p2", "p3"}
    assert mr.numerator == ["p1"]
    assert mr.excluded == ["p3"]


def test_parse_forge_result_missing_classification_defaults_denominator_only():
    result = {"rows": [{"patient_id": "p1"}], "count": 1}
    mr = _parse_forge_result(result)
    assert mr.denominator == ["p1"]
    assert mr.numerator == []
    assert mr.excluded == []


def test_parse_forge_result_bare_id_rows_are_skipped():
    # Rows that aren't dicts (e.g. bare ids) are ignored, not crashed on.
    result = {"rows": ["p1", "p2"], "count": 2}
    mr = _parse_forge_result(result)
    assert mr.denominator == []


def test_parse_forge_result_dedups_ids():
    result = {
        "rows": [
            {"patient_id": "p1", "classification": "numerator"},
            {"patient_id": "p1", "classification": "numerator"},
        ],
        "count": 2,
    }
    mr = _parse_forge_result(result)
    assert mr.denominator == ["p1"]
    assert mr.numerator == ["p1"]


def test_parse_forge_result_enforces_subset_invariant():
    # A numerator id not present as a denominator row must be dropped.
    result = {
        "rows": [
            {"patient_id": "p1", "classification": "denominator_only"},
            {"patient_id": "p2", "classification": "numerator"},
        ],
        "count": 2,
    }
    mr = _parse_forge_result(result)
    assert set(mr.denominator) == {"p1", "p2"}
    assert mr.numerator == ["p2"]  # p2 is in denominator, kept


def test_parse_forge_result_case_insensitive_classification():
    result = {"rows": [{"patient_id": "p1", "classification": "NUMERATOR"}], "count": 1}
    mr = _parse_forge_result(result)
    assert mr.numerator == ["p1"]


def test_parse_forge_result_non_dict_input_is_empty():
    mr = _parse_forge_result(None)  # type: ignore[arg-type]
    assert mr.denominator == [] and mr.numerator == [] and mr.excluded == []


def test_parse_forge_result_blank_patient_id_skipped():
    result = {"rows": [{"patient_id": "  ", "classification": "numerator"}], "count": 1}
    mr = _parse_forge_result(result)
    assert mr.denominator == []


# ── _forge_intent_text ───────────────────────────────────────────────────────


def test_forge_intent_text_appends_contract():
    spec = "CMS122 spec body"
    out = _forge_intent_text(spec)
    assert out.startswith(spec)
    assert "classification" in out
    assert "denominator" in out
