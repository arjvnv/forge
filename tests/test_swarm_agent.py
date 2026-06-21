"""
Unit tests for the CrewAI swarm baseline's pure-Python parsing/invariant logic.

These import the crewai-backed swarm module, so they only run under the 3.11 eval
venv (.venv-eval). Under the backend 3.14 venv the module is skipped at import time.

Run:  /Users/arjunvivek/forge/.venv-eval/bin/python -m pytest tests/test_swarm_agent.py
"""
from __future__ import annotations

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("OPENAI_API_KEY", "")

import pytest

swarm = pytest.importorskip(
    "eval.swarm.swarm_agent",
    reason="needs the crewai eval venv (.venv-eval); skipped elsewhere",
)

SwarmAgent = swarm.SwarmAgent


# ── _parse_worker_output ─────────────────────────────────────────────────────


def test_parse_worker_output_clean_json():
    text = '{"denominator":["p1","p2"],"numerator":["p1"],"excluded":["p2"]}'
    d, n, e = SwarmAgent._parse_worker_output(text)
    assert d == ["p1", "p2"]
    assert n == ["p1"]
    assert e == ["p2"]


def test_parse_worker_output_embedded_in_prose():
    text = 'Here is the result:\n{"denominator":["p1"],"numerator":[],"excluded":[]}\nDone.'
    d, n, e = SwarmAgent._parse_worker_output(text)
    assert d == ["p1"]
    assert n == [] and e == []


def test_parse_worker_output_malformed_returns_empty():
    d, n, e = SwarmAgent._parse_worker_output("not json at all")
    assert d == [] and n == [] and e == []


def test_parse_worker_output_coerces_and_strips_ids():
    text = '{"denominator":[1, " p2 ", null],"numerator":[],"excluded":[]}'
    d, _, _ = SwarmAgent._parse_worker_output(text)
    assert d == ["1", "p2"]  # ints coerced to str, whitespace stripped, null dropped


def test_parse_worker_output_missing_keys_default_empty():
    d, n, e = SwarmAgent._parse_worker_output('{"denominator":["p1"]}')
    assert d == ["p1"]
    assert n == [] and e == []


# ── subset invariants in _run_crew_blocking (via a fake crew) ────────────────


class _FakeUsage:
    prompt_tokens = 100
    completion_tokens = 40


class _FakeOutput:
    def __init__(self, raw: str):
        self.raw = raw


class _FakeCrew:
    """Minimal stand-in: kickoff returns canned worker output; usage_metrics set."""

    def __init__(self, raw: str):
        self._raw = raw
        self.usage_metrics = _FakeUsage()

    def kickoff(self, inputs=None):
        return _FakeOutput(self._raw)


def test_run_crew_blocking_enforces_subset_and_records_tokens(monkeypatch):
    agent = SwarmAgent()
    # numerator/excluded contain ids NOT in denominator -> must be dropped.
    raw = (
        '{"denominator":["p1","p2"],'
        '"numerator":["p1","ghost"],'
        '"excluded":["p2","phantom"]}'
    )
    monkeypatch.setattr(agent, "_build_crew", lambda spec_text: _FakeCrew(raw))

    d, n, e = agent._run_crew_blocking("spec", "2023-01-01", "2023-12-31")
    assert set(d) == {"p1", "p2"}
    assert n == ["p1"]  # ghost dropped (not in denominator)
    assert e == ["p2"]  # phantom dropped
    assert agent.last_input_tokens == 100
    assert agent.last_output_tokens == 40


def test_record_tokens_falls_back_to_zero_without_metrics():
    agent = SwarmAgent()

    class _NoMetricsCrew:
        usage_metrics = None

    class _NoTokenOut:
        token_usage = None

    agent._record_tokens(_NoMetricsCrew(), _NoTokenOut())
    assert agent.last_input_tokens == 0
    assert agent.last_output_tokens == 0
