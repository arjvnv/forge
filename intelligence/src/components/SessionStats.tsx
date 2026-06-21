import { C, MONO, card, sectionLabel } from '../styles';
import { fmtInt, reuseRateColor, type SessionStats as Stats } from '../state/derive';

function Stat({
  value,
  label1,
  label2,
  color,
}: {
  value: string;
  label1: string;
  label2: string;
  color?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          fontFamily: MONO,
          color: color ?? C.text,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.secondary, marginTop: 7 }}>{label1}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{label2}</div>
    </div>
  );
}

export function SessionStats({ stats }: { stats: Stats }) {
  return (
    <section style={{ animation: 'fadeUp .55s ease .08s both' }}>
      <div style={sectionLabel}>Session Stats</div>
      <div style={{ ...card, padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
          <Stat value={fmtInt(stats.tokensSpent)} label1="tokens spent" label2="building" />
          <Stat
            value={fmtInt(stats.tokensSaved)}
            label1="tokens saved"
            label2="via reuse"
            color={C.green}
          />
          <Stat
            value={`${stats.reuseRatePct.toFixed(1)}%`}
            label1="reuse rate"
            label2="this session"
            color={reuseRateColor(stats.reuseRatePct)}
          />
        </div>
        <div
          style={{
            borderTop: `1px solid ${C.divider}`,
            marginTop: 20,
            paddingTop: 16,
            fontSize: 11,
            color: C.muted,
            textAlign: 'center',
            fontFamily: MONO,
          }}
        >
          {stats.builtCount} capabilities built  ·  {stats.reuseCount} reuses  ·{' '}
          {stats.total} total queries
        </div>
      </div>
    </section>
  );
}
