import { useEffect, useState } from 'react';
import { C, MONO, SHADOW_EXPANDED, TAG_COLORS, card, sectionLabel } from '../styles';
import type { Capability, Manifest, StreamEvent } from '../api/types';
import {
  avgReuseSeconds,
  builtAgo,
  fmtInt,
  stageColor,
} from '../state/derive';

function TagDots({ reads }: { reads: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {reads.map((t) => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 9999,
              background: TAG_COLORS[t] ?? '#64748b',
              flex: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: C.secondary }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

function Card({
  m,
  expanded,
  onToggle,
}: {
  m: Manifest;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isBuilt = m.provenance != null;
  return (
    <button
      type="button"
      onClick={isBuilt ? onToggle : undefined}
      aria-expanded={isBuilt ? expanded : undefined}
      style={{
        textAlign: 'left',
        font: 'inherit',
        minWidth: 224,
        maxWidth: 224,
        borderRadius: 16,
        border: `1px solid ${expanded ? C.teal : C.border}`,
        background: C.panel,
        padding: 18,
        cursor: isBuilt ? 'pointer' : 'default',
        transition: 'border-color .2s ease,box-shadow .2s ease,transform .2s ease',
        flex: 'none',
        boxShadow: expanded
          ? '0 2px 4px rgba(13,148,136,0.08),0 12px 24px rgba(13,148,136,0.12)'
          : '0 1px 2px rgba(16,24,40,0.04),0 4px 12px rgba(16,24,40,0.05)',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          color: C.text,
          fontSize: 14,
          marginBottom: 15,
          lineHeight: 1.35,
        }}
      >
        {m.name}
      </div>
      <TagDots reads={m.reads} />
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 11, color: C.muted }}>
          {isBuilt ? builtAgo(m.created_at) : 'Pre-loaded baseline'}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>Reused ×{m.reuse_count}</div>
        {isBuilt && (
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
            {fmtInt(m.provenance!.build_cost)} tokens
          </div>
        )}
      </div>
      {isBuilt && (
        <div style={{ marginTop: 16, fontSize: 12, color: C.teal, fontWeight: 600 }}>
          {expanded ? 'Hide trace ↑' : 'View trace ↓'}
        </div>
      )}
    </button>
  );
}

function colLabel(): React.CSSProperties {
  return { ...sectionLabel, marginBottom: 16 };
}

function ManifestRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {values.length === 0 ? (
        <div style={{ fontSize: 12, color: C.text2, fontFamily: MONO, paddingLeft: 10 }}>
          none
        </div>
      ) : (
        values.map((v, i) => (
          <div
            key={i}
            style={{ fontSize: 12, color: C.text2, fontFamily: MONO, paddingLeft: 10 }}
          >
            · {v}
          </div>
        ))
      )}
    </div>
  );
}

