import { C, MONO } from '../theme';

export default function Hero() {
  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: 26,
        boxShadow: '0 1px 2px rgba(20,30,50,0.03)',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: C.teal,
          fontFamily: MONO,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}
      >
        How Forge works
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <div
          style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 7,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: C.green,
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              It already knows how
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: C.ink2,
            }}
          >
            When a matching tool exists, Forge{' '}
            <strong style={{ color: C.ink, fontWeight: 600 }}>reuses</strong> it —
            results land in about a second. No AI, no waiting.
          </p>
        </div>
        <div
          style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 7,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: C.teal,
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              It builds what it lacks
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: C.ink2,
            }}
          >
            For something new, Forge{' '}
            <strong style={{ color: C.ink, fontWeight: 600 }}>
              writes a tool
            </strong>{' '}
            from proven ones, safety-checks it, asks you to approve, then runs and
            saves it forever.
          </p>
        </div>
      </div>
      <p style={{ margin: '16px 0 0', fontSize: 13, color: C.ink3 }}>
        Type a request above, or tap an example, to watch a tool get forged.
      </p>
    </section>
  );
}
