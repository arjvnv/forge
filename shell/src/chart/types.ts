// Shared chart types for the Visualize feature.
//
// `ChartSpec` is the schema carried on a capability's `ui_spec.chart` (emitted by
// the synthesizer, hand-authored on seeds). It is treated as UNTRUSTED data on the
// client: every field is validated/clamped in `select.ts`/`transform.ts` before use.

export type ChartType =
  | 'bar'
  | 'donut'
  | 'histogram'
  | 'scatter'
  | 'grouped_bar'
  | 'kpi';

export type Aggregate = 'count' | 'mean' | 'distribution' | 'none';

export type Axis = 'x' | 'y';

export interface Threshold {
  value: number; // numeric position of the line, e.g. 9
  axis: Axis; // which axis the ReferenceLine sits on
  label: string; // human label, e.g. "9% poor-control line"
}

export interface ChartSpec {
  type: ChartType; // intended chart type
  title?: string; // chart title (falls back to ui_spec.title)
  rationale?: string; // one-line "why this chart" caption
  x?: string; // column bound to x (category or numeric)
  y?: string; // column bound to y (numeric) — scatter/grouped_bar
  group_by?: string; // category column for grouped_bar / color split
  value?: string; // numeric column for histogram/aggregate target
  aggregate?: Aggregate; // how y is derived
  thresholds?: Threshold[]; // 0..n ReferenceLine annotations
  bins?: number; // histogram: target bin count (default 10, clamp 4..20)
  bin_width?: number; // histogram: explicit bin width (optional; overrides bins)
}

/**
 * The result of selection: the chart type that will actually render, the column
 * bindings it should use (already validated against the real rows), the thresholds
 * to draw, and the caption text. `source` records whether the type came from the
 * spec or a heuristic, so the caller can decide caption wording on override.
 */
export interface EffectiveChart {
  type: ChartType;
  title: string;
  rationale: string;
  x?: string;
  y?: string;
  group_by?: string;
  value?: string;
  aggregate: Aggregate;
  thresholds: Threshold[];
  bins?: number;
  bin_width?: number;
  /** 'spec' = the auto type from a valid spec; 'heuristic' = derived from columns;
   *  'override' = user picked this type manually. */
  source: 'spec' | 'heuristic' | 'override';
}

// recharts-ready data shapes produced by transform.ts.

export interface CategoryDatum {
  name: string;
  value: number;
}

export interface HistogramBin {
  bin: string; // human label, e.g. "5–6"
  x0: number;
  x1: number;
  mid: number;
  count: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  id?: string;
}

export interface KpiValue {
  value: number;
  label: string;
}
