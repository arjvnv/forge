import { C, MONO } from '../theme';
import type { ResultsState } from '../useForge';

function prettyCol(c: string): string {
  return c
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/A1c/i, 'A1c')
    .replace(/Bmi/i, 'BMI')
    .replace(/Ldl/i, 'LDL')
    .replace(/Phq9/i, 'PHQ-9');
}

function isIdCol(c: string): boolean {
  return /(_id$|^id$|date)/i.test(c);
}

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                  const mono = isIdCol(c) || typeof v === 'number';
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
          Showing {shown.length} of {r.count} rows
        </span>
        <span style={{ fontFamily: MONO }}>{cols.length} columns</span>
      </div>
    </section>
  );
}
