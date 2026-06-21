import type { Manifest } from '../types';

interface LibraryShelfProps {
  capabilities: Manifest[];
  onRun: (id: string) => void;
  runningId: string | null;
}

// Compact "MMM D" date for the forged-on metadata. Guards invalid/missing ISO.
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function RunSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-forge-border border-t-forge-ember"
    />
  );
}

export default function LibraryShelf({
  capabilities,
  onRun,
  runningId,
}: LibraryShelfProps) {
  if (capabilities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-forge-border bg-forge-surface/40 p-10 text-center">
        <span
          aria-hidden
          className="mb-3 block animate-forge-emberbreath text-4xl text-forge-ghost"
        >
          ⬡
        </span>
        <p className="text-sm text-forge-muted">No tools forged yet</p>
        <p className="mt-1 text-xs text-forge-faint">
          Describe a clinical tool to forge your first.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {capabilities.map((cap) => {
        const running = runningId === cap.id;
        return (
          <li key={cap.id}>
            <button
              type="button"
              onClick={() => onRun(cap.id)}
              disabled={running}
              className="group w-full rounded-xl border border-forge-border bg-forge-surface p-4 text-left transition-all duration-200 hover:border-forge-ember/50 hover:bg-forge-raised hover:shadow-[0_0_24px_-10px_rgba(245,158,11,0.5)] focus-visible:ring-2 focus-visible:ring-forge-ember/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-void disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="truncate font-mono text-sm font-semibold text-forge-text">
                  {cap.name}
                </span>
                <span className="shrink-0 rounded-full border border-forge-ember/30 bg-forge-ember/10 px-2 py-0.5 font-mono text-xs text-forge-emberhi">
                  ×{cap.reuse_count}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm text-forge-muted">
                {cap.description}
              </p>
              <div className="my-3 h-px bg-forge-border" />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-forge-faint">
                  <span aria-hidden>⬡</span> forged {formatDate(cap.created_at)}
                </span>
                {running ? (
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-forge-ember">
                    <RunSpinner /> running…
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-forge-faint transition-colors group-hover:text-forge-ember">
                    <span aria-hidden>▶</span> run
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
