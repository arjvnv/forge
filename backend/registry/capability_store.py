"""
Capability registry backed by Redis.
- RedisJSON: manifest + logic storage (system of record)
- RedisVL:   vector index for semantic routing
- Streams:   build event bus
"""
from __future__ import annotations
import json
import time
from typing import Optional

import redis.asyncio as aioredis
from redisvl.index import AsyncSearchIndex
from redisvl.schema import IndexSchema
from redisvl.query import VectorQuery

from backend.schemas import Capability, Manifest, BuildEvent

CAPABILITY_KEY_PREFIX = "forge:cap:"
VECTOR_INDEX_NAME = "forge-capabilities"
STREAM_KEY = "forge:build-events"


_SCHEMA = {
    "index": {
        "name": VECTOR_INDEX_NAME,
        "prefix": CAPABILITY_KEY_PREFIX,
        "storage_type": "json",
    },
    "fields": [
        {"name": "$.manifest.id",          "type": "tag",    "as": "id"},
        {"name": "$.manifest.name",        "type": "text",   "as": "name"},
        {"name": "$.manifest.description", "type": "text",   "as": "description"},
        {"name": "$.manifest.reuse_count", "type": "numeric","as": "reuse_count"},
        {"name": "$.embedding",            "type": "vector",
         "as": "embedding",
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

    # ── write ──────────────────────────────────────────────────────────────

    async def save(self, cap: Capability, embedding: list[float]) -> str:
        cap_id = cap.manifest.id
        key = f"{CAPABILITY_KEY_PREFIX}{cap_id}"
        data = json.loads(cap.model_dump_json())
        data["embedding"] = embedding
        await self._redis.json().set(key, "$", data)
        return cap_id

    async def increment_reuse(self, cap_id: str):
        key = f"{CAPABILITY_KEY_PREFIX}{cap_id}"
        await self._redis.json().numincrby(key, "$.manifest.reuse_count", 1)

    # ── read ───────────────────────────────────────────────────────────────

    async def get(self, cap_id: str) -> Optional[Capability]:
        key = f"{CAPABILITY_KEY_PREFIX}{cap_id}"
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

    # ── event bus ──────────────────────────────────────────────────────────

    async def emit(self, event: BuildEvent):
        await self._redis.xadd(STREAM_KEY, {
            "capability_id": event.capability_id,
            "stage": event.stage,
            "message": event.message,
            "payload": json.dumps(event.payload),
            "ts": str(time.time()),
        })

    async def read_events(self, last_id: str = "0", count: int = 100) -> list[dict]:
        entries = await self._redis.xread({STREAM_KEY: last_id}, count=count, block=0)
        if not entries:
            return []
        _, messages = entries[0]
        return [{"id": mid, **fields} for mid, fields in messages]
