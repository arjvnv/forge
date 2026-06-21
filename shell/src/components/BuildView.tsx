import { useEffect, useState } from 'react';
import type { AppState, BuildEvent, BuildStage } from '../types';

interface BuildViewProps {
  events: BuildEvent[];
  appState: AppState;
  capabilityId: string | null;
  onApprove: () => void;
}

const STAGE_COLOR: Record<BuildStage, string> = {
  routing: 'text-slate-400',
  gap: 'text-slate-400',
  synthesizing: 'text-slate-400',
  verifying: 'text-slate-400',
  executing: 'text-slate-400',
  reuse: 'text-blue-400',
  synthesized: 'text-slate-300',
  verified: 'text-yellow-400',
  approved: 'text-green-400',
  installed: 'text-green-400',
  done: 'text-green-400',
  verify_failed: 'text-red-400',
  error: 'text-red-400',
  timeout: 'text-red-400',
};

// Stages whose work is still ongoing — the latest one gets a spinner.
const IN_PROGRESS: ReadonlySet<BuildStage> = new Set([
  'routing',
  'gap',
  'synthesizing',
  'verifying',
  'executing',
]);

// Left-border accent driven by the overall app state.
const ACCENT: Record<AppState, string> = {
  idle: 'border-l-slate-700',
  building: 'border-l-blue-500',
  awaiting_approval: 'border-l-yellow-400',
  done: 'border-l-green-500',
  error: 'border-l-red-500',
};

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400"
    />
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`text-lg leading-none ${color}`}>●</span>;
}

export default function BuildView({
  events,
  appState,
  capabilityId,
  onApprove,
}: BuildViewProps) {
  const [approveClicked, setApproveClicked] = useState(false);

  // Reset the one-shot approve guard whenever a new build starts.
  useEffect(() => {
    setApproveClicked(false);
  }, [capabilityId]);

  const lastIndex = events.length - 1;
  const lastEvent = lastIndex >= 0 ? events[lastIndex] : null;

  const showApprove =
    appState === 'awaiting_approval' &&
    lastEvent?.stage === 'verified' &&
    capabilityId !== null;

  const handleApprove = () => {
    if (approveClicked) return;
    setApproveClicked(true);
    onApprove();
  };

  return (
    <section
      className={`rounded-xl border border-slate-700 border-l-4 bg-slate-800/50 p-4 transition-all duration-200 ${ACCENT[appState]}`}
    >
      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Your build will appear here
        </p>
      ) : (
        <ol className="space-y-3">
          {events.map((event, i) => {
            const isLast = i === lastIndex;
            const color = STAGE_COLOR[event.stage] ?? 'text-slate-400';
            const spinning =
              isLast &&
              IN_PROGRESS.has(event.stage) &&
              (appState === 'building' || appState === 'awaiting_approval');

            const reuseId =
              event.stage === 'reuse'
                ? (event.payload?.capability_id as string | undefined)
                : undefined;

            return (
              <li
                key={i}
                className="flex items-start gap-3 transition-all duration-200"
              >
                <span className="mt-0.5 flex w-4 justify-center">
                  {spinning ? <Spinner /> : <Dot color={color} />}
                </span>
                <span
                  className={`w-28 shrink-0 font-mono text-xs uppercase tracking-wide ${color}`}
                >
                  {event.stage}
                </span>
                <span className="flex-1 text-sm text-slate-300">
                  {event.stage === 'reuse' && reuseId
                    ? `Found existing: ${reuseId}`
                    : event.message}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {showApprove && (
        <div className="mt-4 flex items-center gap-3 border-t border-slate-700 pt-4">
          <button
            type="button"
            onClick={handleApprove}
            disabled={approveClicked}
            className="rounded-lg bg-green-600 px-5 py-2 font-semibold text-white transition-all duration-200 hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {approveClicked ? 'Approving…' : 'Approve & Install'}
          </button>
          <span className="text-xs text-slate-500">
            Human-in-the-loop gate — review the logic before it runs on patient
            data.
          </span>
        </div>
      )}
    </section>
  );
}
