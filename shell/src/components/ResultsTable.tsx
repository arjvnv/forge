import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { C, MONO } from '../theme';
import type { ResultsState } from '../useForge';
import { getCapability } from '../api';
import { isIdDateCol } from '../chart/select';
import type { ChartSpec, ChartType } from '../chart/types';

// Code-split recharts out of the main bundle: the chart renderer (and recharts)
// only loads when the user first switches to Chart. Keeps initial load lean.
const ResultChart = lazy(() => import('./ResultChart'));

function prettyCol(c: string): string {
  return c
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/A1c/i, 'A1c')
    .replace(/Bmi/i, 'BMI')
    .replace(/Ldl/i, 'LDL')
    .replace(/Phq9/i, 'PHQ-9');
}

type View = 'table' | 'chart';
// 'loading' / 'error' track the lazy fetch; null means "fetched, no chart spec".
type SpecState = ChartSpec | null | 'loading' | 'error';

export default function ResultsTable({
  r,
  onOpen,
}: {
  r: ResultsState;
  onOpen: (id: string) => void;
}) {
  const cols = r.rows[0] ? Object.keys(r.rows[0]) : [];
  const shown = r.rows.slice(0, 100);
  const empty = r.count === 0;
  const latency = Math.round(r.latency_ms * 100) / 100;

  // ── Visualize state (per-result; resets when a new result arrives) ──────────
  const [view, setView] = useState<View>('table');
  const [spec, setSpec] = useState<SpecState>('loading');
  const [override, setOverride] = useState<ChartType | null>(null);
  // Cache fetched specs by capId so flipping Table<->Chart doesn't refetch.
  const specCache = useRef<Map<string, ChartSpec | null>>(new Map());

  // Reset view/override/spec when the underlying result changes.
  useEffect(() => {
    setView('table');
    setOverride(null);
    const key = r.capId;
    if (key && specCache.current.has(key)) {
      setSpec(specCache.current.get(key) ?? null);
    } else {
      setSpec('loading');
    }
  }, [r.capId]);

  // Lazy-fetch the chart spec on first switch to Chart (cached per capId).
  useEffect(() => {
    if (view !== 'chart') return;
    const key = r.capId;
    if (!key) {
      setSpec(null); // no capId -> no spec; heuristic handles it from rows.
      return;
    }
    if (specCache.current.has(key)) {
      setSpec(specCache.current.get(key) ?? null);
      return;
    }
    if (spec !== 'loading') return; // already resolved (or erroring) for this result

    let cancelled = false;
    (async () => {
      try {
        const cap = await getCapability(key);
        const chart = (cap.ui_spec?.chart as ChartSpec | undefined) ?? null;
        if (cancelled) return;
        specCache.current.set(key, chart);
        setSpec(chart);
      } catch {
        if (cancelled) return;
        // Treat fetch failure as "no spec" — the heuristic still renders from rows.
        setSpec('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, r.capId, spec]);

  const tag = r.reused ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        color: C.greenDk,
        background: C.greenSoft,
        borderRadius: 999,
        padding: '4px 11px',
      }}
    >
      <span style={{ fontSize: 13 }}>↻</span> Reused instantly
    </span>
  ) : (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        color: C.tealDk,
        background: C.tealSoft,
        borderRadius: 999,
        padding: '4px 11px',
      }}
    >
      <span style={{ fontSize: 13 }}>✓</span> Forged &amp; saved
    </span>
  );

  // Segmented [Table | Chart] toggle. Hidden on empty results' header? No — the
  // plan keeps the control visible whenever a non-empty result is shown; on empty
  // we render the existing empty card without the toggle (nothing to visualize).
  const toggle = (
    <div
      role="tablist"
      aria-label="Result view"
      style={{
        display: 'inline-flex',
        border: `1px solid ${C.line}`,
        borderRadius: 9,
        overflow: 'hidden',
        background: '#f2f4f7',
      }}
    >
      {(['table', 'chart'] as View[]).map((v) => {
        const on = view === v;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            onClick={() => setView(v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setView(v === 'table' ? 'chart' : 'table');
              }
            }}
            style={{
              border: 'none',
              background: on ? '#fff' : 'transparent',
              color: on ? C.ink : C.ink3,
              fontWeight: on ? 700 : 500,
              fontSize: 12.5,
              padding: '6px 15px',
              cursor: 'pointer',
              boxShadow: on ? '0 1px 2px rgba(20,30,50,0.08)' : 'none',
            }}
          >
            {v === 'table' ? 'Table' : 'Chart'}
          </button>
        );
      })}
    </div>
  );

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '17px 20px',
        borderBottom: `1px solid ${C.line2}`,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>
            {empty
              ? 'No patients matched'
              : `${r.count} patient${r.count === 1 ? '' : 's'} matched`}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11.5,
              color: C.ink3,
              marginTop: 2,
            }}
          >
            {r.toolName}
          </div>
        </div>
        {tag}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {!empty ? toggle : null}
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.ink3 }}>
          ran in {latency} ms
        </span>
        {r.capId ? (
          <button
            onClick={() => onOpen(r.capId as string)}
            style={{
              background: '#f2f4f7',
              border: `1px solid ${C.line}`,
              borderRadius: 9,
              padding: '7px 13px',
              fontSize: 12.5,
              fontWeight: 600,
              color: C.ink2,
              cursor: 'pointer',
            }}
          >
            Open tool
          </button>
        ) : null}
      </div>
    </div>
  );

  if (empty) {
    return (
      <section
        style={{
          background: '#fff',
          border: `1px solid ${C.line}`,
          borderRadius: 18,
          boxShadow:
            '0 1px 2px rgba(20,30,50,0.03), 0 10px 30px rgba(20,30,50,0.05)',
          overflow: 'hidden',
          animation: 'frgUp .3s ease',
        }}
      >
        {header}
        <div style={{ padding: '38px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: C.ink2 }}>
            Zero patients met these criteria.
          </div>
          <div style={{ fontSize: 12.5, color: C.ink3, marginTop: 5 }}>
            That’s a valid result, not an error — the tool ran cleanly.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        boxShadow:
          '0 1px 2px rgba(20,30,50,0.03), 0 10px 30px rgba(20,30,50,0.05)',
        overflow: 'hidden',
        animation: 'frgUp .3s ease',
      }}
    >
      {header}

      {view === 'chart' ? (
        spec === 'loading' ? (
          <ChartLoading />
        ) : (
          <Suspense fallback={<ChartLoading />}>
            <ResultChart
              rows={r.rows}
              count={r.count}
              spec={spec === 'error' ? null : spec}
              title={r.toolName || 'Result'}
              override={override}
              onOverride={setOverride}
            />
          </Suspense>
        )
      ) : (
        <div className="frg-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 11,
                      fontWeight: 700,
                      color: C.ink2,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: `1px solid ${C.line}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {prettyCol(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 ? '#fbfcfd' : '#fff' }}>
                  {cols.map((c, ci) => {
                    const v = row[c];
                    const isNull = v == null || v === '';
                    const mono = isIdDateCol(c) || typeof v === 'number';
                    let color: string = C.ink;
                    let weight = 500;
                    if (typeof v === 'string' && /poor control|uncontrolled/.test(v)) {
                      color = C.red;
                      weight = 600;
                    } else if (typeof v === 'string' && /^controlled$/.test(v)) {
                      color = C.greenDk;
                      weight = 600;
                    } else if (v === 'yes') {
                      color = C.amberDk;
                      weight = 600;
                    }
                    return (
                      <td
                        key={ci}
                        style={{
                          padding: '10px 16px',
                          fontSize: 13,
                          fontFamily: mono ? MONO : 'inherit',
                          color: isNull ? C.ink4 : color,
                          fontWeight: isNull ? 400 : weight,
                          borderBottom: `1px solid ${C.line2}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isNull ? '—' : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          padding: '11px 20px',
          borderTop: `1px solid ${C.line2}`,
          fontSize: 12,
          color: C.ink3,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {view === 'chart'
            ? `Charting ${r.count} of ${r.count} rows`
            : `Showing ${shown.length} of ${r.count} rows`}
        </span>
        <span style={{ fontFamily: MONO }}>{cols.length} columns</span>
      </div>
    </section>
  );
}

function ChartLoading() {
  return (
    <div
      style={{
        minHeight: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.ink3,
        fontSize: 13.5,
        animation: 'frgPulse 1.4s ease-in-out infinite',
      }}
    >
      Preparing chart…
    </div>
  );
}
