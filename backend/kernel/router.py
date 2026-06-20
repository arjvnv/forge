"""
Semantic routing: embed the incoming intent, search the capability vector index.
Returns a cache hit (reuse) or signals a gap (build).
"""
from __future__ import annotations

import httpx

from backend.config import settings
from backend.registry.capability_store import CapabilityStore
from backend.schemas import RouteResult


async def embed(text: str) -> list[float]:
    if not settings.openai_api_key:
        # Graceful degrade: routing always misses, build loop still works without embeddings.
        return [0.0] * 1536
    resp = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        json={"model": settings.forge_embed_model, "input": text},
        timeout=10,
    )
    if resp.status_code != 200:
        return [0.0] * 1536
    return resp.json()["data"][0]["embedding"]


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
            return RouteResult(
                hit=True,
                capability_id=top["id"],
                similarity=similarity,
            )
        return RouteResult(hit=False, similarity=similarity)
