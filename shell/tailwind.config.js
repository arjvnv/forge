/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forge: {
          // Backgrounds (darkest → lightest surface)
          void: '#0a0a0c', // page background, deepest
          base: '#111318', // app shell base
          surface: '#16181f', // cards, panels
          raised: '#1c1f28', // raised elements (inputs, hover)
          border: '#2a2e3a', // hairline borders
          borderlit: '#3a3f4e', // hover/active borders

          // Ember accent (forge fire) — primary
          ember: '#f59e0b', // primary accent (amber-500)
          emberhi: '#fbbf24', // bright highlight (amber-400)
          emberlo: '#d97706', // pressed/deep (amber-600)

          // Text hierarchy (cool slate)
          text: '#e7e9ee', // primary text
          muted: '#9aa1b1', // secondary text
          faint: '#5f6675', // tertiary / placeholders / metadata
          ghost: '#3a3f4e', // disabled text

          // State colors
          forged: '#10b981', // success / installed / done (emerald-500)
          forgedhi: '#34d399', // success highlight (emerald-400)
          fail: '#ef4444', // error (red-500)
          failhi: '#f87171', // error highlight (red-400)
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      letterSpacing: {
        forge: '0.22em', // for the FORGE wordmark + stage labels
      },
      keyframes: {
        'forge-pulse': {
          // active stage glow heartbeat
          '0%, 100%': { boxShadow: '0 0 12px 0 rgba(245,158,11,0.45)' },
          '50%': { boxShadow: '0 0 22px 4px rgba(245,158,11,0.75)' },
        },
        'forge-rise': {
          // approval / failure panel entrance
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'forge-railfill': {
          // heat rail wiping down a connector segment
          '0%': { transform: 'scaleY(0)' },
          '100%': { transform: 'scaleY(1)' },
        },
        'forge-emberbreath': {
          // faint idle glyph heartbeat (empty states)
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'forge-pulse': 'forge-pulse 1.8s ease-in-out infinite',
        'forge-rise': 'forge-rise 0.28s ease-out',
        'forge-railfill': 'forge-railfill 0.5s ease-out forwards',
        'forge-emberbreath': 'forge-emberbreath 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
