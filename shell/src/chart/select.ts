// Pure selection + heuristic engine: classify columns, validate a (untrusted) spec
// against the real rows, choose the effective chart type, and enumerate the valid
// alternative types for the override control. No React / no recharts imports.
//
// The only "clinical knowledge" constants in the whole feature live here:
// KNOWN_THRESHOLDS and MAX_CATEGORY_CARD — documented below.

import type {
  Aggregate,
  ChartSpec,
  ChartType,
  EffectiveChart,
} from './types';
import { cleanThresholds, specBins, toNumber } from './transform';

type Row = Record<string, unknown>;

// ── Canonical id/date column rule ────────────────────────────────────────────
// Single source of truth, imported by ResultsTable (replaces its local duplicate).
// Extended from the original `(_id$|^id$|date)` with birthdate/deathdate so those
// patient columns are never treated as a numeric metric or category.
export const ID_DATE_RE = /(_id$|^id$|date|birthdate|deathdate)/i;

export function isIdDateCol(col: string): boolean {
  return ID_DATE_RE.test(col);
}

// ── Clinical knowledge constants ─────────────────────────────────────────────
// Known clinical thresholds, keyed by NORMALIZED column name (see normalizeName).
// Lets the heuristic annotate a chart even when the spec carries no thresholds.
// The spec's explicit thresholds always take precedence (see transform.derive).
export const KNOWN_THRESHOLDS: Record<string, { value: number; label: string }> = {
  a1c: { value: 9, label: '9% poor-control line' },
  hemoglobina1c: { value: 9, label: '9% poor-control line' },
  mostrecenta1c: { value: 9, label: '9% poor-control line' },
  systolic: { value: 140, label: '140 systolic threshold' },
  diastolic: { value: 90, label: '90 diastolic threshold' },
  bmi: { value: 30, label: 'obesity (BMI 30)' },
  ldl: { value: 100, label: 'LDL goal 100' },
};

// Max distinct values for a string column to count as a chartable category.
// Stops patient_id / high-cardinality / free text from becoming an axis.
export const MAX_CATEGORY_CARD = 12;

// How many rows to sample when classifying columns (rows are small; this is a guard).
const SAMPLE_SIZE = 200;

// The distinct/row ratio is only a reliable high-cardinality signal once there are
// at least this many rows; below it, the absolute MAX_CATEGORY_CARD cap is used alone.
const RATIO_MIN_ROWS = 20;

// Minimum fraction of non-null sampled values that must be numeric to call a column
// numeric (per plan: 80%).
const NUMERIC_MIN_FRACTION = 0.8;

const CHART_TYPES: ReadonlySet<ChartType> = new Set([
  'bar',
  'donut',
  'histogram',
  'scatter',
  'grouped_bar',
  'kpi',
]);

const BOOL_TOKENS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '0', '1']);

