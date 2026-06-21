import { useState } from 'react';
import { C, MONO } from '../theme';
import { PATHS, PLAIN } from '../useForge';
import type { BuildState } from '../useForge';
import type { BuildStage, BuiltFrom } from '../types';
import CodeBlock from './CodeBlock';

type NodeStatus = 'done' | 'active' | 'gate' | 'pending';

export default function BuildPanel({
  build,
  judge,
  onToggleJudge,
  onApprove,
}: {
  build: BuildState;
  judge: boolean;
  onToggleJudge: () => void;
  onApprove: () => void;
}) {
  const [showCode, setShowCode] = useState(false);

  if (build.failed) {
    return <FailurePanel build={build} />;
  }

  // Until the backend reveals the path, render the reuse order as a neutral
  // skeleton seeded with the routing node (both paths start with routing).
  const path = build.path ?? 'reuse';
  const order = build.path ? PATHS[path] : (['routing'] as BuildStage[]);
  const isReuse = path === 'reuse';
  const idxCur = order.indexOf(build.currentStage as BuildStage);
  const totalKnown = order.length;
  const progress =
    build.currentStage === 'done'
      ? 1
      : Math.max(0, idxCur) / Math.max(1, totalKnown - 1);

  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: '20px 22px',
        boxShadow:
          '0 1px 2px rgba(20,30,50,0.03), 0 10px 30px rgba(20,30,50,0.05)',
        animation: 'frgUp .3s ease',
      }}
    >
      <Headline isReuse={isReuse} determined={!!build.path} />
      <div
        style={{
          height: 4,
          background: '#eef0f4',
          borderRadius: 999,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${(progress * 100).toFixed(0)}%`,
            background:
              build.currentStage === 'done'
                ? C.green
                : `linear-gradient(90deg,${C.teal},${C.amber})`,
            borderRadius: 999,
            transition: 'width .55s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </div>
      <div>
        {order.map((stage, i) => {
          let status: NodeStatus;
          if (build.currentStage === 'done') status = 'done';
          else if (i < idxCur) status = 'done';
          else if (i === idxCur)
            status =
              stage === 'verified' && build.awaitingApproval ? 'gate' : 'active';
          else status = 'pending';
          return (
            <Node
              key={stage}
              stage={stage}
              status={status}
              isLast={i === order.length - 1}
              build={build}
              judge={judge}
              showCode={showCode}
              onToggleCode={() => setShowCode((v) => !v)}
              onApprove={onApprove}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          onClick={onToggleJudge}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: C.ink3,
            fontFamily: MONO,
          }}
        >
          {judge ? 'hide raw stages' : 'show raw stages →'}
        </button>
      </div>
    </section>
  );
}

function Headline({
  isReuse,
  determined,
}: {
  isReuse: boolean;
  determined: boolean;
}) {
  const title = !determined
    ? 'Checking your library'
    : isReuse
      ? 'Reusing a tool you already own'
      : 'Forging a new tool';
  const sub = !determined
    ? 'Deciding whether to reuse or build'
    : isReuse
      ? 'Instant — no AI, no waiting'
      : 'Writing it, checking it, then asking you';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 18,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: isReuse ? C.greenSoft : C.tealSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isReuse ? (
            <span style={{ color: C.green, fontSize: 15, fontWeight: 800 }}>
              ↻
            </span>
          ) : (
            <span
              style={{
                width: 11,
                height: 11,
                background: C.teal,
                borderRadius: 3,
                transform: 'rotate(45deg)',
              }}
            />
          )}
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>
            {title}
          </div>
          <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 1 }}>
            {sub}
          </div>
        </div>
      </div>
      {determined ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: isReuse ? C.greenDk : C.tealDk,
              background: isReuse ? C.greenSoft : C.tealSoft,
              borderRadius: 999,
              padding: '4px 11px',
            }}
          >
            {isReuse ? 'REUSE PATH' : 'BUILD PATH'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Node({
  stage,
  status,
  isLast,
  build,
  judge,
  showCode,
  onToggleCode,
  onApprove,
}: {
  stage: BuildStage;
  status: NodeStatus;
  isLast: boolean;
  build: BuildState;
  judge: boolean;
  showCode: boolean;
  onToggleCode: () => void;
  onApprove: () => void;
}) {
  const label = PLAIN[stage] ?? stage;
  const msg = build.messages[stage];

  let dot;
  if (status === 'done') {
    dot = (
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: C.green,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          animation: 'frgPop .3s ease',
        }}
      >
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>✓</span>
      </div>
    );
  } else if (status === 'active' || status === 'gate') {
    const col = status === 'gate' ? C.amber : C.teal;
    dot = (
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: `2px solid ${col}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          animation: 'frgPulse 1.7s ease-in-out infinite',
        }}
      >
        <span
          style={{ width: 9, height: 9, borderRadius: '50%', background: col }}
        />
      </div>
    );
  } else {
    dot = (
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '2px solid #dfe3ea',
          background: '#fff',
          flex: 'none',
        }}
      />
    );
  }

  const connector = isLast ? null : (
    <div
      style={{
        width: 2,
        flex: 1,
        minHeight: 18,
        background:
          status === 'done'
            ? C.green
            : status === 'active' || status === 'gate'
              ? `linear-gradient(${C.teal},#e6e8ee)`
              : '#e9ebf0',
        borderRadius: 2,
        transition: 'background .4s ease',
      }}
    />
  );

  const titleColor = status === 'pending' ? C.ink3 : C.ink;
  const titleWeight = status === 'active' || status === 'gate' ? 700 : 600;

  let extra = null;
  if (stage === 'reuse' && status !== 'pending')
    extra = <ReuseMatch build={build} judge={judge} />;
  if (stage === 'synthesized' && status !== 'pending')
    extra = <Provenance build={build} judge={judge} />;
  if (stage === 'verified' && status === 'gate')
    extra = (
      <Gate
        build={build}
        showCode={showCode}
        onToggleCode={onToggleCode}
        onApprove={onApprove}
      />
    );

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {dot}
        {connector}
      </div>
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 14.5, fontWeight: titleWeight, color: titleColor }}>
            {label}
          </span>
          {judge ? (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: C.ink3,
                background: '#f2f4f7',
                border: '1px solid #e9ebf0',
                borderRadius: 5,
                padding: '1px 6px',
              }}
            >
              {stage}
            </span>
          ) : null}
        </div>
        {msg && status !== 'pending' ? (
          <div
            style={{
              fontSize: 12.5,
              color: C.ink2,
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            {msg}
          </div>
        ) : null}
        {extra}
      </div>
    </div>
  );
}

