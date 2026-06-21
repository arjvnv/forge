import { useState } from 'react';
import { C, MONO } from '../theme';

const EXAMPLES = [
  { label: 'Diabetes A1c over 9%', text: 'Patients with diabetes whose last A1c was over 9%' },
  { label: 'Adults with obesity', text: 'Adults with obesity and a qualifying visit this year' },
  { label: 'Depression follow-ups', text: 'Patients overdue for a depression screening follow-up' },
  { label: 'Statin care gaps', text: 'High-risk patients with high LDL who are not on a statin' },
];

export default function AskBar({
  askText,
  year,
  submitting,
  onAskText,
  onYear,
  onSubmit,
}: {
  askText: string;
  year: number;
  submitting: boolean;
  onAskText: (v: string) => void;
  onYear: (v: number) => void;
  onSubmit: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const submitDisabled = submitting || !askText.trim();

  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: '20px 20px 18px',
        boxShadow:
          '0 1px 2px rgba(20,30,50,0.03), 0 8px 28px rgba(20,30,50,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 11,
        }}
      >
        <label
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: C.ink,
            whiteSpace: 'nowrap',
          }}
        >
          Ask for a tool
        </label>
        <span style={{ fontSize: 12, color: C.ink3 }}>
          Plain English — no jargon needed
        </span>
      </div>
      <textarea
        value={askText}
        onChange={(e) => onAskText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={submitting}
        placeholder="Describe the report or tool you need — e.g. patients with diabetes whose last A1c was over 9%."
        rows={2}
        style={{
          width: '100%',
          resize: 'none',
          border: `1px solid ${focused ? C.teal : '#e1e4ea'}`,
          background: focused ? '#fff' : '#fbfcfd',
          borderRadius: 12,
          padding: '13px 15px',
          fontSize: 15.5,
          lineHeight: 1.45,
          color: C.ink,
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px rgba(14,163,173,0.12)' : 'none',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 13,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 13, color: C.ink2 }}>Reporting year</span>
          <select
            value={String(year)}
            onChange={(e) => onYear(Number(e.target.value))}
            style={{
              border: '1px solid #e1e4ea',
              background: '#fff',
              borderRadius: 9,
              padding: '7px 10px',
              fontSize: 13.5,
              fontWeight: 600,
              color: C.ink,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="2021">2021</option>
            <option value="2022">2022</option>
            <option value="2023">2023</option>
            <option value="2024">2024</option>
          </select>
        </div>
        <button
          onClick={onSubmit}
          disabled={submitDisabled}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            whiteSpace: 'nowrap',
            background: submitDisabled ? '#9fd9dd' : hovered ? '#0c8c95' : C.teal,
            color: '#fff',
            border: 'none',
            borderRadius: 11,
            padding: '11px 20px',
            fontSize: 14.5,
            fontWeight: 700,
            cursor: submitDisabled ? 'default' : 'pointer',
            boxShadow: '0 6px 16px rgba(14,163,173,0.26)',
            transform: hovered && !submitDisabled ? 'translateY(-1px)' : 'none',
            transition: 'transform .12s ease, background .15s ease',
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              background: '#fff',
              borderRadius: 3,
              transform: 'rotate(45deg)',
              opacity: 0.92,
            }}
          />
          {submitting ? 'Forging…' : 'Forge it'}
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              opacity: 0.7,
              fontWeight: 500,
            }}
          >
            ⌘↵
          </span>
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 14,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11.5, color: C.ink3, marginRight: 2 }}>
          Try:
        </span>
        {EXAMPLES.map((ex) => (
          <ExampleChip key={ex.label} label={ex.label} onClick={() => onAskText(ex.text)} />
        ))}
      </div>
    </section>
  );
}

function ExampleChip({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#e3f5f6' : '#f2f4f7',
        border: `1px solid ${hovered ? '#bfe7ea' : C.line}`,
        borderRadius: 999,
        padding: '6px 12px',
        fontSize: 12.5,
        color: hovered ? '#0c8c95' : '#41506a',
        cursor: 'pointer',
        transition: 'all .14s ease',
      }}
    >
      {label}
    </button>
  );
}
