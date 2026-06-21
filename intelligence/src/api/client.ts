import type { Capability, Health, Manifest, StreamEvent } from './types';

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000';

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function getHealth(): Promise<Health> {
  // A failed fetch (backend down) surfaces as reachable:false to the caller.
  try {
    const h = await getJSON<{ status: string; redis: boolean; postgres: boolean }>(
      '/health',
    );
    return { ...h, reachable: true };
  } catch {
    return { redis: false, postgres: false, reachable: false };
  }
}

export function getCapabilities(): Promise<Manifest[]> {
  return getJSON<Manifest[]>('/capabilities');
}

export function getCapability(id: string): Promise<Capability> {
  return getJSON<Capability>(`/capabilities/${id}`);
}

export async function getStream(count = 200): Promise<StreamEvent[]> {
  const { events } = await getJSON<{ events: StreamEvent[] }>(
    `/intelligence/stream?count=${count}`,
  );
  return events;
}
