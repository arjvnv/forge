import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { C, MONO } from '../theme';
import { palette } from '../chart/palette';
import { chooseEffective, listValidTypes } from '../chart/select';
import {
  bin,
  boolDist,
  countBy,
  derive,
  kpi as kpiValue,
  meanBy,
  points,
} from '../chart/transform';
import type { ChartSpec, ChartType, EffectiveChart } from '../chart/types';

const CHART_HEIGHT = 320;

const TYPE_LABEL: Record<ChartType, string> = {
  bar: 'Bar',
  donut: 'Donut',
  histogram: 'Histogram',
  scatter: 'Scatter',
  grouped_bar: 'Grouped',
  kpi: 'KPI',
};

interface Row {
  [k: string]: unknown;
}

export default function ResultChart({
  rows,
  count,
  spec,
  title,
  override,
  onOverride,
}: {
  rows: Row[];
  count: number;
  spec: ChartSpec | null;
  title: string;
  override: ChartType | null;
  onOverride: (t: ChartType) => void;
}) {
  // count === 0 → calm empty state, no recharts render.
  if (count === 0) {
    return (
      <ChartFrame>
        <div style={{ padding: '38px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: C.ink2 }}>Nothing to chart.</div>
          <div style={{ fontSize: 12.5, color: C.ink3, marginTop: 5 }}>
            Zero patients matched — the tool ran cleanly.
          </div>
        </div>
      </ChartFrame>
    );
  }

  // Everything below is wrapped so a malformed spec or transform can never
  // unmount the panel: on any throw we fall back to the KPI card.
  let body: React.ReactNode;
  let eff: EffectiveChart;
  let validTypes: ChartType[];
  try {
    eff = chooseEffective(spec, rows, override, title);
    validTypes = listValidTypes(rows);
    body = renderChart(eff, rows, count);
  } catch {
    eff = {
      type: 'kpi',
      title,
      rationale: 'Showing the total — the chart could not be derived.',
      aggregate: 'count',
      thresholds: [],
      source: 'heuristic',
    };
    validTypes = ['kpi'];
    body = <KpiCard count={count} />;
  }

  const ariaLabel = `${eff.title}. ${eff.rationale}`;

  return (
    <ChartFrame>
      <figure
        role="img"
        aria-label={ariaLabel}
        style={{ margin: 0, padding: '16px 20px 18px' }}
      >
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: C.ink,
            marginBottom: 10,
          }}
        >
          {eff.title}
        </div>

        {body}

        {eff.type !== 'kpi' || validTypes.length > 1 ? (
          <OverrideControl
            types={validTypes}
            active={eff.type}
            autoType={
              // The auto type is the spec/heuristic choice ignoring override.
              autoType(spec, rows, title)
            }
            onPick={onOverride}
          />
        ) : null}

        <figcaption
          style={{
            display: 'flex',
            gap: 7,
            alignItems: 'flex-start',
            marginTop: 12,
            fontStyle: 'italic',
            fontSize: 12.5,
            color: C.ink2,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true" style={{ fontStyle: 'normal', color: C.ink3 }}>
            ⓘ
          </span>
          <span>{eff.rationale}</span>
        </figcaption>
      </figure>
    </ChartFrame>
  );
}

/** Compute the auto (non-override) type, so the override control can highlight it. */
function autoType(spec: ChartSpec | null, rows: Row[], title: string): ChartType {
  try {
    return chooseEffective(spec, rows, null, title).type;
  } catch {
    return 'kpi';
  }
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: CHART_HEIGHT }}>{children}</div>;
}

// ── per-type rendering ───────────────────────────────────────────────────────

function renderChart(eff: EffectiveChart, rows: Row[], count: number): React.ReactNode {
  switch (eff.type) {
    case 'bar':
      return <CategoryBar eff={eff} rows={rows} />;
    case 'donut':
      return <Donut eff={eff} rows={rows} />;
    case 'histogram':
      return <Histogram eff={eff} rows={rows} />;
    case 'scatter':
      return <ScatterView eff={eff} rows={rows} />;
    case 'grouped_bar':
      return <GroupedBar eff={eff} rows={rows} />;
    case 'kpi':
    default:
      return <KpiCard count={count} />;
  }
}

