import { useEffect, useState } from 'react';
import type { AppState, BuildEvent, BuildStage } from '../types';

interface BuildViewProps {
  events: BuildEvent[];
  appState: AppState;
  capabilityId: string | null;
  onApprove: () => void;
}

type NodeStatus = 'pending' | 'active' | 'complete' | 'failed';

interface PipelineNode {
  key: string;
  label: string;
  status: NodeStatus;
  /** Latest event message relevant to this node (surfaced beside it). */
  message?: string;
}

const NODE_LABELS = ['ROUTE', 'SYNTHESIZE', 'VERIFY', 'EXECUTE'] as const;
const NODE_COUNT = NODE_LABELS.length;

// The node a given stage *activates* (is working on). Stages not here are
// transitional and only advance completion, never set an active node.
const STAGE_ACTIVE_NODE: Partial<Record<BuildStage, number>> = {
  routing: 0,
  synthesizing: 1,
  verifying: 2,
  approved: 3,
  installed: 3,
  executing: 3,
};

// The highest node index a stage proves is *complete-through* (inclusive of
// earlier nodes). Used to compute a monotonic completion frontier.
const STAGE_COMPLETE_THROUGH: Partial<Record<BuildStage, number>> = {
  // ROUTE done once any post-routing stage appears.
  reuse: 0,
  gap: 0,
  synthesizing: 0,
  synthesized: 1,
  verifying: 1,
  verified: 2,
  approved: 2,
  installed: 2,
  executing: 2,
  done: 3,
};

const FAILURE_STAGES: ReadonlySet<BuildStage> = new Set([
  'error',
  'verify_failed',
  'timeout',
]);

const TERMINAL_OK: ReadonlySet<BuildStage> = new Set(['done']);

/**
 * Pure render-time projection of the SSE event stream + appState onto the four
 * fixed pipeline nodes. Monotonic: a node never regresses from complete.
 * Returns the nodes plus flags the view needs (reuse fast-path, terminal ok).
 */
function derivePipeline(
  events: BuildEvent[],
  appState: AppState,
): {
  nodes: PipelineNode[];
  reuseEvent: BuildEvent | null;
  failureEvent: BuildEvent | null;
  isDone: boolean;
} {
  const reuseEvent = events.find((e) => e.stage === 'reuse') ?? null;
  const failureEvent =
    [...events].reverse().find((e) => FAILURE_STAGES.has(e.stage)) ?? null;
  const isDone = events.some((e) => TERMINAL_OK.has(e.stage));

  // Latest message per node (so granular SSE detail stays surfaced).
  const nodeMessages: (string | undefined)[] = new Array(NODE_COUNT).fill(
    undefined,
  );
  // Frontier: highest node index proven complete so far (monotonic).
  let completeThrough = -1;
  // Active node = the activating node of the most recent in-progress event.
  let activeNode = -1;

  for (const event of events) {
    const ct = STAGE_COMPLETE_THROUGH[event.stage];
    if (ct !== undefined && ct > completeThrough) completeThrough = ct;

    const an = STAGE_ACTIVE_NODE[event.stage];
    if (an !== undefined) {
      activeNode = an;
      nodeMessages[an] = event.message;
    }
  }

  // Reuse fast-path: snap every node to complete instantly.
  if (reuseEvent) {
    completeThrough = NODE_COUNT - 1;
    activeNode = -1;
    nodeMessages[0] = reuseEvent.message;
  }

  // Failure: the node active at failure becomes failed; earlier stay complete,
  // later stay pending. Fall back to the furthest-along node if none active.
  let failedNode = -1;
  if (failureEvent) {
    failedNode = activeNode >= 0 ? activeNode : Math.min(completeThrough + 1, NODE_COUNT - 1);
    nodeMessages[failedNode] = failureEvent.message;
  }

  const building =
    appState === 'building' || appState === 'awaiting_approval';

  const nodes: PipelineNode[] = NODE_LABELS.map((label, i) => {
    let status: NodeStatus;
    if (failureEvent && i === failedNode) {
      status = 'failed';
    } else if (i <= completeThrough) {
      status = 'complete';
    } else if (i === activeNode && building && !failureEvent) {
      status = 'active';
    } else {
      status = 'pending';
    }
    return { key: label, label, status, message: nodeMessages[i] };
  });

  return { nodes, reuseEvent, failureEvent, isDone };
}

function CheckGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-forge-border border-t-forge-ember"
    />
  );
}