/** Normalize a column name for threshold-map lookup: lowercase, strip non-alphanumerics. */
export function normalizeName(col: string): string {
  return col.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type ColKind = 'id_date' | 'numeric' | 'boolean' | 'categorical' | 'high_card';

export interface ColInfo {
  name: string;
  kind: ColKind;
  distinct: number;
}

/** Classify every column of the result by inferred type (run over a row sample). */
export function classifyColumns(rows: Row[]): ColInfo[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const sample = rows.slice(0, SAMPLE_SIZE);
  const n = sample.length;

  return cols.map((name): ColInfo => {
    if (isIdDateCol(name)) {
      return { name, kind: 'id_date', distinct: 0 };
    }

    let nonNull = 0;
    let numericCount = 0;
    const distinctVals = new Set<string>();
    const lowerVals = new Set<string>();
    for (const r of sample) {
      const v = r[name];
      if (v == null || v === '') continue;
      nonNull += 1;
      distinctVals.add(String(v));
      lowerVals.add(String(v).trim().toLowerCase());
      if (toNumber(v) !== null) numericCount += 1;
    }

    const distinct = distinctVals.size;

    // numeric: >= NUMERIC_MIN_FRACTION of non-null sampled values are numbers.
    if (nonNull > 0 && numericCount / nonNull >= NUMERIC_MIN_FRACTION) {
      return { name, kind: 'numeric', distinct };
    }

    // boolean / yes-no: small distinct set all within the boolean token vocabulary.
    if (
      nonNull > 0 &&
      lowerVals.size > 0 &&
      lowerVals.size <= 3 &&
      [...lowerVals].every((v) => BOOL_TOKENS.has(v))
    ) {
      return { name, kind: 'boolean', distinct };
    }

    // categorical: low-cardinality string column. The distinct/row ratio guard
    // (rejects high-cardinality free text) is only meaningful once there are
    // enough rows to estimate it; below RATIO_MIN_ROWS the absolute cardinality
    // cap (MAX_CATEGORY_CARD) is the reliable signal.
    if (
      distinct > 0 &&
      distinct <= MAX_CATEGORY_CARD &&
      (n < RATIO_MIN_ROWS || distinct / n <= 0.5)
    ) {
      return { name, kind: 'categorical', distinct };
    }

    return { name, kind: 'high_card', distinct };
  });
}

function colsByKind(info: ColInfo[], kind: ColKind): ColInfo[] {
  return info.filter((c) => c.kind === kind);
}

/** A spec is structurally valid only if `type` is in the enum. */
function isKnownType(t: unknown): t is ChartType {
  return typeof t === 'string' && CHART_TYPES.has(t as ChartType);
}

function colExists(info: ColInfo[], col: string | undefined): ColInfo | null {
  if (!col) return null;
  return info.find((c) => c.name === col) ?? null;
}

/**
 * Validate a spec's required bindings against the classified columns for its type.
 * Returns true only if every required-for-the-type binding exists and has a usable
 * kind. (Threshold cleaning happens separately and never invalidates the spec.)
 */
export function validateSpec(spec: ChartSpec | null | undefined, info: ColInfo[]): boolean {
  if (!spec || !isKnownType(spec.type)) return false;

  const usableNumeric = (c: ColInfo | null) => c != null && c.kind === 'numeric';
  const usableCategory = (c: ColInfo | null) =>
    c != null && (c.kind === 'categorical' || c.kind === 'boolean');

  switch (spec.type) {
    case 'kpi':
      return true;
    case 'bar':
      return usableCategory(colExists(info, spec.x));
    case 'donut':
      return usableCategory(colExists(info, spec.x));
    case 'histogram':
      return usableNumeric(colExists(info, spec.value ?? spec.x));
    case 'scatter':
      return usableNumeric(colExists(info, spec.x)) && usableNumeric(colExists(info, spec.y));
    case 'grouped_bar':
      return usableCategory(colExists(info, spec.x)) && usableCategory(colExists(info, spec.group_by));
    default:
      return false;
  }
}

function toEffectiveFromSpec(spec: ChartSpec, fallbackTitle: string): EffectiveChart {
  const thresholds = cleanThresholds(spec.thresholds);
  const aggregate: Aggregate = spec.aggregate ?? defaultAggregate(spec.type);
  return {
    type: spec.type,
    title: (spec.title && spec.title.trim()) || fallbackTitle,
    rationale: (spec.rationale && spec.rationale.trim()) || genericRationale(spec.type, spec),
    x: spec.x,
    y: spec.y,
    group_by: spec.group_by,
    value: spec.value ?? (spec.type === 'histogram' ? spec.x : undefined),
    aggregate,
    thresholds,
    bins: specBins(spec),
    bin_width:
      spec.bin_width != null && Number.isFinite(spec.bin_width) && spec.bin_width > 0
        ? spec.bin_width
        : undefined,
    source: 'spec',
  };
}

function defaultAggregate(type: ChartType): Aggregate {
  switch (type) {
    case 'histogram':
      return 'distribution';
    case 'scatter':
      return 'none';
    default:
      return 'count';
  }
}

function genericRationale(type: ChartType, eff: { x?: string; y?: string; value?: string }): string {
  const col = eff.value ?? eff.x ?? '';
  const pretty = col ? col.replace(/_/g, ' ') : 'the result';
  switch (type) {
    case 'histogram':
      return `Distribution of ${pretty}.`;
    case 'bar':
      return `Count of patients by ${pretty}.`;
    case 'donut':
      return `Breakdown of patients by ${pretty}.`;
    case 'scatter':
      return `Each point is a patient (${eff.x} vs ${eff.y}).`;
    case 'grouped_bar':
      return `Counts grouped by ${pretty}.`;
    case 'kpi':
    default:
      return 'Total patients — no distribution to plot.';
  }
}

/**
 * The heuristic decision table (first match wins). Operates only on classified
 * columns. Never returns grouped_bar (spec/override only, per plan).
 */
function heuristic(info: ColInfo[], fallbackTitle: string): EffectiveChart {
  const numeric = colsByKind(info, 'numeric');
  const booleans = colsByKind(info, 'boolean');
  const categorical = colsByKind(info, 'categorical');

  const kpiFallback = (): EffectiveChart => ({
    type: 'kpi',
    title: fallbackTitle,
    rationale: genericRationale('kpi', {}),
    aggregate: 'count',
    thresholds: [],
    source: 'heuristic',
  });

  // exactly one boolean col -> donut.
  if (booleans.length === 1 && categorical.length === 0) {
    const col = booleans[0].name;
    return {
      type: 'donut',
      title: fallbackTitle,
      rationale: genericRationale('donut', { x: col }),
      x: col,
      aggregate: 'count',
      thresholds: [],
      source: 'heuristic',
    };
  }

  // >=1 categorical (lowest cardinality preferred) -> bar if >5 distinct else donut.
  if (categorical.length > 0) {
    const col = [...categorical].sort((a, b) => a.distinct - b.distinct)[0];
    const type: ChartType = col.distinct > 5 ? 'bar' : 'donut';
    return {
      type,
      title: fallbackTitle,
      rationale: genericRationale(type, { x: col.name }),
      x: col.name,
      aggregate: 'count',
      thresholds: [],
      source: 'heuristic',
    };
  }

  // >=2 numeric -> scatter on first two.
  if (numeric.length >= 2) {
    const x = numeric[0].name;
    const y = numeric[1].name;
    return {
      type: 'scatter',
      title: fallbackTitle,
      rationale: genericRationale('scatter', { x, y }),
      x,
      y,
      aggregate: 'none',
      thresholds: [],
      source: 'heuristic',
    };
  }

  // exactly one numeric -> histogram.
  if (numeric.length === 1) {
    const col = numeric[0].name;
    return {
      type: 'histogram',
      title: fallbackTitle,
      rationale: genericRationale('histogram', { value: col }),
      value: col,
      aggregate: 'distribution',
      thresholds: [],
      bins: 10,
      source: 'heuristic',
    };
  }

  // only id/date, or nothing chartable -> kpi.
  return kpiFallback();
}

/**
 * Build an EffectiveChart for a user-chosen override type, deriving fresh bindings
 * from the classified columns. If the type isn't actually satisfiable, returns null
 * so the caller falls back to the auto choice.
 */
function overrideEffective(
  type: ChartType,
  info: ColInfo[],
  fallbackTitle: string,
): EffectiveChart | null {
  const numeric = colsByKind(info, 'numeric');
  const booleans = colsByKind(info, 'boolean');
  const categorical = colsByKind(info, 'categorical');
  const anyCategory = [...categorical, ...booleans].sort((a, b) => a.distinct - b.distinct);

  const base = (over: Partial<EffectiveChart>): EffectiveChart => ({
    type,
    title: fallbackTitle,
    rationale: genericRationale(type, over),
    aggregate: defaultAggregate(type),
    thresholds: [],
    source: 'override',
    ...over,
  });

  switch (type) {
    case 'kpi':
      return base({});
    case 'histogram':
      return numeric.length >= 1 ? base({ value: numeric[0].name, bins: 10 }) : null;
    case 'scatter':
      return numeric.length >= 2 ? base({ x: numeric[0].name, y: numeric[1].name }) : null;
    case 'bar':
      return anyCategory.length >= 1 ? base({ x: anyCategory[0].name }) : null;
    case 'donut':
      return anyCategory.length >= 1 ? base({ x: anyCategory[0].name }) : null;
    case 'grouped_bar': {
      const cats = [...categorical, ...booleans].sort((a, b) => a.distinct - b.distinct);
      return cats.length >= 2 ? base({ x: cats[0].name, group_by: cats[1].name }) : null;
    }
    default:
      return null;
  }
}

/**
 * Choose the effective chart. Priority:
 *  1. A valid user override (re-validated against the data).
 *  2. A valid spec.
 *  3. The heuristic.
 * Always returns a renderable EffectiveChart (worst case: KPI).
 */
export function chooseEffective(
  spec: ChartSpec | null | undefined,
  rows: Row[],
  override: ChartType | null | undefined,
  fallbackTitle: string,
): EffectiveChart {
  const info = classifyColumns(rows);

  if (override) {
    const eff = overrideEffective(override, info, fallbackTitle);
    if (eff) {
      // Carry spec thresholds onto an override of the same type so threshold lines persist.
      if (spec && validateSpec(spec, info) && spec.type === override) {
        const cleaned = cleanThresholds(spec.thresholds);
        if (cleaned.length) eff.thresholds = cleaned;
      }
      return eff;
    }
    // override not satisfiable -> fall through to auto choice.
  }

  if (validateSpec(spec, info)) {
    return toEffectiveFromSpec(spec as ChartSpec, fallbackTitle);
  }

  return heuristic(info, fallbackTitle);
}

/**
 * Enumerate every chart type whose required bindings are satisfiable from the data.
 * kpi is always present (count is always available for count>0). The list drives
 * the override control; callers should highlight the auto type and show it first.
 * grouped_bar is intentionally excluded from auto-selection but appears here only
 * when two category columns genuinely exist (so the user CAN pick it).
 */
export function listValidTypes(rows: Row[]): ChartType[] {
  const info = classifyColumns(rows);
  const numeric = colsByKind(info, 'numeric');
  const booleans = colsByKind(info, 'boolean');
  const categorical = colsByKind(info, 'categorical');
  const catTotal = categorical.length + booleans.length;

  const out: ChartType[] = [];
  if (catTotal >= 1) {
    out.push('bar', 'donut');
  }
  if (numeric.length >= 1) out.push('histogram');
  if (numeric.length >= 2) out.push('scatter');
  if (catTotal >= 2) out.push('grouped_bar');
  out.push('kpi');
  return out;
}