function ReuseMatch({ build, judge }: { build: BuildState; judge: boolean }) {
  const p = build.payloads.reuse as
    | { capability_id?: string; similarity?: number }
    | undefined;
  if (!p) return null;
  const sim = p.similarity ?? 0;
  const pct = Math.round(sim * 100);
  const strength =
    pct >= 75 ? 'Strong match' : pct >= 55 ? 'Good match' : 'Partial match';
  const name = build.messages.reuse ?? '';
  return (
    <div
      style={{
        marginTop: 9,
        background: C.greenSoft,
        border: '1px solid #cdeedd',
        borderRadius: 12,
        padding: '12px 14px',
        animation: 'frgUp .3s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            color: C.ink,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.greenDk }}>
            {strength}
          </span>
          <div
            style={{
              width: 64,
              height: 6,
              background: '#fff',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: C.green,
                borderRadius: 999,
              }}
            />
          </div>
          {judge ? (
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.greenDk }}>
              sim {sim.toFixed(2)}
            </span>
          ) : (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11.5,
                fontWeight: 700,
                color: C.greenDk,
              }}
            >
              {pct}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Provenance({ build, judge }: { build: BuildState; judge: boolean }) {
  const p = build.payloads.synthesized as
    | {
        built_from?: BuiltFrom[];
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined;
  if (!p) return null;
  const bf = p.built_from ?? [];
  const inTok = p.input_tokens ?? 0;
  const outTok = p.output_tokens ?? 0;
  return (
    <div
      style={{
        marginTop: 9,
        background: C.amberSoft,
        border: '1px solid #f1ddbe',
        borderRadius: 12,
        padding: '12px 14px',
        animation: 'frgUp .3s ease',
      }}
    >
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: C.amberDk,
          marginBottom: 4,
        }}
      >
        Built on {bf.length} tool{bf.length === 1 ? '' : 's'} you already have
      </div>
      <div style={{ fontSize: 11.5, color: C.ink2, marginBottom: 4 }}>
        Every tool makes the next one smarter — this is your compounding
        advantage.
      </div>
      {bf.map((it, i) => {
        const sim = it.similarity ?? 0;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '7px 0',
              borderTop: i ? '1px solid #f4e9d8' : 'none',
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12.5,
                color: C.ink,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {it.name}
            </span>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}
            >
              <div
                style={{
                  width: 52,
                  height: 5,
                  background: '#fff',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(sim * 100)}%`,
                    background: C.amber,
                    borderRadius: 999,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: C.amberDk,
                  width: 30,
                  textAlign: 'right',
                }}
              >
                {judge ? sim.toFixed(2) : `${Math.round(sim * 100)}%`}
              </span>
            </div>
          </div>
        );
      })}
      {judge ? (
        <div
          style={{
            display: 'flex',
            gap: 14,
            marginTop: 9,
            paddingTop: 9,
            borderTop: '1px solid #f4e9d8',
            fontFamily: MONO,
            fontSize: 11,
            color: C.amberDk,
          }}
        >
          <span>in {inTok} tok</span>
          <span>out {outTok} tok</span>
          <span style={{ color: C.ink3 }}>
            ~{((inTok * 3 + outTok * 15) / 1e6).toFixed(4)} usd
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Gate({
  build,
  showCode,
  onToggleCode,
  onApprove,
}: {
  build: BuildState;
  showCode: boolean;
  onToggleCode: () => void;
  onApprove: () => void;
}) {
  // The synthesized payload carries the manifest; the source isn't streamed,
  // so the gate's "View the code" reveals the synthesized logic if present.
  const synth = build.payloads.synthesized as
    | { manifest?: { logic?: string }; logic?: string }
    | undefined;
  const verifiedPayload = build.payloads.verified as
    | { logic?: string }
    | undefined;
  const logic =
    verifiedPayload?.logic ?? synth?.logic ?? synth?.manifest?.logic ?? null;

  return (
    <div
      style={{
        marginTop: 11,
        background: '#fff',
        border: `1.5px solid ${C.teal}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: '0 10px 28px rgba(14,163,173,0.16)',
        animation: 'frgPop .3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: C.tealSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <span style={{ color: C.tealDk, fontSize: 17 }}>⛨</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>
            Your approval is required
          </div>
          <div
            style={{
              fontSize: 13,
              color: C.ink2,
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            Forge wrote and safety-checked this tool. Review and approve before it
            runs on patient data. Nothing happens until you say so.
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 15,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={onApprove}
          disabled={build.approving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            background: build.approving ? '#9fd9dd' : C.teal,
            color: '#fff',
            border: 'none',
            borderRadius: 11,
            padding: '12px 22px',
            fontSize: 14.5,
            fontWeight: 700,
            cursor: build.approving ? 'default' : 'pointer',
            boxShadow: '0 6px 16px rgba(14,163,173,0.28)',
          }}
        >
          <span style={{ fontSize: 15 }}>✓</span>
          {build.approving ? 'Approving…' : 'Approve & Run'}
        </button>
        {logic ? (
          <button
            onClick={onToggleCode}
            style={{
              background: '#f2f4f7',
              border: `1px solid ${C.line}`,
              borderRadius: 11,
              padding: '12px 18px',
              fontSize: 13.5,
              fontWeight: 600,
              color: C.ink2,
              cursor: 'pointer',
            }}
          >
            {showCode ? 'Hide the code' : 'View the code'}
          </button>
        ) : null}
        <span
          style={{
            fontSize: 12,
            color: C.ink3,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: C.green,
            }}
          />
          Safety check passed
        </span>
      </div>
      {showCode && logic ? (
        <div style={{ marginTop: 12 }}>
          <CodeBlock logic={logic} maxH={240} />
        </div>
      ) : null}
    </div>
  );
}

function FailurePanel({ build }: { build: BuildState }) {
  const stage = build.currentStage ?? 'error';
  const heading =
    stage === 'verify_failed'
      ? 'Safety check did not pass'
      : stage === 'timeout'
        ? 'This took too long'
        : 'Something went wrong';
  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: '20px 22px',
        boxShadow:
          '0 1px 2px rgba(20,30,50,0.03), 0 10px 30px rgba(20,30,50,0.05)',
        animation: 'frgUp .3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: C.redSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <span style={{ color: C.red, fontSize: 16, fontWeight: 800 }}>!</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>
            {heading}
          </div>
          <div
            style={{
              fontSize: 13,
              color: C.ink2,
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {build.failMessage || 'Please try rephrasing your request.'}
          </div>
        </div>
      </div>
    </section>
  );
}
