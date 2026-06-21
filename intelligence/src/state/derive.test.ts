import { describe, expect, it } from 'vitest';
import {
  bandColor,
  buildCostMap,
  deriveRoutingDecisions,
  deriveStats,
  deriveStreamRows,
  THRESHOLD,
} from './derive';
import type { Manifest, StreamEvent } from '../api/types';

let seq = 0;
function ev(
  capId: string,
  stage: string,
  ts: number,
  payload: Record<string, unknown> = {},
  message = '',
): StreamEvent {
  return { id: `${seq++}`, capability_id: capId, stage, message, payload, ts };
}

function manifest(partial: Partial<Manifest> & { id: string; name: string }): Manifest {
  return {
    description: '',
    inputs: {},
    output: {},
    reads: [],
    actions: [],
    scope: {},
    reuse_count: 0,
    created_at: '',
    built_from: [],
    provenance: null,
    ...partial,
  };
}

const builtCap = manifest({
  id: 'cap-built',
  name: 'New Roster',
  reads: ['patients'],
  provenance: {
    build_cost: 2410,
    input_tokens: 1800,
    output_tokens: 610,
    trace: [],
    verification: {},
    first_run_ms: 18400,
    best_similarity: 0.41,
  },
});

const seedCap = manifest({
  id: 'cap-seed',
  name: 'Diabetes A1c Monitoring Roster',
  reads: ['patients', 'conditions'],
  reuse_count: 3,
  provenance: null,
});

describe('bandColor', () => {
  it('uses the real 0.62 threshold for the green band', () => {
    expect(THRESHOLD).toBe(0.62);
    expect(bandColor(0.62)).toBe('#16a34a');
    expect(bandColor(0.61)).toBe('#f59e0b');
    expect(bandColor(0.3)).toBe('#f59e0b');
    expect(bandColor(0.29)).toBe('#cbd5e1');
  });
});

describe('buildCostMap', () => {
  it('maps built caps to cost and seeds to 0', () => {
    const map = buildCostMap([builtCap, seedCap]);
    expect(map['cap-built']).toBe(2410);
    expect(map['cap-seed']).toBe(0);
  });
});

describe('deriveRoutingDecisions', () => {
  it('classifies a BUILT decision with best_similarity and build cost', () => {
    const events: StreamEvent[] = [
      ev('b1', 'routing', 100, { text: 'find hypertensive patients' }),
      ev('b1', 'gap', 101, { best_similarity: 0.41 }),
      ev('b1', 'synthesized', 110, { input_tokens: 1800, output_tokens: 610 }),
      ev('b1', 'done', 118.4, { result: { count: 31 } }),
    ];
    const [d] = deriveRoutingDecisions(events, [], 100);
    expect(d.kind).toBe('BUILT');
    expect(d.query).toBe('find hypertensive patients');
    expect(d.similarity).toBe(0.41);
    expect(d.statsLine).toContain('2,410 tokens');
    expect(d.statsLine).toContain('18.4s');
    expect(d.inProgress).toBe(false);
  });

  it('classifies a REUSED decision and computes tokens saved from build cost', () => {
    const events: StreamEvent[] = [
      ev('r1', 'routing', 200, { text: 'show diabetics with high A1c' }),
      ev('r1', 'reuse', 201, { capability_id: 'cap-built', similarity: 0.91 }),
      ev('r1', 'executing', 201.1),
      ev('r1', 'done', 201.4, { result: { count: 12 } }),
    ];
    const [d] = deriveRoutingDecisions(events, [builtCap], 200);
    expect(d.kind).toBe('REUSED');
    expect(d.name).toBe('New Roster');
    expect(d.similarity).toBe(0.91);
    expect(d.statsLine).toContain('Saved ~2,410 tokens');
  });

  it('reuse of a seed saves 0 tokens (honest, not estimated)', () => {
    const events: StreamEvent[] = [
      ev('r2', 'routing', 300, { text: 'diabetic roster' }),
      ev('r2', 'reuse', 301, { capability_id: 'cap-seed', similarity: 0.88 }),
      ev('r2', 'done', 301.3, { result: { count: 5 } }),
    ];
    const [d] = deriveRoutingDecisions(events, [seedCap], 300);
    expect(d.statsLine).toContain('Saved ~0 tokens');
  });

  it('excludes decisions before the session start', () => {
    const events: StreamEvent[] = [
      ev('old', 'routing', 50, { text: 'old query' }),
      ev('old', 'gap', 51, { best_similarity: 0.2 }),
      ev('new', 'routing', 200, { text: 'new query' }),
      ev('new', 'gap', 201, { best_similarity: 0.3 }),
    ];
    const decisions = deriveRoutingDecisions(events, [], 100);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].query).toBe('new query');
  });

  it('marks an unfinished decision as in-progress', () => {
    const events: StreamEvent[] = [
      ev('p1', 'routing', 400, { text: 'building...' }),
      ev('p1', 'gap', 401, { best_similarity: 0.4 }),
      ev('p1', 'synthesizing', 402),
    ];
    const [d] = deriveRoutingDecisions(events, [], 400);
    expect(d.inProgress).toBe(true);
    expect(d.latestStage).toBe('synthesizing');
  });
});

describe('deriveStats', () => {
  it('aggregates tokens spent/saved and reuse rate over the session', () => {
    const events: StreamEvent[] = [
      // built
      ev('b1', 'routing', 100, { text: 'q1' }),
      ev('b1', 'gap', 101, { best_similarity: 0.41 }),
      ev('b1', 'synthesized', 110, { input_tokens: 1800, output_tokens: 610 }),
      ev('b1', 'done', 118, { result: { count: 31 } }),
      // reuse of built cap
      ev('r1', 'routing', 200, { text: 'q2' }),
      ev('r1', 'reuse', 201, { capability_id: 'cap-built', similarity: 0.91 }),
      ev('r1', 'done', 201.4, { result: { count: 12 } }),
    ];
    const decisions = deriveRoutingDecisions(events, [builtCap], 100);
    const stats = deriveStats(decisions);
    expect(stats.total).toBe(2);
    expect(stats.builtCount).toBe(1);
    expect(stats.reuseCount).toBe(1);
    expect(stats.tokensSpent).toBe(2410);
    expect(stats.tokensSaved).toBe(2410);
    expect(stats.reuseRatePct).toBeCloseTo(50);
  });

  it('is zero-safe with no decisions', () => {
    const stats = deriveStats([]);
    expect(stats.reuseRatePct).toBe(0);
    expect(stats.total).toBe(0);
  });
});

describe('deriveStreamRows', () => {
  it('returns newest-first rows with real stage + short desc', () => {
    const events: StreamEvent[] = [
      ev('x', 'routing', 1, { text: 'q' }),
      ev('x', 'synthesized', 2, { input_tokens: 1000, output_tokens: 410 }),
      ev('x', 'done', 3, { result: { count: 7 } }),
    ];
    const rows = deriveStreamRows(events, [], 6);
    expect(rows[0].stage).toBe('done');
    expect(rows[0].desc).toBe('7 rows');
    expect(rows[1].desc).toBe('1,410 tokens');
  });
});
