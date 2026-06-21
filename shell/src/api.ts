import type { BuildEvent, ExecutionResult, Manifest } from './types';

const BASE = 'http://localhost:8000';

/** Stages that end the SSE stream. `timeout` is synthesized by the server's
 *  SSE generator and also terminates the stream, so we treat it as terminal. */
const TERMINAL_STAGES = new Set(['done', 'error', 'verify_failed', 'timeout']);

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && typeof body.detail === 'string') detail = body.detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function submitIntent(
  text: string,
  measurement_year = 2023,
): Promise<{ capability_id: string; stream_url: string }> {
  const res = await fetch(`${BASE}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, measurement_year }),
  });
  return asJson(res);
}

/**
 * Opens an EventSource on GET /events/{capabilityId}.
 * - onEvent fires for every well-formed SSE message as it arrives.
 * - onDone fires once, when a terminal stage arrives or the connection dies.
 * Returns a cleanup function that closes the stream (idempotent).
 */
export function openBuildStream(
  capabilityId: string,
  onEvent: (e: BuildEvent) => void,
  onDone: () => void,
): () => void {
  const source = new EventSource(`${BASE}/events/${capabilityId}`);
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  const finish = () => {
    cleanup();
    onDone();
  };

  source.onmessage = (msg: MessageEvent<string>) => {
    let event: BuildEvent;
    try {
      event = JSON.parse(msg.data) as BuildEvent;
    } catch {
      return; // ignore malformed frames rather than killing the stream
    }
    onEvent(event);
    if (TERMINAL_STAGES.has(event.stage)) {
      finish();
    }
  };

  // EventSource fires onerror on terminal/closed connections too. If we've
  // already reached a terminal stage, cleanup() is a no-op; otherwise this is
  // a real transport failure and we surface it as the end of the stream.
  source.onerror = () => {
    if (closed) return;
    finish();
  };

  return cleanup;
}

export async function approveCapability(
  capabilityId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/approve/${capabilityId}`, {
    method: 'POST',
  });
  return asJson(res);
}

export async function listCapabilities(): Promise<Manifest[]> {
  const res = await fetch(`${BASE}/capabilities`);
  return asJson(res);
}

export async function runCapability(
  capabilityId: string,
  measurement_year = 2023,
): Promise<ExecutionResult> {
  const res = await fetch(`${BASE}/capabilities/${capabilityId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ measurement_year }),
  });
  return asJson(res);
}
