// Chart color tokens derived from the shell's light-theme `C` palette (theme.ts)
// so charts visually match the rest of the app. No new colors are introduced.
import { C } from '../theme';

export const palette = {
  // Categorical series colors, used in order for bars / donut slices / grouped series.
  cat: [C.teal, C.violet, C.amber, C.green, C.red, C.tealDk, C.amberDk, C.greenDk],
  // Threshold reference lines (clinical decision lines) — amber to read as "watch this".
  threshold: C.amber,
  // Cartesian grid + axis chrome.
  grid: C.line,
  axis: C.ink4,
  tick: C.ink3,
  // Tooltip surface (matches the card theme).
  tooltipBg: '#fff',
  tooltipBorder: C.line,
  tooltipText: C.ink,
} as const;
