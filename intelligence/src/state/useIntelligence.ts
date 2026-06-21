import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCapabilities,
  getCapability,
  getHealth,
  getStream,
} from '../api/client';
import type { Capability, Health, Manifest, StreamEvent } from '../api/types';

const STREAM_MS = 2500;
const CAPS_MS = 5000;
const HEALTH_MS = 5000;
const MAX_EVENTS = 500;
const STREAM_COUNT = 200;

export interface IntelligenceState {
  capabilities: Manifest[];
  capDetail: Record<string, Capability>;
  health: Health;
  events: StreamEvent[];
  sessionStartTs: number | null;
  loaded: boolean;
  requestDetail: (id: string) => void;
}

export function useIntelligence(): IntelligenceState {
  const [capabilities, setCapabilities] = useState<Manifest[]>([]);
  const [capDetail, setCapDetail] = useState<Record<string, Capability>>({});
  const [health, setHealth] = useState<Health>({
    redis: false,
    postgres: false,
    reachable: false,
  });
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [sessionStartTs, setSessionStartTs] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Stable refs that polling closures read without re-subscribing.
  const seenIds = useRef<Set<string>>(new Set());
  const sessionAnchored = useRef(false);
  const detailRequested = useRef<Set<string>>(new Set());

  const mergeEvents = useCallback((incoming: StreamEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((prev) => {
      const next = prev.slice();
      let changed = false;
      for (const e of incoming) {
        if (!e.id || seenIds.current.has(e.id)) continue;
        seenIds.current.add(e.id);
        next.push(e);
        changed = true;
      }
      if (!changed) return prev;
      next.sort((a, b) => a.ts - b.ts);
      if (next.length > MAX_EVENTS) {
        return next.slice(next.length - MAX_EVENTS);
      }
      return next;
    });
  }, []);

  const pollStream = useCallback(async () => {
    try {
      const evs = await getStream(STREAM_COUNT);
      // Anchor the session boundary at the newest event seen on first load.
      if (!sessionAnchored.current) {
        sessionAnchored.current = true;
        const newest = evs.reduce((m, e) => (e.ts > m ? e.ts : m), 0);
        setSessionStartTs(newest > 0 ? newest : Date.now() / 1000);
      }
      mergeEvents(evs);
    } catch {
      // transient; health poll surfaces the connection state
    }
  }, [mergeEvents]);

  const pollCaps = useCallback(async () => {
    try {
      setCapabilities(await getCapabilities());
    } catch {
      // keep last known
    }
  }, []);

  const pollHealth = useCallback(async () => {
    setHealth(await getHealth());
  }, []);

  const requestDetail = useCallback((id: string) => {
    if (!id || detailRequested.current.has(id)) return;
    detailRequested.current.add(id);
    getCapability(id)
      .then((cap) => setCapDetail((prev) => ({ ...prev, [id]: cap })))
      .catch(() => {
        // 404 race (card before install commit): allow a later retry.
        detailRequested.current.delete(id);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([pollHealth(), pollCaps(), pollStream()]).finally(() => {
      if (!cancelled) setLoaded(true);
    });
    const s = setInterval(pollStream, STREAM_MS);
    const c = setInterval(pollCaps, CAPS_MS);
    const h = setInterval(pollHealth, HEALTH_MS);
    return () => {
      cancelled = true;
      clearInterval(s);
      clearInterval(c);
      clearInterval(h);
    };
  }, [pollHealth, pollCaps, pollStream]);

  return {
    capabilities,
    capDetail,
    health,
    events,
    sessionStartTs,
    loaded,
    requestDetail,
  };
}
