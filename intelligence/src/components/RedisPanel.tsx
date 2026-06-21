import { C, MONO, card, sectionLabel } from '../styles';
import { fmtInt, type StreamRow } from '../state/derive';

// Vector-index facts: REAL constants from capability_store._SCHEMA.
const VECTOR_FACTS: Array<[string, (n: number) => string]> = [
  ['Algorithm', () => 'HNSW'],
  ['Dimensions', () => fmtInt(1536)],
  ['Metric', () => 'cosine similarity'],
  ['Capabilities', (n) => `${fmtInt(n)} indexed`],
  ['Storage', () => 'RedisJSON'],
];

export function RedisPanel({
  indexedCount,
  streamRows,
  loaded,
}: {
  indexedCount: number;
  streamRows: StreamRow[];
  loaded: boolean;
}) {
  return (
    <section style={{ animation: 'fadeUp .55s ease .16s both' }}>
      <div style={sectionLabel}>Redis</div>
      <div style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <div style={{ ...sectionLabel, marginBottom: 14 }}>Vector Index</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {VECTOR_FACTS.map(([k, v]) => (
              <div
                key={k}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span style={{ fontSize: 12, color: C.secondary }}>{k}</span>
                <span style={{ fontSize: 12, fontFamily: MONO, color: C.text2, fontWeight: 500 }}>
                  {v(indexedCount)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 14 }}>
            Live Stream{' '}
            <span
              style={{
                color: C.teal,
                fontFamily: MONO,
                textTransform: 'none',
                letterSpacing: 0,
                fontWeight: 500,
              }}
            >
              forge:build-events
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {streamRows.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>
                {loaded ? 'No stream activity yet.' : 'Loading…'}
              </div>
            ) : (
              streamRows.map((s, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 0' }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 12, color: '#b0b7c0' }}>{s.time}</span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 500,
                      minWidth: 96,
                      color: s.color,
                    }}
                  >
                    {s.stage}
                  </span>
                  <span style={{ fontSize: 12, color: C.secondary }}>{s.desc}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
