"""
BuildLoop: the orchestrator at the heart of Forge.

Runs the full intent -> capability pipeline and emits a BuildEvent at every
stage so the frontend can render live progress:

    routing -> (reuse | gap -> synthesizing -> synthesized -> verifying ->
    verified -> [human approval] -> approved -> installed -> executing) -> done

Events are both yielded (for in-process consumers) and emitted to the Redis
Stream via store.emit (so the SSE endpoint can replay them to the browser).
Every event carries the pre-generated capability_id so the SSE filter can pick
out the events for one build.
"""
from __future__ import annotations

import asyncio
import time
from typing import AsyncGenerator, Optional

from backend.config import settings
from backend.data.clinic_data import ClinicDataLayer
from backend.kernel.executor import Executor, ExecutionError
from backend.kernel.installer import Installer
from backend.kernel.router import Router, embed
from backend.kernel.synthesizer import Synthesizer, SynthesisError
from backend.kernel.verifier import (
    ALLOWED_DATA_METHODS,
    scope_facts,
    verify,
)
from backend.registry.capability_store import CapabilityStore
from backend.schemas import (
    BuildEvent,
    BuildTraceStep,
    Capability,
    IntentRequest,
    Provenance,
    RouteResult,
)

APPROVAL_TIMEOUT_S = 300.0