const axisStyle = { fontSize: 11, fill: palette.tick } as const;
const monoTick = { fontSize: 11, fill: palette.tick, fontFamily: MONO } as const;

function tooltipProps() {
  return {
    contentStyle: {
      background: palette.tooltipBg,
      border: `1px solid ${palette.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
      color: palette.tooltipText,
    },
    labelStyle: { color: C.ink2, fontWeight: 600 },
  };
}

function thresholdLines(eff: EffectiveChart) {
  return derive(eff).map((t, i) => (
    <ReferenceLine
      key={i}
      {...(t.axis === 'x' ? { x: t.value } : { y: t.value })}
      stroke={palette.threshold}
      strokeDasharray="5 4"
      strokeWidth={1.5}
      label={{
        value: t.label,
        position: t.axis === 'x' ? 'top' : 'insideTopRight',
        fontSize: 10.5,
        fill: C.amberDk,
      }}
    />
  ));
}

function CategoryBar({ eff, rows }: { eff: EffectiveChart; rows: Row[] }) {
  const data = useMemo(
    () =>
      eff.aggregate === 'mean' && eff.value
        ? meanBy(rows, eff.x as string, eff.value)
        : countBy(rows, eff.x as string),
    [eff, rows],
  );
  if (data.length === 0) return <NoData />;
  // For a category bar the threshold lives on the Y (value) axis.
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 6 }}>
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} stroke={palette.axis} interval={0} />
        <YAxis tick={monoTick} stroke={palette.axis} allowDecimals={false} />
        <Tooltip {...tooltipProps()} />
        {thresholdLines(eff)}
        <Bar dataKey="value" fill={palette.cat[0]} radius={[4, 4, 0, 0]} name="patients" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Donut({ eff, rows }: { eff: EffectiveChart; rows: Row[] }) {
  const data = useMemo(() => {
    // Use boolean distribution for a boolean column, else plain count.
    const dist = boolDist(rows, eff.x as string);
    return dist.length > 0 ? dist : countBy(rows, eff.x as string);
  }, [eff, rows]);
  if (data.length === 0) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={62}
          outerRadius={104}
          paddingAngle={1.5}
          label={(d: { name: string; value: number }) => `${d.name}: ${d.value}`}
          labelLine={false}
          fontSize={11}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={palette.cat[i % palette.cat.length]} />
          ))}
        </Pie>
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          formatter={(v) => <span style={{ fontSize: 12, color: C.ink2 }}>{v}</span>}
        />
        <Tooltip {...tooltipProps()} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Histogram({ eff, rows }: { eff: EffectiveChart; rows: Row[] }) {
  const data = useMemo(
    () => bin(rows, (eff.value ?? eff.x) as string, { bins: eff.bins, bin_width: eff.bin_width }),
    [eff, rows],
  );
  if (data.length === 0) return <NoData />;
  // Threshold on a histogram is a vertical line at the bin whose range contains it.
  const lines = derive(eff)
    .filter((t) => t.axis === 'x')
    .map((t, i) => {
      const target = data.find((d) => t.value >= d.x0 && t.value <= d.x1) ?? data[data.length - 1];
      return (
        <ReferenceLine
          key={i}
          x={target.bin}
          stroke={palette.threshold}
          strokeDasharray="5 4"
          strokeWidth={1.5}
          label={{ value: t.label, position: 'top', fontSize: 10.5, fill: C.amberDk }}
        />
      );
    });
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 6 }} barCategoryGap={0}>
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="bin" tick={monoTick} stroke={palette.axis} interval={0} />
        <YAxis tick={monoTick} stroke={palette.axis} allowDecimals={false} />
        <Tooltip {...tooltipProps()} />
        {lines}
        <Bar dataKey="count" fill={palette.cat[0]} name="patients" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScatterView({ eff, rows }: { eff: EffectiveChart; rows: Row[] }) {
  const idCol = useMemo(() => Object.keys(rows[0] ?? {}).find((c) => /(_id$|^id$)/i.test(c)), [rows]);
  const data = useMemo(
    () => points(rows, eff.x as string, eff.y as string, idCol),
    [eff, rows, idCol],
  );
  if (data.length === 0) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <ScatterChart margin={{ top: 18, right: 22, left: 0, bottom: 14 }}>
        <CartesianGrid stroke={palette.grid} />
        <XAxis
          type="number"
          dataKey="x"
          name={eff.x}
          tick={monoTick}
          stroke={palette.axis}
          domain={['dataMin - 5', 'dataMax + 5']}
          label={{ value: eff.x, position: 'insideBottom', offset: -8, fontSize: 11, fill: C.ink3 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={eff.y}
          tick={monoTick}
          stroke={palette.axis}
          domain={['dataMin - 5', 'dataMax + 5']}
          label={{ value: eff.y, angle: -90, position: 'insideLeft', fontSize: 11, fill: C.ink3 }}
        />
        <ZAxis range={[42, 42]} />
        <Tooltip {...tooltipProps()} cursor={{ strokeDasharray: '3 3' }} />
        {thresholdLines(eff)}
        <Scatter data={data} fill={palette.cat[0]} fillOpacity={0.7} name="patients" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function GroupedBar({ eff, rows }: { eff: EffectiveChart; rows: Row[] }) {
  // Pivot: rows -> [{ name: <x category>, <group value>: count, ... }]
  const { data, series } = useMemo(() => {
    const xCol = eff.x as string;
    const gCol = eff.group_by as string;
    const seriesSet = new Set<string>();
    const byX = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const xv = r[xCol] == null || r[xCol] === '' ? '—' : String(r[xCol]);
      const gv = r[gCol] == null || r[gCol] === '' ? '—' : String(r[gCol]);
      seriesSet.add(gv);
      const bucket = byX.get(xv) ?? {};
      bucket[gv] = (bucket[gv] ?? 0) + 1;
      byX.set(xv, bucket);
    }
    const series = [...seriesSet].sort();
    const data = [...byX.entries()].map(([name, vals]) => ({ name, ...vals }));
    return { data, series };
  }, [eff, rows]);
  if (data.length === 0 || series.length === 0) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 6 }}>
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} stroke={palette.axis} interval={0} />
        <YAxis tick={monoTick} stroke={palette.axis} allowDecimals={false} />
        <Tooltip {...tooltipProps()} />
        <Legend formatter={(v) => <span style={{ fontSize: 12, color: C.ink2 }}>{v}</span>} />
        {series.map((s, i) => (
          <Bar key={s} dataKey={s} fill={palette.cat[i % palette.cat.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function KpiCard({ count }: { count: number }) {
  const { value, label } = kpiValue(count);
  return (
    <div
      style={{
        minHeight: CHART_HEIGHT - 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 52, fontWeight: 800, color: C.ink }}>
        {value}
      </div>
      <div style={{ fontSize: 15, color: C.ink2, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function NoData() {
  return (
    <div
      style={{
        minHeight: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        color: C.ink3,
      }}
    >
      No plottable values in this column.
    </div>
  );
}

function OverrideControl({
  types,
  active,
  autoType,
  onPick,
}: {
  types: ChartType[];
  active: ChartType;
  autoType: ChartType;
  onPick: (t: ChartType) => void;
}) {
  // Auto type first, then the rest in their natural order (de-duplicated).
  const ordered = [autoType, ...types.filter((t) => t !== autoType)];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>View as:</span>
      <div style={{ display: 'inline-flex', gap: 4 }} role="group" aria-label="Chart type">
        {ordered.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(t)}
              style={{
                border: `1px solid ${on ? C.teal : C.line}`,
                background: on ? C.tealSoft : '#fff',
                color: on ? C.tealDk : C.ink2,
                fontWeight: on ? 700 : 500,
                fontSize: 11.5,
                borderRadius: 8,
                padding: '5px 11px',
                cursor: 'pointer',
              }}
            >
              {TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
