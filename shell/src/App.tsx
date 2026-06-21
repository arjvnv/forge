import { useCallback, useEffect, useRef, useState } from 'react';
import IntentBar from './components/IntentBar';
import BuildView from './components/BuildView';
import ResultTable from './components/ResultTable';
import LibraryShelf from './components/LibraryShelf';
import {
  approveCapability,
  listCapabilities,
  openBuildStream,
  runCapability,
  submitIntent,
} from './api';
import type {
  AppState,
  BuildEvent,
  ExecutionResult,
  Manifest,
} from './types';

const LIBRARY_REFRESH_MS = 10_000;

function extractResult(payload: Record<string, unknown>): ExecutionResult | null {
  const raw = payload?.result;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rows) || typeof r.count !== 'number') return null;
  return {
    rows: r.rows as ExecutionResult['rows'],
    count: r.count,
    columns: Array.isArray(r.columns) ? (r.columns as string[]) : undefined,
  };
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [capabilities, setCapabilities] = useState<Manifest[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Holds the teardown for the currently-open SSE stream, if any.
  const streamCleanupRef = useRef<(() => void) | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const list = await listCapabilities();
      setCapabilities(list);
    } catch {
      // Transient backend hiccup — keep the last good list rather than wiping
      // the shelf mid-demo.
    }
  }, []);

  // Initial load + periodic refresh of the library.
  useEffect(() => {
    void refreshLibrary();
    const id = window.setInterval(() => void refreshLibrary(), LIBRARY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshLibrary]);

  // Tear down any live stream on unmount.
  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, []);

  const handleEvent = useCallback(
    (event: BuildEvent) => {
      setEvents((prev) => [...prev, event]);

      switch (event.stage) {
        case 'verified':
          setAppState('awaiting_approval');
          break;
        case 'done': {
          setResult(extractResult(event.payload));
          setAppState('done');
          break;
        }
        case 'error':
        case 'verify_failed':
        case 'timeout':
          setErrorMsg(event.message || 'Build failed');
          setAppState('error');
          break;
        default:
          break;
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      // Reset for a fresh build; tear down any prior stream first.
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;

      setEvents([]);
      setResult(null);
      setErrorMsg(null);
      setCapabilityId(null);
      setAppState('building');

      let capId: string;
      try {
        const res = await submitIntent(text);
        capId = res.capability_id;
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to submit intent');
        setAppState('error');
        return;
      }

      setCapabilityId(capId);
      streamCleanupRef.current = openBuildStream(
        capId,
        handleEvent,
        () => {
          streamCleanupRef.current = null;
          void refreshLibrary();
        },
      );
    },
    [handleEvent, refreshLibrary],
  );

  const handleApprove = useCallback(async () => {
    if (!capabilityId) return;
    try {
      await approveCapability(capabilityId);
      // The SSE stream continues and will deliver the `approved` event next.
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Approval failed');
      setAppState('error');
    }
  }, [capabilityId]);

  const handleRun = useCallback(
    async (id: string) => {
      setRunningId(id);
      setErrorMsg(null);
      try {
        const res = await runCapability(id);
        setResult(res);
        setAppState('done');
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Run failed');
        setAppState('error');
      } finally {
        setRunningId(null);
        void refreshLibrary();
      }
    },
    [refreshLibrary],
  );

  const isBuilding =
    appState === 'building' || appState === 'awaiting_approval';

  return (
    <div className="min-h-full bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
        <h1 className="font-mono text-xl font-bold tracking-tight text-blue-400">
          FORGE
        </h1>
        <span className="text-sm text-slate-400">
          {capabilities.length}{' '}
          {capabilities.length === 1 ? 'capability' : 'capabilities'} built
        </span>
      </header>

      {/* Body */}
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left column: intent + build + results */}
        <div className="flex flex-col gap-6">
          <IntentBar onSubmit={handleSubmit} disabled={isBuilding} />

          {errorMsg && appState === 'error' && (
            <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {errorMsg}
            </div>
          )}

          <BuildView
            events={events}
            appState={appState}
            capabilityId={capabilityId}
            onApprove={handleApprove}
          />

          <ResultTable result={result} />
        </div>

        {/* Right column: library */}
        <aside className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Capability Library
          </h2>
          <LibraryShelf
            capabilities={capabilities}
            onRun={handleRun}
            runningId={runningId}
          />
        </aside>
      </main>
    </div>
  );
}
