// Pure derivations: stream events + capabilities -> dashboard view models.
// No DOM, no React — unit-testable in isolation.

import type { Manifest, StreamEvent } from '../api/types';

export const THRESHOLD = 0.62; // settings.similarity_threshold (REAL)

// ── small helpers ────────────────────────────────────────────────────────────

export function fmtTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

// Bar fill color by similarity, using the REAL 0.62 threshold.
export function bandColor(s: number): string {
  if (s >= THRESHOLD) return '#16a34a'; // reuse band -> green
  if (s >= 0.3) return '#f59e0b'; // mid -> amber
  return '#cbd5e1'; // low -> grey
}

// Stage -> color map (mirrors the design's st()).
export function stageColor(stage: string): string {
  const m: Record<string, string> = {
    done: '#16a34a',
    installed: '#16a34a',
    reuse: '#16a34a',
    approved: '#16a34a',
    synthesizing: '#0d9488',
    synthesized: '#0d9488',
    verified: '#d97706',
    verifying: '#d97706',
    routing: '#64748b',
    gap: '#64748b',
    executing: '#64748b',
    error: '#e11d48',
    verify_failed: '#e11d48',
  };
  return m[stage] ?? '#64748b';
}

export function buildCostMap(caps: Manifest[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of caps) map[m.id] = m.provenance?.build_cost ?? 0;
  return map;
}

// ── routing decisions ────────────────────────────────────────────────────────

const TERMINAL = new Set(['done', 'error', 'verify_failed']);

export interface RoutingDecision {
  capabilityId: string;
  time: string;
  startTs: number;
  kind: 'REUSED' | 'BUILT';
  inProgress: boolean;
  latestStage: string;
  query: string | null; // real intent text (Q1) or null
  name: string; // matched/built capability name (or outcome)
  similarity: number | null; // reuse similarity or built best_similarity
  statsLine: string;
  // For an error/verify_failed terminal decision.
  errorMessage: string | null;
}

interface Group {
  capabilityId: string;
  events: StreamEvent[];
}

function groupByCapability(events: StreamEvent[]): Group[] {
  const order: string[] = [];
  const byId = new Map<string, StreamEvent[]>();
  for (const e of events) {
    if (!e.capability_id) continue;
    if (!byId.has(e.capability_id)) {
      byId.set(e.capability_id, []);
      order.push(e.capability_id);
    }
    byId.get(e.capability_id)!.push(e);
  }
  return order.map((id) => ({ capabilityId: id, events: byId.get(id)! }));
}

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

// Build routing decisions from the session window, newest-first.
export function deriveRoutingDecisions(
  events: StreamEvent[],
  caps: Manifest[],
  sessionStartTs: number | null,
): RoutingDecision[] {
  const costMap = buildCostMap(caps);
  const nameById: Record<string, string> = {};
  for (const m of caps) nameById[m.id] = m.name;

  const groups = groupByCapability(events);
  const decisions: RoutingDecision[] = [];

  for (const g of groups) {
    const evs = g.events;
    const routing = evs.find((e) => e.stage === 'routing');
    const startTs = routing?.ts ?? evs[0].ts;
    // Session boundary: only decisions started at/after dashboard load.
    if (sessionStartTs != null && startTs < sessionStartTs) continue;

    const reuse = evs.find((e) => e.stage === 'reuse');
    const gap = evs.find((e) => e.stage === 'gap');
    const done = evs.find((e) => e.stage === 'done');
    const errorEv = evs.find(
      (e) => e.stage === 'error' || e.stage === 'verify_failed',
    );
    const last = evs[evs.length - 1];
    const inProgress = !TERMINAL.has(last.stage);

    const query =
      (routing?.payload?.text as string | undefined) ??
      (gap?.payload?.text as string | undefined) ??
      null;

    if (reuse) {
      const matchedId = (reuse.payload?.capability_id as string) ?? '';
      const sim = num(reuse.payload?.similarity);
      const saved = costMap[matchedId] ?? 0;
      const retrievedS =
        done && reuse ? Math.max(0, done.ts - reuse.ts) : null;
      const name = nameById[matchedId] || reuse.message || 'Existing capability';
      const statsLine =
        retrievedS != null
          ? `Saved ~${fmtInt(saved)} tokens  ·  retrieved in ${retrievedS.toFixed(1)}s`
          : `Saved ~${fmtInt(saved)} tokens`;
      decisions.push({
        capabilityId: g.capabilityId,
        time: fmtTime(startTs),
        startTs,
        kind: 'REUSED',
        inProgress,
        latestStage: last.stage,
        query,
        name,
        similarity: sim,
        statsLine,
        errorMessage: errorEv ? errorEv.message : null,
      });
    } else if (gap) {
      const best = num(gap.payload?.best_similarity);
      const synth = evs.find((e) => e.stage === 'synthesized');
      const inTok = num(synth?.payload?.input_tokens) ?? 0;
      const outTok = num(synth?.payload?.output_tokens) ?? 0;
      const cost = inTok + outTok;
      // Prefer the just-built cap's persisted name; else the synthesized manifest.
      const synthName =
        (synth?.payload?.manifest as { name?: string } | undefined)?.name;
      const name = nameById[g.capabilityId] || synthName || 'New capability';
      const buildS = done && routing ? Math.max(0, done.ts - routing.ts) : null;
      let statsLine = '';
      if (cost > 0 && buildS != null)
        statsLine = `Build cost  ${fmtInt(cost)} tokens  ·  ${buildS.toFixed(1)}s`;
      else if (cost > 0) statsLine = `Build cost  ${fmtInt(cost)} tokens`;
      decisions.push({
        capabilityId: g.capabilityId,
        time: fmtTime(startTs),
        startTs,
        kind: 'BUILT',
        inProgress,
        latestStage: last.stage,
        query,
        name,
        similarity: best,
        statsLine,
        errorMessage: errorEv ? errorEv.message : null,
      });
    }
    // Groups with neither reuse nor gap (e.g. a crash before routing classified)
    // are skipped — they are not a routing decision.
  }

  decisions.sort((a, b) => b.startTs - a.startTs);
  return decisions;
}