class BuildLoop:
    def __init__(self, store: CapabilityStore, clinic_data: ClinicDataLayer):
        self.store = store
        self.clinic_data = clinic_data
        self.synthesizer = Synthesizer()
        self.router = Router(store)
        self.executor = Executor()
        self.installer = Installer()
        # In-memory approval gates: capability_id -> asyncio.Event
        self._approval_gates: dict[str, asyncio.Event] = {}

    async def _emit(
        self,
        capability_id: str,
        stage: str,
        message: str = "",
        payload: Optional[dict] = None,
    ) -> BuildEvent:
        """Build, persist to the stream, and return a BuildEvent."""
        event = BuildEvent(
            capability_id=capability_id,
            stage=stage,
            message=message,
            payload=payload or {},
        )
        await self.store.emit(event)
        # Let the event loop breathe between stages so the SSE poller can drain.
        await asyncio.sleep(0)
        return event

    async def run(
        self, request: IntentRequest, capability_id: str
    ) -> AsyncGenerator[BuildEvent, None]:
        inputs = {"measurement_year": request.measurement_year}

        # Provenance accumulators (read-only enrichment; no behavior change). The
        # trace records one compact step per emitted stage; t0 anchors the
        # routing->done wall-clock used for first_run_ms.
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        trace: list[BuildTraceStep] = []
        in_tok = 0
        out_tok = 0
        verif_facts: dict = {}
        # Best-match similarity to persist. Set only on the explicit gap branch
        # (a real below-threshold miss). Stays None for the missing-indexed-cap
        # fall-through, where route.similarity reflects a stale hit, not a miss.
        best_similarity: Optional[float] = None

        def _trace(stage: str, detail: str) -> None:
            trace.append(BuildTraceStep(stage=stage, ts=time.time(), detail=detail))

        # ── routing ──────────────────────────────────────────────────────────
        # Q1 (option A): carry the real query text on the routing payload so the
        # dashboard can show the quoted query verbatim. Additive — no behavior change.
        yield await self._emit(
            capability_id,
            "routing",
            "Checking capability library...",
            {"text": request.text},
        )
        _trace("routing", "checking library")

        try:
            route = await self.router.route(request.text)
        except Exception:
            # A routing hiccup (e.g. a slow embedding call) must not kill the
            # request — degrade to a miss and build from scratch. embedding stays
            # None, so compounding retrieval is skipped this run.
            route = RouteResult(hit=False)

        # ── reuse path ───────────────────────────────────────────────────────
        if route.hit and route.capability_id:
            existing = await self.store.get(route.capability_id)
            if existing is None:
                # Index pointed at a capability that no longer exists; treat as miss.
                # No comparable similarity here -> leave payload empty (best_similarity
                # stays None in the persisted provenance).
                yield await self._emit(
                    capability_id,
                    "gap",
                    "No existing capability found. Building new one...",
                )
                _trace("gap", "no match")
            else:
                yield await self._emit(
                    capability_id,
                    "reuse",
                    f"Found existing capability: {existing.manifest.name}",
                    {
                        "capability_id": route.capability_id,
                        "similarity": route.similarity,
                    },
                )
                yield await self._emit(capability_id, "executing", "Running...")
                try:
                    result = await self.executor.execute(
                        existing, inputs, self.clinic_data
                    )
                except ExecutionError as e:
                    yield await self._emit(capability_id, "error", str(e))
                    return

                await self.store.increment_reuse(route.capability_id)
                refreshed = await self.store.get(route.capability_id)
                reuse_count = (
                    refreshed.manifest.reuse_count if refreshed else 0
                )
                yield await self._emit(
                    capability_id,
                    "done",
                    "Complete",
                    {"result": result, "reuse_count": reuse_count},
                )
                return
        else:
            # ── gap ──────────────────────────────────────────────────────────
            # Explicit miss: route.similarity is meaningful (best neighbor below
            # threshold). Surface it on the payload (additive enrichment) so the
            # dashboard's BUILT entry can show "best match" live.
            yield await self._emit(
                capability_id,
                "gap",
                "No existing capability found. Building new one...",
                {"best_similarity": round(route.similarity, 4)},
            )
            best_similarity = round(route.similarity, 4)
            _trace("gap", f"no match (best: {route.similarity:.2f})")

        # ── retrieve adjacent band (compounding) ──────────────────────────────
        # Non-fatal enrichment: any failure degrades silently to from-scratch
        # synthesis. Both the gap branch and the missing-indexed-cap fall-through
        # converge here before synthesizing.
        adjacent: list[tuple[Capability, float]] = []
        if route.embedding is not None:
            excl = {route.capability_id} if route.capability_id else set()
            try:
                adjacent = await self.store.get_adjacent(
                    route.embedding,
                    settings.compounding_top_k,
                    settings.similarity_threshold,
                    settings.compounding_relevance_floor,
                    exclude_ids=excl,
                )
            except Exception:
                adjacent = []

        built_from = [
            {"id": c.manifest.id, "name": c.manifest.name, "similarity": round(s, 4)}
            for c, s in adjacent
        ]
        prior = [c for c, _ in adjacent]

        # ── synthesizing ─────────────────────────────────────────────────────
        if prior:
            names = ", ".join(c.manifest.name for c in prior)
            n = len(prior)
            synth_message = (
                f"Synthesizing from {n} proven pattern"
                f"{'s' if n != 1 else ''}: {names}"
            )
        else:
            synth_message = "Synthesizing from scratch"
        yield await self._emit(
            capability_id,
            "synthesizing",
            synth_message,
        )
        _trace(
            "synthesizing",
            f"from {len(prior)} pattern{'s' if len(prior) != 1 else ''}"
            if prior
            else "from scratch",
        )
        try:
            capability: Capability = await self.synthesizer.synthesize(
                request.text,
                request.measurement_year,
                prior_patterns=prior or None,
            )
        except SynthesisError as e:
            yield await self._emit(capability_id, "error", str(e))
            return
        except Exception as e:
            yield await self._emit(
                capability_id, "error", f"Synthesis failed: {e}"
            )
            return

        # Force the pre-generated UUID so every downstream artifact + event
        # shares one id (the one the client is already listening on).
        capability.manifest.id = capability_id
        # Persist provenance on the manifest so the installed capability records
        # which prior patterns it was built from (powers the library lineage view).
        capability.manifest.built_from = built_from

        in_tok = self.synthesizer.last_input_tokens
        out_tok = self.synthesizer.last_output_tokens
        yield await self._emit(
            capability_id,
            "synthesized",
            f"Logic generated: {capability.manifest.name}",
            {
                "manifest": capability.manifest.model_dump(),
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "built_from": built_from,
            },
        )
        _trace("synthesized", f"{in_tok + out_tok:,} tokens")

        # ── verifying ────────────────────────────────────────────────────────
        yield await self._emit(
            capability_id, "verifying", "Verifying generated logic..."
        )
        _trace("verifying", "AST scan + sandbox")
        ok, reason = await verify(capability.logic, inputs)
        if not ok:
            yield await self._emit(capability_id, "verify_failed", reason)
            return

        # Verification facts from the real AST (read-only) for provenance display.
        facts = scope_facts(capability.logic)
        verif_facts = {
            **facts,
            "sandbox_valid": True,
            "all_on_allowlist": all(
                m in ALLOWED_DATA_METHODS for m in facts["methods"]
            ),
        }

        # Register the gate BEFORE yielding "verified" so the caller can
        # immediately POST /approve and the set() lands on an existing gate.
        gate = asyncio.Event()
        self._approval_gates[capability_id] = gate

        yield await self._emit(
            capability_id,
            "verified",
            "Logic verified. Awaiting your approval.",
        )
        _trace("verified", "checks passed")

        # ── human approval gate ──────────────────────────────────────────────
        try:
            await asyncio.wait_for(gate.wait(), timeout=APPROVAL_TIMEOUT_S)
        except asyncio.TimeoutError:
            yield await self._emit(capability_id, "error", "Approval timed out")
            return
        finally:
            self._approval_gates.pop(capability_id, None)

        yield await self._emit(capability_id, "approved", "Approved.")
        _trace("approved", "human gate released")

        # ── execute ──────────────────────────────────────────────────────────
        # Run BEFORE persisting: a capability only earns a place in the registry
        # (becoming a durable, reusable tool) if it actually executes cleanly.
        # One that fails here never gets installed, so the library never holds a
        # broken capability.
        yield await self._emit(
            capability_id, "executing", "Running against clinic data..."
        )
        _trace("executing", "running against data")
        try:
            result = await self.executor.execute(
                capability, inputs, self.clinic_data
            )
        except ExecutionError as e:
            yield await self._emit(capability_id, "error", str(e))
            return

        # ── install ──────────────────────────────────────────────────────────
        try:
            installed_id = await self.installer.install(capability, self.store)
        except Exception as e:
            yield await self._emit(
                capability_id, "error", f"Install failed: {e}"
            )
            return

        yield await self._emit(
            capability_id,
            "installed",
            "Capability installed and reusable.",
            {"capability_id": installed_id},
        )
        _trace("installed", "indexed in Redis")

        row_count = result.get("count") if isinstance(result, dict) else None
        yield await self._emit(
            capability_id, "done", "Complete", {"result": result}
        )
        _trace(
            "done",
            f"{row_count} rows returned" if row_count is not None else "complete",
        )

        # ── persist provenance (additive write to the just-installed cap) ──────
        # Known only now: first_run_ms (routing->done) and the done trace step.
        # One extra RedisJSON set on the capability the build just installed; sets
        # a new optional manifest field and changes no build/route/execute behavior.
        # Best-effort: a provenance write failure must not fail the build.
        first_run_ms = round((loop.time() - t0) * 1000)
        provenance = Provenance(
            build_cost=in_tok + out_tok,
            input_tokens=in_tok,
            output_tokens=out_tok,
            trace=trace,
            verification=verif_facts,
            first_run_ms=first_run_ms,
            best_similarity=best_similarity,
        )
        try:
            await self.store.update_provenance(capability_id, provenance)
        except Exception:
            pass

    async def approve(self, capability_id: str) -> bool:
        """Release the approval gate for a pending build. False if none exists."""
        gate = self._approval_gates.get(capability_id)
        if gate is None:
            return False
        gate.set()
        return True
