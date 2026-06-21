"""
Semantic routing: embed the incoming intent, search the capability vector index.
Returns a cache hit (reuse) or signals a gap (build).
"""
from __future__ import annotations

import asyncio

import httpx

from backend.config import settings
from backend.registry.capability_store import CapabilityStore, CAPABILITY_KEY_PREFIX
from backend.schemas import RouteResult


def _embed_sync(text: str) -> list[float]:
    resp = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        json={"model": settings.forge_embed_model, "input": text},
        timeout=10,
    )
    if resp.status_code != 200:
        return [0.0] * 1536
    return resp.json()["data"][0]["embedding"]


async def embed(text: str) -> list[float]:
    if not settings.openai_api_key:
        # Graceful degrade: routing always misses, build loop still works without embeddings.
        return [0.0] * 1536
    # httpx.post is blocking; offload to a thread so the event loop stays free.
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _embed_sync, text)


class Router:
    def __init__(self, store: CapabilityStore):
        self.store = store

    async def route(self, intent: str) -> RouteResult:
        embedding = await embed(intent)
        results = await self.store.search(embedding, top_k=1)
        if not results:
            return RouteResult(hit=False)

        top = results[0]
        # RedisVL returns cosine distance; convert to similarity
        distance = float(top.get("vector_distance", 1.0))
        similarity = 1.0 - distance

        if similarity >= settings.similarity_threshold:
            # RedisVL returns the Redis document key (forge:cap:<uuid>) as `id`,
            # which shadows our indexed manifest-id field. Strip the prefix so the
            # rest of the kernel gets the bare capability id it expects.
            raw_id = top.get("id", "")
            cap_id = (
                raw_id[len(CAPABILITY_KEY_PREFIX):]
                if raw_id.startswith(CAPABILITY_KEY_PREFIX)
                else raw_id
            )
            return RouteResult(
                hit=True,
                capability_id=cap_id,
                similarity=similarity,
            )
        return RouteResult(hit=False, similarity=similarity)
