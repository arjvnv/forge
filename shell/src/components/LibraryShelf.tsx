import type { Manifest } from '../types';

interface LibraryShelfProps {
  capabilities: Manifest[];
  onRun: (id: string) => void;
  runningId: string | null;
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export default function LibraryShelf({
  capabilities,
  onRun,
  runningId,
}: LibraryShelfProps) {
  if (capabilities.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/40 p-8 text-center">
        <span className="mb-2 text-2xl text-slate-600">←</span>
        <p className="text-sm text-slate-500">No capabilities built yet</p>
        <p className="mt-1 text-xs text-slate-600">
          Describe a tool to forge your first one
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
              className="group w-full rounded-xl border border-slate-700 bg-slate-800 p-4 text-left transition-all duration-200 hover:border-blue-500/60 hover:bg-slate-700/60 disabled:cursor-wait disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-slate-100">{cap.name}</span>
                <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 font-mono text-xs text-blue-400">
                  × {cap.reuse_count} {cap.reuse_count === 1 ? 'use' : 'uses'}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {truncate(cap.description)}
              </p>
              <p className="mt-2 text-xs text-slate-600 group-hover:text-blue-400">
                {running ? 'Running…' : 'Click to run →'}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
