import { useEffect, useState } from 'react';
import { getCapability } from '../api';
import { C, MONO, fmtDate } from '../theme';
import type { Capability, Manifest } from '../types';
import CodeBlock from './CodeBlock';

export default function DetailModal({
  id,
  fallback,
  running,
  onClose,
  onRun,
}: {
  id: string;
  fallback: Manifest | undefined;
  running: boolean;
  onClose: () => void;
  onRun: (id: string) => void;
}) {
  const [cap, setCap] = useState<Capability | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setCap(null);
    setShowCode(false);
    setLoadError(false);
    getCapability(id)
      .then((c) => {
        if (active) setCap(c);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Prefer the freshly fetched capability; fall back to the list manifest
  // so the header renders instantly while logic/ui_spec load.
  const manifest = cap?.manifest ?? fallback;
  if (!manifest) return null;

  const verified = cap?.verified ?? true;
  const columns = cap?.ui_spec?.columns ?? [];
  const reads = manifest.reads ?? [];
  const bf = manifest.built_from ?? [];
  const logic = cap?.logic ?? null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,28,44,0.42)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 100,
        animation: 'frgUp .2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="frg-scroll"
        style={{
          background: '#fff',
          borderRadius: 20,
          width: 'min(720px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 30px 80px rgba(20,30,50,0.3)',
          animation: 'frgPop .25s ease',
        }}
      >
        <div
          style={{
            padding: '22px 24px 18px',
            borderBottom: `1px solid ${C.line2}`,
            position: 'sticky',
            top: 0,
            background: '#fff',
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 17,
                    fontWeight: 700,
                    color: C.ink,
                  }}
                >
                  {manifest.name}
                </div>
                {verified ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: C.greenDk,
                      background: C.greenSoft,
                      borderRadius: 999,
                      padding: '3px 10px',
                    }}
                  >
                    <span>✓</span> Verified safe
                  </span>
                ) : null}
              </div>
              <p
                style={{
                  margin: '9px 0 0',
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: C.ink2,
                }}
              >
                {manifest.description}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: '#f2f4f7',
                border: 'none',
                borderRadius: 9,
                width: 30,
                height: 30,
                fontSize: 16,
                color: C.ink2,
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3,1fr)',
              gap: 16,
              marginBottom: 18,
            }}
          >
            <Chip label="Times reused" val={`×${manifest.reuse_count}`} />
            <Chip label="Forged" val={fmtDate(manifest.created_at)} />
            <Chip label="Reporting input" val="measurement_year" />
          </div>
          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Data sources it reads</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {reads.map((rd, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: C.ink2,
                    background: '#f2f4f7',
                    border: '1px solid #e9ebf0',
                    borderRadius: 7,
                    padding: '3px 9px',
                  }}
                >
                  {rd}
                </span>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Output columns</SectionLabel>
            {columns.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: C.tealDk,
                      background: C.tealSoft,
                      border: '1px solid #cdebed',
                      borderRadius: 7,
                      padding: '3px 9px',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: C.ink3 }}>
                {loadError ? 'Could not load columns.' : 'Loading…'}
              </span>
            )}
          </div>
          {bf.length ? (
            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.amberDk,
                  marginBottom: 8,
                }}
              >
                Built from
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {bf.map((it, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      fontFamily: MONO,
                      fontSize: 12,
                      color: C.ink,
                      background: C.amberSoft,
                      border: '1px solid #f1ddbe',
                      borderRadius: 9,
                      padding: '5px 11px',
                    }}
                  >
                    {it.name}
                    <span style={{ color: C.amberDk }}>
                      {Math.round((it.similarity ?? 0) * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              marginTop: 20,
            }}
          >
            <button
              onClick={() => onRun(manifest.id)}
              disabled={running}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: running ? '#9fd9dd' : C.teal,
                color: '#fff',
                border: 'none',
                borderRadius: 11,
                padding: '11px 20px',
                fontSize: 14,
                fontWeight: 700,
                cursor: running ? 'default' : 'pointer',
                boxShadow: '0 6px 16px rgba(14,163,173,0.26)',
              }}
            >
              {running ? (
                <span
                  style={{
                    width: 13,
                    height: 13,
                    border: '2px solid rgba(255,255,255,0.5)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'frgSpin .7s linear infinite',
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    background: '#fff',
                    borderRadius: 2,
                    transform: 'rotate(45deg)',
                  }}
                />
              )}
              {running ? 'Running…' : 'Run this tool'}
            </button>
            {logic ? (
              <button
                onClick={() => setShowCode((v) => !v)}
                style={{
                  background: '#f2f4f7',
                  border: `1px solid ${C.line}`,
                  borderRadius: 11,
                  padding: '11px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: C.ink2,
                  cursor: 'pointer',
                }}
              >
                {showCode ? 'Hide the code' : 'View the code'}
              </button>
            ) : null}
          </div>
          {showCode && logic ? (
            <>
              <div style={{ marginTop: 12 }}>
                <CodeBlock logic={logic} maxH={320} />
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: C.ink3,
                  marginTop: 9,
                  fontStyle: 'italic',
                }}
              >
                The real generated source for this tool — read-only.
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.ink3, marginBottom: 3 }}>{label}</div>
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: C.ink,
          fontFamily: MONO,
        }}
      >
        {val}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ fontSize: 12, fontWeight: 700, color: C.ink2, marginBottom: 8 }}
    >
      {children}
    </div>
  );
}
