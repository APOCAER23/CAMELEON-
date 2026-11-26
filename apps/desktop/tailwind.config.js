/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg-2)',
        sidebar: 'var(--sidebar)',
        card: 'var(--card)',
        elevated: 'var(--elevated)',
        primary: 'var(--primary)',
        primary2: 'var(--primary-2)',
        'primary-hover': 'var(--primary-hover)',
        'on-primary': 'var(--on-primary)',
        fg: 'var(--fg)',
        fg2: 'var(--fg-2)',
        muted: 'var(--muted)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        ok: 'var(--success)',
        warn: 'var(--warning)',
        err: 'var(--error)',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        glow: '0 0 20px -2px var(--accent-glow)',
        'glow-sm': '0 0 10px -1px var(--accent-glow)',
      },
    },
  },
  plugins: [],
};
