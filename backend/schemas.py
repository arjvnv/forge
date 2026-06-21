"""
Locked schemas (hour 0). Do not change field names without syncing with Steven.
"""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field
import uuid


class Manifest(BaseModel):
    """Capability identity — stored in RedisJSON, embedded for routing."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str  # embedded for semantic routing
    # These are descriptive metadata the synthesizer fills in (never used for
    # execution). Values are dict[str, Any] not dict[str, str]: the model
    # naturally emits real lists/objects here (e.g. output={"columns": [...]}),
    # and rejecting those failed otherwise-valid syntheses on schema validation.
    inputs: dict[str, Any] = {}           # field -> "type = default" (or richer)
    output: dict[str, Any] = {}           # field -> type (or richer)
    reads: list[str] = []                 # data_source_ids
    actions: list[str] = []              # action_ids
    scope: dict[str, Any] = {}           # action_id -> constraint (or richer)
    reuse_count: int = 0
    created_at: str = ""
    built_from: list[dict] = []          # provenance: prior capabilities this was synthesized from


class Capability(BaseModel):
    """Full persisted capability bundle."""
    manifest: Manifest
    logic: str          # generated Python code
    ui_spec: dict       # structured JSON for result rendering
    verified: bool = False


class BuildEvent(BaseModel):
    """Emitted on Redis Stream at each build stage."""
    capability_id: str
    stage: str   # gap | synthesizing | verified | approved | installed | executing | done | error
    message: str = ""
    payload: dict = {}


class MeasureTask(BaseModel):
    """The eval interface — both Forge and the swarm implement this."""
    measure_id: str
    spec_text: str
    expected: dict[str, list[str]] = {}   # denominator/numerator/excluded patient_ids


class MeasureResult(BaseModel):
    denominator: list[str]
    numerator: list[str]
    excluded: list[str]
    tokens_used: int = 0
    latency_ms: float = 0.0


class IntentRequest(BaseModel):
    # Bounds are a DoS/cost guard: text feeds the (unauthenticated) Claude
    # synthesis + OpenAI embedding calls, so an unbounded string is unbounded
    # spend. measurement_year is range-checked so it can't be a wild int.
    text: str = Field(min_length=1, max_length=4000)
    measurement_year: int = Field(default=2023, ge=1900, le=2100)


class RouteResult(BaseModel):
    hit: bool
    capability_id: Optional[str] = None
    similarity: float = 0.0
    embedding: Optional[list[float]] = None   # the query embedding, reused downstream
