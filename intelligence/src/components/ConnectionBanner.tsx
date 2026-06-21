import { MONO } from '../styles';

export function ConnectionBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        background: '#fffbeb',
        borderBottom: '1px solid #fde68a',
        padding: '9px 32px',
      }}
    >
      <span style={{ color: '#b45309', fontSize: 12, fontFamily: MONO }}>
        Backend connection lost — reconnecting…
      </span>
    </div>
  );
}
