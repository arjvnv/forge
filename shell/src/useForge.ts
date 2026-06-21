import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approveCapability,
  getHealth,
  listCapabilities,
  openBuildStream,
  runCapability,
  submitIntent,
} from './api';
import type {
  BuildEvent,
  BuildStage,
  ExecutionResult,
  HealthStatus,
  Manifest,
  ResultRow,
} from './types';

// Stage orders for the two paths, used to drive the timeline + progress rail.
export const PATHS: Record<'reuse' | 'build', BuildStage[]> = {
  reuse: ['routing', 'reuse', 'executing', 'done'],
  build: [
    'routing',
    'gap',
    'synthesizing',
    'synthesized',
    'verifying',
    'verified',
    'approved',
    'executing',
    'installed',
    'done',
  ],
};

export const PLAIN: Partial<Record<BuildStage, string>> = {
  routing: 'Checking your library',
  reuse: 'Found a tool you already have',
  gap: 'No existing tool — forging a new one',
  synthesizing: 'Writing the tool',
  synthesized: 'Tool written',
  verifying: 'Safety-checking the code',
  verified: 'Ready for your approval',
  approved: 'Approved',
  executing: 'Running on your patient data',
  installed: 'Saved to your library',
  done: 'Complete',
};

const FAILURE: Set<BuildStage> = new Set(['error', 'verify_failed', 'timeout']);

export interface ResultsState {
  rows: ResultRow[];
  count: number;
  latency_ms: number;
  toolName: string;
  reused: boolean;
  saved: boolean;
  capId: string | null;
}

export interface BuildState {
  id: string;
  // null until the backend tells us via the stages it emits.
  path: 'reuse' | 'build' | null;
  currentStage: BuildStage | null;
  messages: Partial<Record<BuildStage, string>>;
  payloads: Partial<Record<BuildStage, Record<string, unknown>>>;
  awaitingApproval: boolean;
  approving: boolean;
  failed: boolean;
  failMessage: string;
}

interface IntervalRefs {
  library?: ReturnType<typeof setInterval>;
  health?: ReturnType<typeof setInterval>;
}