function NodeDisc({ status, isDone }: { status: NodeStatus; isDone: boolean }) {
  if (status === 'complete') {
    return (
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-300 ${
          isDone
            ? 'bg-forge-forged text-forge-void'
            : 'bg-forge-ember text-forge-void'
        }`}
      >
        <CheckGlyph />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-forge-ember bg-forge-ember/10 shadow-[0_0_18px_0_rgba(245,158,11,0.55)] animate-forge-pulse">
        <span className="h-2 w-2 rounded-full bg-forge-ember" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-forge-fail bg-forge-fail/10 text-forge-failhi shadow-[0_0_18px_0_rgba(239,68,68,0.5)]">
        ✗
      </span>
    );
  }
  // pending
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-forge-faint" />
  );
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

  const { nodes, reuseEvent, failureEvent, isDone } = derivePipeline(
    events,
    appState,
  );

  const reuseId =
    reuseEvent && typeof reuseEvent.payload?.capability_id === 'string'
      ? (reuseEvent.payload.capability_id as string)
      : capabilityId ?? undefined;

  const isEmpty = events.length === 0;

  // Stage label for the failure panel header (e.g. "VERIFY FAILED").
  const failedNodeLabel =
    failureEvent && nodes.find((n) => n.status === 'failed')?.label;

  return (
    <section className="rounded-2xl border border-forge-border bg-forge-surface p-5">
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-forge text-forge-faint">
        Forge Pipeline
      </h3>

      {/* Reuse fast-path banner */}
      {reuseEvent && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-forge-ember/30 bg-forge-ember/10 px-4 py-2.5 font-mono text-xs text-forge-emberhi animate-forge-rise">
          <span aria-hidden>⚡</span>
          <span className="uppercase tracking-wider">Reused</span>
          <span className="text-forge-muted">
            — existing capability {reuseId}
          </span>
        </div>
      )}

      {/* Pipeline */}
      <ol className="relative">
        {nodes.map((node, i) => {
          const isLastNode = i === NODE_COUNT - 1;
          // The rail segment below this node lights once the node is complete
          // (a failed node leaves the rail below it dim — nothing flowed past).
          const railLit = node.status === 'complete';

          const labelColor =
            node.status === 'pending'
              ? 'text-forge-faint'
              : node.status === 'failed'
                ? 'text-forge-failhi'
                : 'text-forge-text';

          const showSpinner =
            node.status === 'active' &&
            (appState === 'building' || appState === 'awaiting_approval');

          return (
            <li key={node.key} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Rail connector (between this disc and the next) */}
              {!isLastNode && (
                <span
                  aria-hidden
                  className="absolute left-3.5 top-7 h-full w-0.5 -translate-x-1/2 bg-forge-border"
                >
                  <span
                    className={`block h-full w-full origin-top bg-forge-ember ${
                      railLit ? 'animate-forge-railfill' : 'scale-y-0'
                    }`}
                  />
                </span>
              )}

              {/* Disc */}
              <span className="relative z-10 mt-0.5 shrink-0">
                <NodeDisc status={node.status} isDone={isDone && isLastNode} />
              </span>

              {/* Label + message */}
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-xs font-semibold uppercase tracking-wider transition-colors duration-300 ${labelColor}`}
                  >
                    {node.label}
                  </span>
                  {showSpinner && <Spinner />}
                </div>
                {(node.message || (isEmpty && i === 0)) && (
                  <p
                    className={`mt-1 text-sm ${
                      node.status === 'failed'
                        ? 'text-forge-failhi'
                        : 'text-forge-muted'
                    }`}
                    aria-live={node.status === 'active' ? 'polite' : undefined}
                  >
                    {node.message ?? 'awaiting intent…'}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Empty-state helper */}
      {isEmpty && (
        <p className="mt-2 text-sm text-forge-faint">
          The pipeline lights up as Forge builds your tool.
        </p>
      )}

      {/* Done caption */}
      {isDone && !failureEvent && (
        <div className="mt-5 flex items-center gap-2">
          <span className="rounded-full bg-forge-forged px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-forge-void">
            ● Forged
          </span>
          <span className="text-sm text-forge-forgedhi">
            Capability installed and executed. See results below.
          </span>
        </div>
      )}

      {/* Approval gate */}
      {showApprove && (
        <div className="mt-5 rounded-xl border border-forge-ember/40 bg-forge-ember/[0.06] p-5 shadow-[0_0_40px_-12px_rgba(245,158,11,0.4)] animate-forge-rise">
          <div className="font-mono text-sm uppercase tracking-wider text-forge-emberhi">
            <span aria-hidden className="mr-2">
              ◆
            </span>
            Verified — Awaiting Approval
          </div>
          <p className="mt-3 text-sm text-forge-muted">
            Forge synthesized and AST-verified this capability. Review the logic
            before it runs on patient data.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={handleApprove}
              disabled={approveClicked}
              className="rounded-lg bg-forge-forged px-6 py-3 font-mono text-sm font-semibold uppercase tracking-wider text-forge-void shadow-[0_0_24px_-4px_rgba(16,185,129,0.6)] transition-all duration-200 hover:bg-forge-forgedhi focus-visible:ring-2 focus-visible:ring-forge-forged/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-void active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-forge-raised disabled:text-forge-ghost disabled:shadow-none"
            >
              {approveClicked ? 'Installing…' : 'Approve & Install'}
            </button>
            <span className="font-mono text-[11px] text-forge-faint">
              Human-in-the-loop gate
            </span>
          </div>
        </div>
      )}

      {/* Failure panel */}
      {failureEvent && (
        <div className="mt-5 rounded-xl border border-forge-fail/40 bg-forge-fail/[0.06] p-5 animate-forge-rise">
          <div className="font-mono text-sm uppercase tracking-wider text-forge-failhi">
            <span aria-hidden className="mr-2">
              ✗
            </span>
            {failedNodeLabel ? `${failedNodeLabel} Failed` : 'Build Failed'}
          </div>
          <p className="mt-3 text-sm text-forge-muted">{failureEvent.message}</p>
        </div>
      )}
    </section>
  );
}
