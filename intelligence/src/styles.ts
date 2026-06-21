import type { CSSProperties } from 'react';

// Light-theme tokens (exact, from intelligence_design_ref/dashboard.dc.html).
export const C = {
  pageBg: '#f6f5f2',
  panel: '#ffffff',
  border: '#ecebe6',
  divider: '#f1f0ec',
  text: '#1e293b',
  text2: '#334155',
  secondary: '#64748b',
  muted: '#94a3b8',
  teal: '#0d9488',
  green: '#16a34a',
  amber: '#d97706',
  amber2: '#f59e0b',
  red: '#e11d48',
  stripBg: '#fafaf8',
};

export const SHADOW =
  '0 1px 2px rgba(16,24,40,0.04),0 6px 18px rgba(16,24,40,0.05)';
export const SHADOW_EXPANDED =
  '0 1px 2px rgba(16,24,40,0.04),0 10px 30px rgba(16,24,40,0.07)';

export const MONO = "'IBM Plex Mono',monospace";
export const SANS = "'IBM Plex Sans',system-ui,sans-serif";

export const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: C.muted,
  marginBottom: 12,
};

export const card: CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${C.border}`,
  background: C.panel,
  boxShadow: SHADOW,
};

export const TAG_COLORS: Record<string, string> = {
  patients: '#0284c7',
  conditions: '#d97706',
  observations: '#0891b2',
  encounters: '#7c3aed',
  medications: '#64748b',
};

// Keyframes + global resets, injected once (mirrors the design's <style>).
export const KEYFRAMES = `
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:${C.pageBg};}
  ::-webkit-scrollbar{width:9px;height:9px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:#d8dade;border-radius:9999px;}
  ::-webkit-scrollbar-thumb:hover{background:#c2c6cc;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.5;transform:scale(0.82);}}
  @keyframes growW{from{transform:scaleX(0);}to{transform:scaleX(1);}}
  @keyframes expandIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
  @keyframes popIn{from{opacity:0;transform:scale(0.97);}to{opacity:1;transform:scale(1);}}
  @media (prefers-reduced-motion: reduce){
    *{animation:none !important;}
  }
`;