export function useForge() {
  const [library, setLibrary] = useState<Manifest[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [judge, setJudge] = useState(false);
  const [askText, setAskText] = useState(
    'Patients with diabetes whose last A1c was over 9%',
  );
  const [year, setYear] = useState(2023);
  const [submitting, setSubmitting] = useState(false);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [results, setResults] = useState<ResultsState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const streamCleanup = useRef<(() => void) | null>(null);
  const intervals = useRef<IntervalRefs>({});
  // Refs let the SSE callbacks read live state without stale closures.
  const buildRef = useRef<BuildState | null>(null);
  const libraryRef = useRef<Manifest[]>([]);
  buildRef.current = build;
  libraryRef.current = library;

  const refreshLibrary = useCallback(async () => {
    try {
      const caps = await listCapabilities();
      setLibrary(caps);
    } catch {
      // Transient fetch failure: keep the last good library, try again on next poll.
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      setHealth({ status: 'degraded', redis: false, postgres: false });
    }
  }, []);

  // Mount: initial fetch + polling (library ~10s, health ~10s).
  useEffect(() => {
    refreshLibrary();
    refreshHealth();
    intervals.current.library = setInterval(refreshLibrary, 10000);
    intervals.current.health = setInterval(refreshHealth, 10000);
    return () => {
      if (intervals.current.library) clearInterval(intervals.current.library);
      if (intervals.current.health) clearInterval(intervals.current.health);
      streamCleanup.current?.();
    };
  }, [refreshLibrary, refreshHealth]);

  const closeStream = useCallback(() => {
    streamCleanup.current?.();
    streamCleanup.current = null;
  }, []);

  // Detect path from the stage that just arrived; once set it sticks.
  const detectPath = (
    prev: 'reuse' | 'build' | null,
    stage: BuildStage,
  ): 'reuse' | 'build' | null => {
    if (prev) return prev;
    if (stage === 'reuse') return 'reuse';
    if (stage === 'gap' || stage === 'synthesizing') return 'build';
    return null;
  };

  const handleEvent = useCallback(
    (ev: BuildEvent) => {
      setBuild((s) => {
        if (!s) return s;
        const path = detectPath(s.path, ev.stage);
        const messages = { ...s.messages, [ev.stage]: ev.message };
        const payloads = ev.payload
          ? { ...s.payloads, [ev.stage]: ev.payload }
          : s.payloads;

        if (FAILURE.has(ev.stage)) {
          return {
            ...s,
            path,
            currentStage: ev.stage,
            messages,
            payloads,
            awaitingApproval: false,
            failed: true,
            failMessage: ev.message || 'Something went wrong while forging.',
          };
        }

        // `verified` pauses the stream for human approval.
        const awaitingApproval = ev.stage === 'verified';

        return {
          ...s,
          path,
          currentStage: ev.stage,
          messages,
          payloads,
          awaitingApproval,
        };
      });

      // `done` carries the result. Build the results panel from real payload.
      if (ev.stage === 'done') {
        const payload = ev.payload as
          | { result?: ExecutionResult }
          | undefined;
        const res = payload?.result;
        const b = buildRef.current;
        // Derive tool name + capId from the real events we saw.
        let toolName = '';
        let capId: string | null = null;
        let reused = false;
        let saved = false;
        if (b) {
          const reusePayload = b.payloads.reuse as
            | { capability_id?: string }
            | undefined;
          const synthPayload = b.payloads.synthesized as
            | { manifest?: { name?: string } }
            | undefined;
          const installedPayload = b.payloads.installed as
            | { capability_id?: string }
            | undefined;
          if (b.path === 'reuse' && reusePayload) {
            reused = true;
            capId = reusePayload.capability_id ?? b.id;
            const match = libraryRef.current.find((c) => c.id === capId);
            toolName = match?.name ?? b.messages.reuse ?? '';
          } else {
            saved = true;
            capId = installedPayload?.capability_id ?? b.id;
            toolName =
              synthPayload?.manifest?.name ??
              libraryRef.current.find((c) => c.id === capId)?.name ??
              '';
          }
        }
        if (res) {
          setResults({
            rows: res.rows ?? [],
            count: res.count ?? (res.rows ? res.rows.length : 0),
            latency_ms: res.latency_ms ?? 0,
            toolName,
            reused,
            saved,
            capId,
          });
        }
      }
    },
    [],
  );

  const handleDone = useCallback(() => {
    setSubmitting(false);
    closeStream();
    // New tool installed and/or reuse_count bumped: refetch the library.
    refreshLibrary();
  }, [closeStream, refreshLibrary]);

  const startBuild = useCallback(async () => {
    const text = askText.trim();
    if (submitting || !text) return;
    // Tear down any prior stream before starting a new one.
    closeStream();
    setSubmitting(true);
    setResults(null);
    setBuild(null);

    try {
      const { capability_id } = await submitIntent(text, year);
      setBuild({
        id: capability_id,
        path: null,
        currentStage: null,
        messages: {},
        payloads: {},
        awaitingApproval: false,
        approving: false,
        failed: false,
        failMessage: '',
      });
      streamCleanup.current = openBuildStream(
        capability_id,
        handleEvent,
        handleDone,
      );
    } catch (e) {
      setSubmitting(false);
      setBuild({
        id: 'error',
        path: null,
        currentStage: 'error',
        messages: { error: msg(e) },
        payloads: {},
        awaitingApproval: false,
        approving: false,
        failed: true,
        failMessage: msg(e),
      });
    }
  }, [askText, year, submitting, closeStream, handleEvent, handleDone]);

  const approve = useCallback(async () => {
    const b = buildRef.current;
    if (!b || !b.awaitingApproval || b.approving) return;
    setBuild((s) =>
      s ? { ...s, approving: true, awaitingApproval: false } : s,
    );
    try {
      await approveCapability(b.id);
      // Stream continues to `done` on its own; nothing else to do here.
    } catch (e) {
      setSubmitting(false);
      setBuild((s) =>
        s
          ? {
              ...s,
              approving: false,
              failed: true,
              failMessage: msg(e),
              currentStage: 'error',
              messages: { ...s.messages, error: msg(e) },
            }
          : s,
      );
    }
  }, []);

  // Run a saved tool from a library card or the detail modal.
  const runSaved = useCallback(
    async (id: string) => {
      if (runningId) return;
      const cap = libraryRef.current.find((c) => c.id === id);
      setRunningId(id);
      try {
        const res = await runCapability(id, year);
        setBuild(null);
        setSubmitting(false);
        setDetailId(null);
        setResults({
          rows: res.rows ?? [],
          count: res.count ?? (res.rows ? res.rows.length : 0),
          latency_ms: res.latency_ms ?? 0,
          toolName: cap?.name ?? '',
          reused: true,
          saved: false,
          capId: id,
        });
        refreshLibrary();
      } catch (e) {
        setResults({
          rows: [],
          count: 0,
          latency_ms: 0,
          toolName: cap?.name ?? '',
          reused: true,
          saved: false,
          capId: id,
        });
        // Surface the failure without crashing; reuse the empty-state panel.
        setBuild(null);
        // eslint-disable-next-line no-console
        console.error('Run failed:', msg(e));
      } finally {
        setRunningId(null);
      }
    },
    [runningId, year, refreshLibrary],
  );

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  return {
    // state
    library,
    health,
    judge,
    askText,
    year,
    submitting,
    build,
    results,
    detailId,
    runningId,
    // setters / actions
    setJudge,
    setAskText,
    setYear,
    startBuild,
    approve,
    runSaved,
    openDetail,
    closeDetail,
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
