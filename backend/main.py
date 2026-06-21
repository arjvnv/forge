"""
Forge FastAPI app — wires the kernel together and exposes the build loop over
HTTP + SSE.

Flow for the demo:
    POST /intent           -> kicks off the build loop as a background task,
                              returns a pre-generated capability_id + stream URL
    GET  /events/{id}      -> SSE stream of BuildEvents for that build
    POST /approve/{id}     -> releases the human-approval gate
    ... capability installs, executes, and the stream ends with `done`.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.config import settings
from backend.data.clinic_data import ClinicDataLayer
from backend.kernel.build_loop import BuildLoop
from backend.kernel.executor import Executor, ExecutionError
from backend.registry.capability_store import CapabilityStore
from backend.schemas import BuildEvent, IntentRequest

SSE_POLL_INTERVAL_S = 0.3
SSE_TIMEOUT_S = 60.0
# read_events blocks ~500ms server-side; the outer wait_for must exceed that so
# it only fires as a backstop, never on the normal blocking-read path.
SSE_READ_BLOCK_TIMEOUT_S = 1.0
TERMINAL_STAGES = {"done", "error", "verify_failed"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = CapabilityStore(settings.redis_url)
    await store.connect()

    clinic_data = ClinicDataLayer(settings.database_url)
    await clinic_data.connect()

    app.state.store = store
    app.state.clinic_data = clinic_data
    app.state.build_loop = BuildLoop(store, clinic_data)
    # Keep references to background build tasks so they aren't GC'd mid-flight.
    app.state.build_tasks = set()

    try:
        yield
    finally:
        await clinic_data.close()
        await store.close()


app = FastAPI(title="Forge", version="0.1.0", lifespan=lifespan)

# Hackathon: the shell runs on a different port, so origins are open.
# allow_credentials is False: "*" + credentials is spec-invalid (browsers reject
# it) and would otherwise broaden CSRF surface on /intent and /approve. If real
# auth/cookies are added later, replace "*" with an explicit origin allowlist.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    measurement_year: int = Field(default=2023, ge=1900, le=2100)


# ── health ──────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    redis_ok = False
    postgres_ok = False
    try:
        await app.state.store._redis.ping()
        redis_ok = True
    except Exception:
        redis_ok = False
    try:
        async with app.state.clinic_data._pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        postgres_ok = True
    except Exception:
        postgres_ok = False
    return {"status": "ok", "redis": redis_ok, "postgres": postgres_ok}


# ── build loop ────────────────────────────────────────────────────────────────


async def _drain_build(build_loop: BuildLoop, request: IntentRequest, cap_id: str):
    """Run the async generator to completion; events go to the Redis stream."""
    try:
        async for _event in build_loop.run(request, cap_id):
            pass
    except Exception as e:
        # Never let a background build die silently — surface it on the stream.
        await build_loop.store.emit(
            BuildEvent(
                capability_id=cap_id, stage="error", message=f"Build crashed: {e}"
            )
        )


@app.post("/intent")
async def intent(request: IntentRequest):
    cap_id = str(uuid.uuid4())
    build_loop: BuildLoop = app.state.build_loop

    task = asyncio.create_task(_drain_build(build_loop, request, cap_id))
    app.state.build_tasks.add(task)
    task.add_done_callback(app.state.build_tasks.discard)

    return {"capability_id": cap_id, "stream_url": f"/events/{cap_id}"}


@app.get("/events/{capability_id}")
async def events(capability_id: str):
    store: CapabilityStore = app.state.store

    async def event_generator():
        last_id = "0"
        loop = asyncio.get_running_loop()
        deadline = loop.time() + SSE_TIMEOUT_S

        while True:
            if loop.time() >= deadline:
                yield {
                    "data": json.dumps(
                        {"stage": "timeout", "message": "Stream timed out", "payload": {}}
                    )
                }
                return

            try:
                # read_events blocks server-side for a finite window (its own
                # default); the outer wait_for is just a backstop so a cancelled
                # read can't hang the SSE generator.
                entries = await asyncio.wait_for(
                    store.read_events(last_id, count=10),
                    timeout=SSE_READ_BLOCK_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                entries = []
            except Exception:
                entries = []

            for entry in entries:
                last_id = entry.get("id", last_id)
                if entry.get("capability_id") != capability_id:
                    continue

                try:
                    payload = json.loads(entry.get("payload", "{}"))
                except (json.JSONDecodeError, TypeError):
                    payload = {}

                stage = entry.get("stage", "")
                yield {
                    "data": json.dumps(
                        {
                            "stage": stage,
                            "message": entry.get("message", ""),
                            "payload": payload,
                        }
                    )
                }
                if stage in TERMINAL_STAGES:
                    return

            await asyncio.sleep(SSE_POLL_INTERVAL_S)

    return EventSourceResponse(event_generator())


@app.post("/approve/{capability_id}")
async def approve(capability_id: str):
    build_loop: BuildLoop = app.state.build_loop
    ok = await build_loop.approve(capability_id)
    return {"ok": ok}


# ── registry ──────────────────────────────────────────────────────────────────


@app.get("/capabilities")
async def list_capabilities():
    store: CapabilityStore = app.state.store
    manifests = await store.list_all()
    return [m.model_dump() for m in manifests]


@app.get("/capabilities/{capability_id}")
async def get_capability(capability_id: str):
    store: CapabilityStore = app.state.store
    cap = await store.get(capability_id)
    if cap is None:
        raise HTTPException(status_code=404, detail="Capability not found")
    return cap.model_dump()


@app.post("/capabilities/{capability_id}/run")
async def run_capability(capability_id: str, body: RunRequest):
    store: CapabilityStore = app.state.store
    clinic_data: ClinicDataLayer = app.state.clinic_data

    cap = await store.get(capability_id)
    if cap is None:
        raise HTTPException(status_code=404, detail="Capability not found")

    executor = Executor()
    inputs = {"measurement_year": body.measurement_year}
    try:
        result = await executor.execute(cap, inputs, clinic_data)
    except ExecutionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await store.increment_reuse(capability_id)
    return result
