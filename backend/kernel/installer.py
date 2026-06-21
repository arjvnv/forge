"""
Installer: persists a verified Capability into the registry.

Writes the manifest + logic to RedisJSON and the description embedding to the
RedisVL vector index so the capability becomes routable (reusable) for future
intents. This is the step that turns a one-off synthesis into a durable,
reusable tool — the core promise of Forge.
"""
from __future__ import annotations

from datetime import datetime, timezone

from backend.kernel.router import embed
from backend.registry.capability_store import CapabilityStore
from backend.schemas import Capability


class Installer:
    async def install(self, capability: Capability, store: CapabilityStore) -> str:
        # Embed the description so the capability is semantically routable.
        embedding = await embed(capability.manifest.description)

        if not capability.manifest.created_at:
            capability.manifest.created_at = datetime.now(timezone.utc).isoformat()

        capability.verified = True

        return await store.save(capability, embedding)
