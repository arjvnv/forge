import { C, MONO } from '../theme';
import type { HealthStatus } from '../types';

function JudgeSwitch({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title="Reveal the technical layer for judges"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        background: on ? C.tealSoft : '#fff',
        border: `1px solid ${on ? '#bfe7ea' : C.line}`,
        borderRadius: 999,
        padding: '6px 12px 6px 11px',
        cursor: 'pointer',
        transition: 'all .15s ease',
      }}
    >
      <span
        style={{
          width: 30,
          height: 17,
          borderRadius: 999,
          background: on ? C.teal : '#d4d8e0',
          position: 'relative',
          transition: 'background .18s ease',
          flex: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 15 : 2,
            width: 13,
            height: 13,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .18s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: on ? C.tealDk : C.ink2,
          whiteSpace: 'nowrap',
        }}
      >
        Under the hood
      </span>
    </button>
  );
}

export default function Header({
  toolsForged,
  totalReuses,
  health,
  judge,
  onToggleJudge,
}: {
  toolsForged: number;
  totalReuses: number;
  health: HealthStatus | null;
  judge: boolean;
  onToggleJudge: () => void;
}) {
  const online = !!health && health.redis && health.postgres;
  const dotColor = online ? C.green : C.amber;
  const label = online
    ? 'Forge online'
    : health
      ? 'Forge degraded'
      : 'Connecting…';
  const tip = health
    ? `redis: ${health.redis ? 'ok' : 'down'} · postgres: ${
        health.postgres ? 'ok' : 'down'
      }`
    : 'checking services…';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        flexWrap: 'wrap',
        marginBottom: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: 'linear-gradient(135deg,#0ea3ad,#e8973a)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(14,163,173,0.28)',
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              background: '#fff',
              borderRadius: 3,
              transform: 'rotate(45deg)',
            }}
          />
        </div>
        <div style={{ lineHeight: 1.1 }}>
          <div
            style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' }}
          >
            Forge
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: C.ink3,
              letterSpacing: '0.02em',
              marginTop: 1,
            }}
          >
            self-building clinical tooling
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#fff',
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: '7px 14px',
          }}
        >
          <span
            style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.ink }}
          >
            {toolsForged}
          </span>
          <span style={{ fontSize: 12, color: C.ink2 }}>tools forged</span>
          <span
            style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: '#c4cad4',
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: 600,
              color: C.amber,
            }}
          >
            {totalReuses}
          </span>
          <span style={{ fontSize: 12, color: C.ink2 }}>total reuses</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: '#fff',
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: '7px 13px',
          }}
          title={tip}
        >
          <span style={{ position: 'relative', width: 8, height: 8 }}>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: dotColor,
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: '50%',
                background: dotColor,
                opacity: 0.28,
                animation: 'frgPulse 2.4s ease-in-out infinite',
              }}
            />
          </span>
          <span
            style={{
              fontSize: 12,
              color: C.ink,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        </div>
        <JudgeSwitch on={judge} onToggle={onToggleJudge} />
      </div>
    </header>
  );
}
