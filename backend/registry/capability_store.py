"""
Capability registry backed by Redis.
- RedisJSON: manifest + logic storage (system of record)
- RedisVL:   vector index for semantic routing
- Streams:   build event bus
"""
from __future__ import annotations
import json
import time
from datetime import date, datetime
from typing import Optional

import redis.asyncio as aioredis
from redisvl.index import AsyncSearchIndex
from redisvl.schema import IndexSchema
from redisvl.query import VectorQuery

from backend.schemas import Capability, Manifest, BuildEvent, Provenance

CAPABILITY_KEY_PREFIX = "forge:cap:"
VECTOR_INDEX_NAME = "forge-capabilities"
STREAM_KEY = "forge:build-events"
STREAM_MAXLEN = 10000  # cap global event-bus growth (approximate trim)


def _json_default(o):
    """Serialize values the stdlib JSON encoder can't handle on its own.

    Generated/synthesized capability logic returns result rows straight from the
    data layer, which can contain asyncpg `date`/`datetime` objects. Without this
    the `json.dumps` in `emit` raises and crashes the whole build at the final
    `done` event. date/datetime -> ISO string; anything else -> str so the event
    stream can never be broken by an unexpected value type.
    """
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    return str(o)


_SCHEMA = {
    "index": {
        "name": VECTOR_INDEX_NAME,
        "prefix": CAPABILITY_KEY_PREFIX,
        "storage_type": "json",
    },
    "fields": [
        {"name": "id",          "type": "tag",     "path": "$.manifest.id"},
        {"name": "name",        "type": "text",    "path": "$.manifest.name"},
        {"name": "description", "type": "text",    "path": "$.manifest.description"},
        {"name": "reuse_count", "type": "numeric", "path": "$.manifest.reuse_count"},
        {"name": "embedding",   "type": "vector",  "path": "$.embedding",
         "attrs": {"dims": 1536, "distance_metric": "cosine", "algorithm": "hnsw"}},
    ],
}


