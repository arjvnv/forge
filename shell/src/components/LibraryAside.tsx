import { useState } from 'react';
import { C, MONO, fmtDate } from '../theme';
import type { Manifest } from '../types';

export default function LibraryAside({
  library,
  runningId,
  onOpen,
  onRun,
}: {
  library: Manifest[];
  runningId: string | null;
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
}) {
  return (
    <aside
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        boxShadow:
          '0 1px 2px rgba(20,30,50,0.03), 0 8px 28px rgba(20,30,50,0.04)',
        overflow: 'hidden',
        position: 'sticky',
        top: 22,
      }}
    >
      <div
        style={{
          padding: '18px 18px 12px',
          borderBottom: `1px solid ${C.line2}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Your tools</div>
          <div style={{ fontSize: 12, color: C.ink3, marginTop: 1 }}>
            Owned software, built once
          </div>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            color: C.ink2,
            background: '#f2f4f7',
            borderRadius: 999,
            padding: '4px 10px',
          }}
        >
          {library.length}
        </span>
      </div>
      <div
        className="frg-scroll"
        style={{
          padding: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
          maxHeight: 760,
          overflowY: 'auto',
        }}
      >
        {library.length === 0 ? (
          <div
            style={{
              padding: '30px 14px',
              textAlign: 'center',
              fontSize: 13,
              color: C.ink3,
            }}
          >
            No tools yet — forge your first one above.
          </div>
        ) : (
          library.map((cap) => (
            <LibraryCard
              key={cap.id}
              cap={cap}
              running={runningId === cap.id}
              onOpen={() => onOpen(cap.id)}
              onRun={() => onRun(cap.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function LibraryCard({
  cap,
  running,
  onOpen,
  onRun,
}: {
  cap: Manifest;
  running: boolean;
  onOpen: () => void;
  onRun: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [runHover, setRunHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? '#bfe7ea' : C.line}`,
        borderRadius: 14,
        padding: 14,
        cursor: 'pointer',
        transition: 'all .15s ease',
        background: '#fff',
        boxShadow: hovered ? '0 6px 18px rgba(20,30,50,0.06)' : 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            color: C.ink,
            lineHeight: 1.3,
            flex: 1,
          }}
        >
          {cap.name}
        </div>
        <span
          title="times reused"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
            color: C.amberDk,
            background: C.amberSoft,
            borderRadius: 999,
            padding: '3px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          ×{cap.reuse_count}
        </span>
      </div>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: C.ink2,
        }}
      >
        {cap.description}
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 5,
          marginTop: 11,
        }}
      >
        {(cap.reads ?? []).map((rd, i) => (
          <span
            key={i}
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: '#41506a',
              background: '#f2f4f7',
              border: '1px solid #e9ebf0',
              borderRadius: 6,
              padding: '2px 7px',
            }}
          >
            {rd}
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <span style={{ fontSize: 11.5, color: C.ink3 }}>
          forged {fmtDate(cap.created_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          onMouseEnter={() => setRunHover(true)}
          onMouseLeave={() => setRunHover(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: runHover ? C.teal : '#eaf7f8',
            color: runHover ? '#fff' : '#0c8c95',
            border: `1px solid ${runHover ? C.teal : '#cdebed'}`,
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: running ? 'default' : 'pointer',
            transition: 'all .14s ease',
          }}
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
  );
}
