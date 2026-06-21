// Color palette ported verbatim from the design's `C` object.
export const C = {
  bg: '#f4f5f7',
  card: '#fff',
  line: '#e6e8ee',
  line2: '#eef0f4',
  ink: '#1b2330',
  ink2: '#5b6675',
  ink3: '#9aa3b0',
  ink4: '#c4cad4',
  teal: '#0ea3ad',
  tealDk: '#0c8c95',
  tealSoft: '#e3f5f6',
  green: '#13b16a',
  greenDk: '#0f9659',
  greenSoft: '#e3f6ec',
  red: '#ef6a60',
  redSoft: '#fdecea',
  amber: '#e8973a',
  amberDk: '#b06a16',
  amberSoft: '#fbeede',
  violet: '#7c6cf0',
} as const;

export const MONO = "'JetBrains Mono', monospace";

export function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
