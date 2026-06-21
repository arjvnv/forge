import type { ReactNode } from 'react';
import { C, MONO } from '../theme';

// Ported from the design's highlightPython(): comments, strings, keywords, numbers.
function highlightPython(code: string): ReactNode[] {
  const re =
    /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(async|await|def|for|if|elif|else|in|return|None|True|False|not|and|or|continue|import|from|len)\b|(\b\d+\.?\d*\b)/g;
  const parts: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    let color: string = C.ink;
    if (m[1]) color = '#8a98a8';
    else if (m[2]) color = C.tealDk;
    else if (m[3]) color = C.violet;
    else if (m[4]) color = C.amberDk;
    parts.push(
      <span key={k++} style={{ color }}>
        {m[0]}
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < code.length) parts.push(code.slice(last));
  return parts;
}

export default function CodeBlock({
  logic,
  maxH = 280,
}: {
  logic: string;
  maxH?: number;
}) {
  return (
    <pre
      className="frg-scroll"
      style={{
        margin: 0,
        background: '#f8f9fb',
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        padding: '14px 16px',
        fontFamily: MONO,
        fontSize: 12.3,
        lineHeight: 1.65,
        color: C.ink,
        overflow: 'auto',
        maxHeight: maxH,
        whiteSpace: 'pre',
      }}
    >
      {highlightPython(logic)}
    </pre>
  );
}