// ── session stats ────────────────────────────────────────────────────────────

export interface SessionStats {
  tokensSpent: number;
  tokensSaved: number;
  reuseRatePct: number; // 0..100
  builtCount: number;
  reuseCount: number;
  total: number;
}

export function deriveStats(decisions: RoutingDecision[]): SessionStats {
  // Count only terminal/complete-ish decisions toward the session story; an
  // in-progress build still counts as a query attempt (matches "total queries").
  const reuseCount = decisions.filter((d) => d.kind === 'REUSED').length;
  const builtCount = decisions.filter((d) => d.kind === 'BUILT').length;
  const total = decisions.length;

  let tokensSpent = 0;
  let tokensSaved = 0;
  for (const d of decisions) {
    if (d.kind === 'BUILT') {
      const m = /Build cost\s+([\d,]+)/.exec(d.statsLine);
      if (m) tokensSpent += Number(m[1].replace(/,/g, ''));
    } else {
      const m = /Saved ~([\d,]+)/.exec(d.statsLine);
      if (m) tokensSaved += Number(m[1].replace(/,/g, ''));
    }
  }
  const reuseRatePct = total > 0 ? (reuseCount / total) * 100 : 0;
  return { tokensSpent, tokensSaved, reuseRatePct, builtCount, reuseCount, total };
}

export function reuseRateColor(pct: number): string {
  if (pct >= 50) return '#16a34a';
  if (pct >= 25) return '#d97706';
  return '#1e293b';
}

// ── live stream rows ─────────────────────────────────────────────────────────

export interface StreamRow {
  time: string;
  stage: string;
  desc: string;
  color: string;
}

function shortDesc(e: StreamEvent, nameById: Record<string, string>): string {
  switch (e.stage) {
    case 'reuse': {
      const s = num(e.payload?.similarity);
      return s != null ? `${s.toFixed(2)} match` : 'match';
    }
    case 'synthesized': {
      const inTok = num(e.payload?.input_tokens) ?? 0;
      const outTok = num(e.payload?.output_tokens) ?? 0;
      const t = inTok + outTok;
      return t > 0 ? `${fmtInt(t)} tokens` : 'logic generated';
    }
    case 'installed': {
      const id = (e.payload?.capability_id as string) ?? e.capability_id;
      return nameById[id] || 'installed';
    }
    case 'routing':
      return 'checking library';
    case 'gap': {
      const b = num(e.payload?.best_similarity);
      return b != null ? `best ${b.toFixed(2)}` : 'no match';
    }
    case 'verified':
      return 'AST passed';
    case 'verifying':
      return 'AST + sandbox';
    case 'done': {
      const r = e.payload?.result as { count?: number } | undefined;
      return r && typeof r.count === 'number' ? `${r.count} rows` : 'complete';
    }
    case 'executing':
      return 'running';
    case 'approved':
      return 'gate released';
    case 'error':
    case 'verify_failed':
      return e.message || 'error';
    default:
      return e.message || e.stage;
  }
}

export function deriveStreamRows(
  events: StreamEvent[],
  caps: Manifest[],
  limit = 6,
): StreamRow[] {
  const nameById: Record<string, string> = {};
  for (const m of caps) nameById[m.id] = m.name;
  return [...events]
    .reverse() // newest-first
    .slice(0, limit)
    .map((e) => ({
      time: fmtTime(e.ts),
      stage: e.stage,
      desc: shortDesc(e, nameById),
      color: stageColor(e.stage),
    }));
}

// ── "each reuse" average (per cap, from session reuse decisions) ─────────────

export function avgReuseSeconds(
  capId: string,
  events: StreamEvent[],
): number | null {
  // Group reuse decisions for this matched cap; average done.ts - reuse.ts.
  const groups = groupByCapability(events);
  const durations: number[] = [];
  for (const g of groups) {
    const reuse = g.events.find((e) => e.stage === 'reuse');
    const done = g.events.find((e) => e.stage === 'done');
    if (!reuse || !done) continue;
    if ((reuse.payload?.capability_id as string) !== capId) continue;
    durations.push(Math.max(0, done.ts - reuse.ts));
  }
  if (durations.length === 0) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

// ── relative time ────────────────────────────────────────────────────────────

export function builtAgo(createdAt: string): string {
  if (!createdAt) return 'Built recently';
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 'Built recently';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Built just now';
  if (mins < 60) return `Built ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Built ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Built ${days}d ago`;
}
