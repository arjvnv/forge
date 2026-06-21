import { C, MONO, card, sectionLabel } from '../styles';
import {
  THRESHOLD,
  bandColor,
  type RoutingDecision,
  type SessionStats,
} from '../state/derive';

const THRESHOLD_PCT = Math.round(THRESHOLD * 100); // 62

function Badge({ kind, faded }: { kind: 'REUSED' | 'BUILT'; faded?: boolean }) {
  const reused = kind === 'REUSED';
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 10px',
        borderRadius: 9999,
        background: reused ? '#dcfce7' : '#ccfbf1',
        color: reused ? '#15803d' : '#0f766e',
        letterSpacing: '0.03em',
        opacity: faded ? 0.55 : 1,
      }}
    >
      {kind}
    </span>
  );
}

function SimBar({ sim, showThreshold }: { sim: number | null; showThreshold: boolean }) {
  const pct = sim != null ? Math.round(sim * 100) : 0;
  const color = sim != null ? bandColor(sim) : '#cbd5e1';
  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          marginBottom: 6,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{showThreshold ? 'Similarity' : 'Best match'}</span>
        <span style={{ fontFamily: MONO, color: '#475569', fontWeight: 500 }}>
          {sim != null ? `${pct}%` : '—'}
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: 6,
          borderRadius: 9999,
          background: '#eef0f2',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            background: color,
            height: '100%',
            borderRadius: 9999,
            transformOrigin: 'left',
            animation: 'growW .7s cubic-bezier(.4,0,.2,1) both',
          }}
        />
        {/* Threshold notch at the REAL 0.62 (62%). */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: `${THRESHOLD_PCT}%`,
            height: 10,
            width: 2,
            background: C.muted,
            borderRadius: 2,
          }}
        />
      </div>
      {showThreshold && (
        <div
          style={{
            fontSize: 11,
            color: '#b0b7c0',
            marginTop: 5,
            marginLeft: `calc(${THRESHOLD_PCT}% - 28px)`,
          }}
        >
          ↑ threshold ({THRESHOLD_PCT}%)
        </div>
      )}
    </div>
  );
}

function Entry({ d }: { d: RoutingDecision }) {
  const isError = d.errorMessage != null;
  return (
    <div style={{ borderBottom: `1px solid ${C.divider}`, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{d.time}</span>
        <Badge kind={d.kind} faded={d.inProgress} />
        {d.inProgress && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>
            {d.latestStage}…
          </span>
        )}
      </div>
      {d.query && (
        <div style={{ fontSize: 13, color: C.text2, marginBottom: 11 }}>
          &ldquo;{d.query}&rdquo;
        </div>
      )}
      <div
        style={{ fontSize: 13, marginBottom: 8, display: 'flex', gap: 7 }}
      >
        <span style={{ color: '#cbd5e1' }}>→</span>
        {d.kind === 'REUSED' ? (
          <span style={{ color: C.text, fontWeight: 600 }}>{d.name}</span>
        ) : (
          <span style={{ color: C.secondary }}>No match. Building new capability.</span>
        )}
      </div>
      {isError ? (
        <div style={{ fontSize: 11, color: C.red, marginTop: 8, fontFamily: MONO }}>
          {d.errorMessage}
        </div>
      ) : (
        <>
          <SimBar sim={d.similarity} showThreshold={d.kind === 'REUSED'} />
          {d.statsLine && (
            <div
              style={{ fontSize: 11, color: C.muted, marginTop: 8, fontFamily: MONO }}
            >
              {d.statsLine}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RoutingLog({
  decisions,
  stats,
  loaded,
}: {
  decisions: RoutingDecision[];
  stats: SessionStats;
  loaded: boolean;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', animation: 'fadeUp .55s ease both' }}>
      <div style={sectionLabel}>Routing Decisions</div>
      <div style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflowY: 'auto', overflowX: 'hidden', maxHeight: 600 }}>
          {decisions.length === 0 ? (
            <div
              style={{
                color: C.muted,
                textAlign: 'center',
                padding: '64px 20px',
                fontSize: 13,
              }}
            >
              {loaded
                ? 'No routing decisions yet. Run a query in the Demo to see decisions appear here.'
                : 'Loading…'}
            </div>
          ) : (
            decisions.map((d) => <Entry key={d.capabilityId} d={d} />)
          )}
        </div>
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: '16px 20px',
            background: C.stripBg,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: C.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 11,
              fontWeight: 600,
            }}
          >
            Reuse Rate This Session
          </div>
          <div
            style={{
              width: '100%',
              height: 7,
              borderRadius: 9999,
              background: '#eef0f2',
              position: 'relative',
              marginBottom: 9,
            }}
          >
            <div
              style={{
                width: `${stats.reuseRatePct.toFixed(1)}%`,
                background: C.green,
                height: '100%',
                borderRadius: 9999,
                transformOrigin: 'left',
                animation: 'growW .8s cubic-bezier(.4,0,.2,1) both',
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: '#475569', fontFamily: MONO }}>
            {stats.reuseCount} of {stats.total} queries  ·  {stats.reuseRatePct.toFixed(1)}%
          </div>
        </div>
      </div>
    </section>
  );
}
