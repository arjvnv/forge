// Pure data transforms: rows -> recharts-ready shapes. No React / no recharts here,
// so these are unit-testable in isolation (see transform.test.ts).
//
// All transforms are O(rows) (rows are <= a few hundred) and tolerate missing
// columns / non-numeric / null values by returning empty arrays or dropping the
// offending row — they NEVER throw, so the renderer can always fall back to KPI.

import type {
  CategoryDatum,
  ChartSpec,
  EffectiveChart,
  HistogramBin,
  KpiValue,
  ScatterPoint,
  Threshold,
} from './types';
import { KNOWN_THRESHOLDS, normalizeName } from './select';

type Row = Record<string, unknown>;

const NUMERIC_SENTINELS = new Set(['no test', 'n/a', 'na', 'none', '-', '—', '']);

/**
 * Coerce a cell value to a finite number, or null. Numbers pass through; numeric
 * strings are parsed; known textual sentinels ("no test", "", etc.) and NaN/Infinity
 * become null. Booleans are intentionally NOT treated as numbers.
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || NUMERIC_SENTINELS.has(t.toLowerCase())) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Display label for a possibly-null/blank category cell. */
function catLabel(v: unknown): string {
  if (v == null) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

/** count by category: [{name, value}] sorted desc, blanks bucketed into "—". */
export function countBy(rows: Row[], col: string): CategoryDatum[] {
  if (!col) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const name = catLabel(r[col]);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort(byValueThenName);
}

// Sort by value desc; on a tie, the blank "—" bucket goes last and the rest sort
// by ASCII codepoint (locale-independent, so ordering is deterministic in tests).
function byValueThenName(a: CategoryDatum, b: CategoryDatum): number {
  if (b.value !== a.value) return b.value - a.value;
  if (a.name === '—') return 1;
  if (b.name === '—') return -1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** mean of a numeric column grouped by a category column, ignoring non-numeric. */
export function meanBy(rows: Row[], catCol: string, numCol: string): CategoryDatum[] {
  if (!catCol || !numCol) return [];
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const num = toNumber(r[numCol]);
    if (num === null) continue;
    const name = catLabel(r[catCol]);
    const acc = sums.get(name) ?? { sum: 0, n: 0 };
    acc.sum += num;
    acc.n += 1;
    sums.set(name, acc);
  }
  return [...sums.entries()]
    .map(([name, { sum, n }]) => ({ name, value: Math.round((sum / n) * 100) / 100 }))
    .sort(byValueThenName);
}

const MIN_BINS = 4;
const MAX_BINS = 20;
const DEFAULT_BINS = 10;

function clampBins(bins: number | undefined): number {
  if (bins == null || !Number.isFinite(bins)) return DEFAULT_BINS;
  return Math.max(MIN_BINS, Math.min(MAX_BINS, Math.round(bins)));
}

function fmtEdge(n: number): string {
  // Tidy numeric label: drop trailing zeros, cap at 2 decimals.
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Histogram bins over a numeric column. Drops non-numeric/null values. `bin_width`
 * (if positive) overrides `bins`; otherwise `bins` is clamped to 4..20. Produces
 * contiguous bins [x0, x1) (the last bin is inclusive of the max).
 */
export function bin(
  rows: Row[],
  col: string,
  opts: { bins?: number; bin_width?: number } = {},
): HistogramBin[] {
  if (!col) return [];
  const values: number[] = [];
  for (const r of rows) {
    const n = toNumber(r[col]);
    if (n !== null) values.push(n);
  }
  if (values.length === 0) return [];

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    // Degenerate single-value range: widen slightly so we still draw one bin.
    lo -= 0.5;
    hi += 0.5;
  }

  let count: number;
  let width: number;
  if (opts.bin_width != null && Number.isFinite(opts.bin_width) && opts.bin_width > 0) {
    width = opts.bin_width;
    count = Math.max(1, Math.min(MAX_BINS, Math.ceil((hi - lo) / width)));
  } else {
    count = clampBins(opts.bins);
    width = (hi - lo) / count;
  }

  const bins: HistogramBin[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = lo + i * width;
    const x1 = i === count - 1 ? hi : lo + (i + 1) * width;
    bins.push({
      bin: `${fmtEdge(x0)}–${fmtEdge(x1)}`,
      x0,
      x1,
      mid: (x0 + x1) / 2,
      count: 0,
    });
  }
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1; // max value lands in the last bin
    bins[idx].count += 1;
  }
  return bins;
}