class CapabilityStore:
    def __init__(self, redis_url: str):
        self._redis_url = redis_url
        self._redis: Optional[aioredis.Redis] = None
        self._index: Optional[AsyncSearchIndex] = None

    async def connect(self):
        self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
        schema = IndexSchema.from_dict(_SCHEMA)
        self._index = AsyncSearchIndex(schema=schema, redis_client=self._redis)
        await self._index.create(overwrite=False)

    async def close(self):
        if self._redis:
            await self._redis.aclose()

    def _key(self, cap_id: str) -> str:
        """Build a Redis key from a capability id, tolerating an id that already
        carries the prefix (RedisVL hands back full document keys)."""
        if cap_id.startswith(CAPABILITY_KEY_PREFIX):
            return cap_id
        return f"{CAPABILITY_KEY_PREFIX}{cap_id}"

    # ── write ──────────────────────────────────────────────────────────────

    async def save(self, cap: Capability, embedding: list[float]) -> str:
        cap_id = cap.manifest.id
        key = self._key(cap_id)
        data = json.loads(cap.model_dump_json())
        data["embedding"] = embedding
        await self._redis.json().set(key, "$", data)
        return cap_id

    async def increment_reuse(self, cap_id: str):
        key = self._key(cap_id)
        await self._redis.json().numincrby(key, "$.manifest.reuse_count", 1)

    async def update_provenance(self, cap_id: str, provenance: Provenance):
        """Set the manifest's provenance field on an already-installed capability.

        One additive RedisJSON write, called once at the end of a build (the demo's
        own write path). Does not touch routing/synthesis/verify/execute behavior.
        """
        key = self._key(cap_id)
        await self._redis.json().set(
            key, "$.manifest.provenance", provenance.model_dump()
        )

    # ── read ───────────────────────────────────────────────────────────────

    async def get(self, cap_id: str) -> Optional[Capability]:
        key = self._key(cap_id)
        raw = await self._redis.json().get(key, "$")
        if not raw:
            return None
        data = raw[0] if isinstance(raw, list) else raw
        return Capability(**data)

    async def list_all(self) -> list[Manifest]:
        keys = await self._redis.keys(f"{CAPABILITY_KEY_PREFIX}*")
        manifests = []
        for key in keys:
            raw = await self._redis.json().get(key, "$.manifest")
            if raw:
                m = raw[0] if isinstance(raw, list) else raw
                manifests.append(Manifest(**m))
        return manifests

    # ── semantic routing ───────────────────────────────────────────────────

    async def search(self, query_embedding: list[float], top_k: int = 3) -> list[dict]:
        q = VectorQuery(
            vector=query_embedding,
            vector_field_name="embedding",
            return_fields=["id", "name", "description", "reuse_count", "vector_distance"],
            num_results=top_k,
        )
        results = await self._index.query(q)
        return results

    async def get_adjacent(
        self,
        embedding: list[float],
        k: int,
        max_similarity: float,      # exclusive upper bound (settings.similarity_threshold)
        min_similarity: float,      # inclusive lower bound (settings.compounding_relevance_floor)
        exclude_ids: Optional[set[str]] = None,
    ) -> list[tuple[Capability, float]]:
        """Return up to k full Capabilities (WITH logic) whose cosine similarity to
        `embedding` falls in [min_similarity, max_similarity), nearest first, excluding
        any id in exclude_ids. Each tuple is (capability, similarity)."""
        exclude_ids = exclude_ids or set()
        # Request k+1 so we can still fill k in-band when the single nearest result
        # is the excluded exact-reuse hit.
        results = await self.search(embedding, top_k=k + 1)

        adjacent: list[tuple[Capability, float]] = []
        for r in results:
            if len(adjacent) >= k:
                break
            distance = float(r.get("vector_distance", 1.0))
            similarity = 1.0 - distance
            if not (min_similarity <= similarity < max_similarity):
                continue
            raw_id = r.get("id", "")
            cap_id = (
                raw_id[len(CAPABILITY_KEY_PREFIX):]
                if raw_id.startswith(CAPABILITY_KEY_PREFIX)
                else raw_id
            )
            if cap_id in exclude_ids:
                continue
            cap = await self.get(cap_id)
            if cap is None:
                # Index points at a deleted capability; skip it.
                continue
            adjacent.append((cap, similarity))
        return adjacent

    # ── event bus ──────────────────────────────────────────────────────────

    async def emit(self, event: BuildEvent):
        # Cap stream length so a long-running server can't grow the global event
        # bus without bound. approximate=True lets Redis trim efficiently.
        await self._redis.xadd(
            STREAM_KEY,
            {
                "capability_id": event.capability_id,
                "stage": event.stage,
                "message": event.message,
                "payload": json.dumps(event.payload, default=_json_default),
                "ts": str(time.time()),
            },
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )

    async def recent_events(self, count: int = 200) -> list[dict]:
        """Read the most recent N stream events, chronological, without blocking.

        Uses XREVRANGE (newest-first, O(count), no cursor, no open connection) —
        unlike read_events' blocking xread. Returns oldest-first for the dashboard.
        """
        msgs = await self._redis.xrevrange(STREAM_KEY, count=count)
        out = [{"id": mid, **fields} for mid, fields in msgs]
        out.reverse()
        return out

    async def read_events(
        self, last_id: str = "0", count: int = 100, block_ms: int = 500
    ) -> list[dict]:
        # block_ms must be finite: a blocking xread that is cancelled by an outer
        # asyncio.wait_for leaves the underlying Redis connection blocked, which
        # leaks pool connections under repeated SSE connect/timeout cycles (DoS).
        entries = await self._redis.xread(
            {STREAM_KEY: last_id}, count=count, block=block_ms
        )
        if not entries:
            return []
        _, messages = entries[0]
        return [{"id": mid, **fields} for mid, fields in messages]
