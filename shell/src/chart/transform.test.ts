import { describe, expect, it } from 'vitest';
import {
  bin,
  boolDist,
  cleanThresholds,
  countBy,
  derive,
  kpi,
  meanBy,
  points,
  toNumber,
} from './transform';
import type { EffectiveChart } from './types';

describe('toNumber', () => {
  it('passes finite numbers through', () => {
    expect(toNumber(9)).toBe(9);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-3.5)).toBe(-3.5);
  });
  it('parses numeric strings', () => {
    expect(toNumber('9')).toBe(9);
    expect(toNumber(' 10.4 ')).toBe(10.4);
  });
  it('returns null for sentinels, blanks, null, and non-numeric', () => {
    expect(toNumber('no test')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('controlled')).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
  it('does not treat booleans as numbers', () => {
    expect(toNumber(true)).toBeNull();
    expect(toNumber(false)).toBeNull();
  });
});

describe('countBy', () => {
  it('counts and sorts descending, with a — bucket for blanks', () => {
    const rows = [
      { s: 'poor control' },
      { s: 'controlled' },
      { s: 'controlled' },
      { s: null },
      { s: '' },
    ];
    expect(countBy(rows, 's')).toEqual([
      { name: 'controlled', value: 2 },
      { name: '—', value: 2 },
      { name: 'poor control', value: 1 },
    ]);
  });
  it('returns [] for an unknown column name', () => {
    expect(countBy([{ a: 1 }], '')).toEqual([]);
  });
  it('returns [] for empty rows', () => {
    expect(countBy([], 's')).toEqual([]);
  });
});

describe('meanBy', () => {
  it('averages a numeric column per category, ignoring non-numeric', () => {
    const rows = [
      { g: 'M', v: 10 },
      { g: 'M', v: 'no test' },
      { g: 'M', v: 20 },
      { g: 'F', v: 5 },
    ];
    expect(meanBy(rows, 'g', 'v')).toEqual([
      { name: 'M', value: 15 },
      { name: 'F', value: 5 },
    ]);
  });
  it('returns [] when columns missing', () => {
    expect(meanBy([{ g: 'M', v: 1 }], '', 'v')).toEqual([]);
  });
});

describe('bin', () => {
  it('clamps bin count to 4..20', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ v: i }));
    expect(bin(rows, 'v', { bins: 1 }).length).toBe(4);
    expect(bin(rows, 'v', { bins: 100 }).length).toBe(20);
    expect(bin(rows, 'v', { bins: 8 }).length).toBe(8);
  });
  it('drops non-numeric / None values', () => {
    const rows = [{ v: 1 }, { v: 'no test' }, { v: null }, { v: 9 }];
    const bins = bin(rows, 'v', { bins: 4 });
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(2); // only the two numeric values are counted
  });
  it('produces contiguous bins covering the range, max in last bin', () => {
    const rows = [{ v: 0 }, { v: 5 }, { v: 10 }];
    const bins = bin(rows, 'v', { bins: 5 });
    expect(bins.length).toBe(5);
    expect(bins[0].x0).toBe(0);
    expect(bins[bins.length - 1].x1).toBe(10);
    // every value is binned (no value dropped on boundary)
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(3);
  });
  it('returns [] for empty / all-non-numeric / missing column', () => {
    expect(bin([], 'v')).toEqual([]);
    expect(bin([{ v: 'x' }], 'v')).toEqual([]);
    expect(bin([{ v: 1 }], '')).toEqual([]);
  });
  it('handles a degenerate single-value range without throwing', () => {
    const bins = bin([{ v: 7 }, { v: 7 }], 'v', { bins: 4 });
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });
});

describe('points', () => {
  it('keeps only rows where both x and y are finite numbers', () => {
    const rows = [
      { x: 1, y: 2 },
      { x: 'no test', y: 3 },
      { x: 4, y: null },
      { x: 5, y: 6 },
    ];
    expect(points(rows, 'x', 'y')).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 6 },
    ]);
  });
  it('attaches id when an id column is given', () => {
    expect(points([{ x: 1, y: 2, patient_id: 'a' }], 'x', 'y', 'patient_id')).toEqual([
      { x: 1, y: 2, id: 'a' },
    ]);
  });
  it('returns [] when columns missing', () => {
    expect(points([{ x: 1, y: 2 }], '', 'y')).toEqual([]);
  });
});

describe('boolDist', () => {
  it('normalizes yes/no/true/false/1/0 into Yes / No buckets', () => {
    const rows = [
      { b: 'yes' },
      { b: true },
      { b: 'no' },
      { b: false },
      { b: '1' },
      { b: 0 },
    ];
    expect(boolDist(rows, 'b')).toEqual([
      { name: 'Yes', value: 3 },
      { name: 'No', value: 3 },
    ]);
  });
  it('buckets blanks/unknowns into —', () => {
    const rows = [{ b: 'yes' }, { b: null }, { b: 'maybe' }];
    expect(boolDist(rows, 'b')).toEqual([
      { name: 'Yes', value: 1 },
      { name: '—', value: 2 },
    ]);
  });
  it('returns [] for missing column', () => {
    expect(boolDist([{ b: 'yes' }], '')).toEqual([]);
  });
});

describe('kpi', () => {
  it('returns count with pluralized label', () => {
    expect(kpi(142)).toEqual({ value: 142, label: 'patients' });
    expect(kpi(1)).toEqual({ value: 1, label: 'patient' });
  });
});

describe('cleanThresholds', () => {
  it('keeps valid thresholds and drops malformed ones individually', () => {
    const raw = [
      { value: 9, axis: 'x', label: 'ok' },
      { value: 'bad', axis: 'x', label: 'nope' },
      { value: 5, axis: 'z', label: 'bad axis' },
      { value: 140, axis: 'y', label: 'ok2' },
    ];
    expect(cleanThresholds(raw)).toEqual([
      { value: 9, axis: 'x', label: 'ok' },
      { value: 140, axis: 'y', label: 'ok2' },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(cleanThresholds(undefined)).toEqual([]);
    expect(cleanThresholds('x')).toEqual([]);
  });
});

describe('derive', () => {
  const eff = (over: Partial<EffectiveChart>): EffectiveChart => ({
    type: 'histogram',
    title: 't',
    rationale: 'r',
    aggregate: 'distribution',
    thresholds: [],
    source: 'heuristic',
    ...over,
  });
  it('returns spec thresholds when present', () => {
    const t = [{ value: 9, axis: 'x' as const, label: 'l' }];
    expect(derive(eff({ thresholds: t, value: 'most_recent_a1c' }))).toEqual(t);
  });
  it('falls back to the known-threshold map by column name', () => {
    const out = derive(eff({ value: 'most_recent_a1c' }));
    expect(out).toEqual([{ value: 9, axis: 'x', label: '9% poor-control line' }]);
  });
  it('adds a y-axis threshold for scatter when y matches the map', () => {
    const out = derive(eff({ type: 'scatter', x: 'diastolic', y: 'systolic', aggregate: 'none' }));
    expect(out).toContainEqual({ value: 140, axis: 'y', label: '140 systolic threshold' });
    expect(out).toContainEqual({ value: 90, axis: 'x', label: '90 diastolic threshold' });
  });
  it('returns [] when no column matches the map', () => {
    expect(derive(eff({ value: 'weight' }))).toEqual([]);
  });
});
