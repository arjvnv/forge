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

// Presentation-only mapping of appState → status-bar indicator (no new state).
const STATUS_INDICATOR: Record<
  AppState,
  { label: string; color: string; pulse: boolean }
> = {
  idle: { label: 'IDLE', color: 'text-forge-faint', pulse: false },
  building: { label: 'FORGING', color: 'text-forge-ember', pulse: true },
  awaiting_approval: {
    label: 'AWAITING APPROVAL',
    color: 'text-forge-emberhi',
    pulse: true,
  },
  done: { label: 'READY', color: 'text-forge-forged', pulse: false },
  error: { label: 'FAILED', color: 'text-forge-fail', pulse: false },
};

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

  // Presentation-only projection of appState onto the status-bar indicator.
  const status = STATUS_INDICATOR[appState];
  const totalReuses = capabilities.reduce((sum, c) => sum + c.reuse_count, 0);

  return (
    <div className="min-h-full bg-forge-void font-sans text-forge-text">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-forge-border bg-forge-base/90 px-6 py-4 backdrop-blur">
        <h1 className="flex items-center gap-2.5">
          <span aria-hidden className="text-lg text-forge-ember">
            ⬡
          </span>
          <span className="font-mono text-lg font-bold tracking-forge text-forge-text">
            FORGE
          </span>
        </h1>
        <span
          className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider ${status.color}`}
        >
          <span
            aria-hidden
            className={`text-[10px] leading-none ${
              status.pulse ? 'animate-forge-pulse rounded-full' : ''
            }`}
          >
            ●
          </span>
          {status.label}
        </span>
      </header>

      {/* Status / context bar */}
      <div className="flex items-center gap-3 border-b border-forge-border bg-forge-base px-6 py-2 font-mono text-[11px] text-forge-faint">
        <span
          aria-live="polite"
          className={`flex items-center gap-1.5 ${status.color}`}
        >
          <span
            aria-hidden
            className={`text-[9px] leading-none ${
              status.pulse ? 'animate-forge-pulse rounded-full' : ''
            }`}
          >
            ●
          </span>
          {status.label}
        </span>
        <span aria-hidden className="text-forge-ghost">
          ·
        </span>
        <span>{capabilities.length} capabilities forged</span>
        <span aria-hidden className="text-forge-ghost">
          ·
        </span>
        <span>{totalReuses} total reuses</span>
      </div>

      {/* Body */}
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left column: intent + build + results */}
        <div className="flex flex-col gap-6">
          <IntentBar onSubmit={handleSubmit} disabled={isBuilding} />

          {errorMsg && appState === 'error' && (
            <div className="rounded-xl border border-forge-fail/40 bg-forge-fail/[0.08] px-4 py-3 text-sm text-forge-failhi">
              <span aria-hidden className="mr-2">
                ✗
              </span>
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
        <aside className="flex flex-col gap-3 self-start lg:sticky lg:top-24">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-forge text-forge-faint">
              Capability Library
            </h2>
            <span className="font-mono text-xs text-forge-faint">
              {capabilities.length} forged
            </span>
          </div>
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
