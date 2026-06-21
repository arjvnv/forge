import { C, MONO } from '../styles';
import type { Health } from '../api/types';

function dotStyle(live: boolean): React.CSSProperties {
  return {
    color: live ? C.green : C.red,
    animation: live ? 'pulse 2.4s ease-in-out infinite' : undefined,
  };
}

export function Header({ health }: { health: Health }) {
  const lost = !health.reachable;
  const redisLive = !lost && health.redis;
  const pgLive = !lost && health.postgres;

  return (
    <header
      style={{
        background: C.panel,
        borderBottom: `1px solid ${C.border}`,
        padding: '18px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 30,
        boxShadow: '0 1px 2px rgba(16,24,40,0.03)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
        <span
          style={{
            fontFamily: MONO,
            fontWeight: 700,
            color: C.teal,
            letterSpacing: '0.06em',
            fontSize: 16,
          }}
        >
          FORGE
        </span>
        <span style={{ color: '#cbd5e1' }}>·</span>
        <span style={{ color: C.secondary, fontSize: 13, letterSpacing: '0.01em' }}>
          Intelligence Layer
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <a
            href="#"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: C.text,
              borderBottom: `2px solid ${C.teal}`,
              paddingBottom: 5,
              textDecoration: 'none',
            }}
          >
            Intelligence
          </a>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12 }}>
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#475569', fontWeight: 500 }}
            title={`Redis: ${redisLive ? 'connected' : 'disconnected'}`}
          >
            <span aria-label={`Redis: ${redisLive ? 'connected' : 'disconnected'}`} style={dotStyle(redisLive)}>
              ●
            </span>{' '}
            Redis
          </span>
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#475569', fontWeight: 500 }}
            title={`Postgres: ${pgLive ? 'connected' : 'disconnected'}`}
          >
            <span aria-label={`Postgres: ${pgLive ? 'connected' : 'disconnected'}`} style={dotStyle(pgLive)}>
              ●
            </span>{' '}
            Postgres
          </span>
        </div>
      </div>
    </header>
  );
}