function Expanded({
  m,
  detail,
  events,
  onClose,
}: {
  m: Manifest;
  detail: Capability | undefined;
  events: StreamEvent[];
  onClose: () => void;
}) {
  const prov = m.provenance!;
  const v = prov.verification;
  const verifLines: string[] = [];
  if (typeof v.data_calls === 'number')
    verifLines.push(
      `${v.data_calls} data calls${v.all_on_allowlist ? ' — all on allowlist' : ''}`,
    );
  if (typeof v.imports === 'number') verifLines.push(`${v.imports} import statements`);
  if (typeof v.dunders === 'number')
    verifLines.push(`${v.dunders} dunder attribute accesses`);
  if (v.sandbox_valid) verifLines.push('sandbox run returned valid shape');

  const avg = avgReuseSeconds(m.id, events);
  const inputKeys = Object.keys(m.inputs ?? {});
  const scopeStr =
    Object.keys(m.scope ?? {}).length === 0
      ? 'read-only'
      : JSON.stringify(m.scope);
  const actionsStr = (m.actions ?? []).length === 0 ? 'none' : m.actions.join(', ');

  return (
    <div
      style={{
        marginTop: 20,
        ...card,
        boxShadow: SHADOW_EXPANDED,
        padding: 28,
        position: 'relative',
        animation: 'expandIn .28s ease both',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 700, color: C.text, fontSize: 17 }}>{m.name}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          style={{
            background: 'none',
            border: 'none',
            color: C.muted,
            cursor: 'pointer',
            fontSize: 22,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 32 }}>
        {/* Build Trace */}
        <div>
          <div style={colLabel()}>Build Trace</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {prov.trace.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span
                  style={{
                    width: 92,
                    flex: 'none',
                    fontFamily: MONO,
                    fontSize: 12,
                    fontWeight: 500,
                    color: stageColor(t.stage),
                  }}
                >
                  {t.stage}
                </span>
                <span style={{ color: '#cbd5e1', fontSize: 12 }}>→</span>
                <span style={{ fontSize: 12, color: C.secondary }}>{t.detail}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: `1px solid ${C.divider}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
              First run: {(prov.first_run_ms / 1000).toFixed(1)}s
            </div>
            {avg != null && (
              <div style={{ fontSize: 12, color: C.green, fontWeight: 500, fontFamily: MONO }}>
                Each reuse: ~{avg.toFixed(1)}s
              </div>
            )}
          </div>
        </div>

        {/* Manifest + Verification */}
        <div>
          <div style={colLabel()}>Manifest</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <ManifestRow label="reads" values={m.reads ?? []} />
            <ManifestRow label="inputs" values={inputKeys} />
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: C.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                scope
              </div>
              <div style={{ fontSize: 12, color: C.text2, fontFamily: MONO, paddingLeft: 10 }}>
                {scopeStr}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: C.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                actions
              </div>
              <div style={{ fontSize: 12, color: C.text2, fontFamily: MONO, paddingLeft: 10 }}>
                {actionsStr}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.divider}` }}>
            <div style={{ ...sectionLabel, marginBottom: 13 }}>Verification</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {verifLines.map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 16,
                      height: 16,
                      flex: 'none',
                      borderRadius: 9999,
                      background: '#dcfce7',
                      color: C.green,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                  <span style={{ fontSize: 12, color: '#475569' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Generated Logic (REAL) */}
        <div>
          <div style={colLabel()}>Generated Logic</div>
          <pre
            style={{
              background: '#f8fafb',
              border: '1px solid #e9ecef',
              borderRadius: 12,
              padding: 18,
              fontFamily: MONO,
              fontSize: 12,
              color: C.text2,
              overflow: 'auto',
              maxHeight: 340,
              lineHeight: 1.7,
              margin: 0,
              whiteSpace: 'pre',
            }}
          >
            {detail ? detail.logic : 'Loading logic…'}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function Provenance({
  capabilities,
  capDetail,
  events,
  requestDetail,
  loaded,
}: {
  capabilities: Manifest[];
  capDetail: Record<string, Capability>;
  events: StreamEvent[];
  requestDetail: (id: string) => void;
  loaded: boolean;
}) {
  const built = capabilities.filter((m) => m.provenance != null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Default: first built capability expanded once any exist.
  useEffect(() => {
    if (expandedId == null && built.length > 0) setExpandedId(built[0].id);
    if (expandedId != null && !capabilities.some((m) => m.id === expandedId)) {
      setExpandedId(built.length > 0 ? built[0].id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built.length]);

  // Lazily fetch logic for the expanded built cap.
  useEffect(() => {
    if (expandedId) requestDetail(expandedId);
  }, [expandedId, requestDetail]);

  const expanded = capabilities.find((m) => m.id === expandedId) ?? null;

  return (
    <section style={{ marginTop: 28, animation: 'fadeUp .55s ease .24s both' }}>
      <div style={sectionLabel}>Capability Provenance</div>
      {capabilities.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: '12px 4px' }}>
          {loaded ? 'No capabilities indexed yet.' : 'Loading…'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 18, overflowX: 'auto', padding: '4px 4px 10px' }}>
          {capabilities.map((m) => (
            <Card
              key={m.id}
              m={m}
              expanded={expandedId === m.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === m.id ? null : m.id))
              }
            />
          ))}
        </div>
      )}
      {built.length === 0 && capabilities.length > 0 && (
        <div style={{ fontSize: 12, color: C.muted, padding: '4px' }}>
          No capabilities built yet in this session.
        </div>
      )}
      {expanded && expanded.provenance && (
        <Expanded
          m={expanded}
          detail={capDetail[expanded.id]}
          events={events}
          onClose={() => setExpandedId(null)}
        />
      )}
    </section>
  );
}