/** Scatter points: keep only rows where both x and y coerce to finite numbers. */
export function points(
  rows: Row[],
  xCol: string,
  yCol: string,
  idCol?: string,
): ScatterPoint[] {
  if (!xCol || !yCol) return [];
  const out: ScatterPoint[] = [];
  for (const r of rows) {
    const x = toNumber(r[xCol]);
    const y = toNumber(r[yCol]);
    if (x === null || y === null) continue;
    const p: ScatterPoint = { x, y };
    if (idCol && r[idCol] != null) p.id = String(r[idCol]);
    out.push(p);
  }
  return out;
}

const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0']);

/** Boolean / yes-no distribution normalized to Yes / No / — buckets. */
export function boolDist(rows: Row[], col: string): CategoryDatum[] {
  if (!col) return [];
  let yes = 0;
  let no = 0;
  let other = 0;
  for (const r of rows) {
    const v = r[col];
    if (v == null || v === '') {
      other += 1;
      continue;
    }
    if (typeof v === 'boolean') {
      v ? (yes += 1) : (no += 1);
      continue;
    }
    const t = String(v).trim().toLowerCase();
    if (TRUE_TOKENS.has(t)) yes += 1;
    else if (FALSE_TOKENS.has(t)) no += 1;
    else other += 1;
  }
  const out: CategoryDatum[] = [];
  if (yes) out.push({ name: 'Yes', value: yes });
  if (no) out.push({ name: 'No', value: no });
  if (other) out.push({ name: '—', value: other });
  return out;
}

/** KPI value: the total count. */
export function kpi(count: number): KpiValue {
  return { value: count, label: count === 1 ? 'patient' : 'patients' };
}

/**
 * Derive threshold lines for the effective chart. Spec thresholds take precedence
 * (already validated/cleaned). When the spec carries none, fall back to the known
 * clinical-threshold map by matching the column name bound to each axis.
 */
export function derive(eff: EffectiveChart): Threshold[] {
  if (eff.thresholds.length > 0) return eff.thresholds;

  const out: Threshold[] = [];
  // histogram / bar: value or x bound to the x axis.
  const xCol = eff.value ?? eff.x;
  if (xCol) {
    const known = KNOWN_THRESHOLDS[normalizeName(xCol)];
    if (known) out.push({ value: known.value, axis: 'x', label: known.label });
  }
  // scatter: y bound to the y axis.
  if (eff.type === 'scatter' && eff.y) {
    const known = KNOWN_THRESHOLDS[normalizeName(eff.y)];
    if (known) out.push({ value: known.value, axis: 'y', label: known.label });
  }
  return out;
}

/**
 * Validate + clean the threshold array from a spec: keep only entries whose value
 * is a finite number and axis is 'x' or 'y'; coerce label to a string. Malformed
 * entries are dropped individually so a partially-bad spec still renders.
 */
export function cleanThresholds(raw: unknown): Threshold[] {
  if (!Array.isArray(raw)) return [];
  const out: Threshold[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const obj = t as Record<string, unknown>;
    const value = typeof obj.value === 'number' ? obj.value : Number(obj.value);
    if (!Number.isFinite(value)) continue;
    const axis = obj.axis === 'x' || obj.axis === 'y' ? obj.axis : null;
    if (!axis) continue;
    const label = obj.label == null ? '' : String(obj.label);
    out.push({ value, axis, label });
  }
  return out;
}

/** Read a (possibly bad) bins hint from a spec, clamped — exported for select.ts. */
export function specBins(spec: ChartSpec): number | undefined {
  if (spec.bins == null) return undefined;
  return clampBins(spec.bins);
}
