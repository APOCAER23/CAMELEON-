import { useEffect, useState } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
const KEY = 'cameleon.theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export const resolve = (c: ThemeChoice): 'dark' | 'light' => (c === 'system' ? (mq().matches ? 'dark' : 'light') : c);
export const stored = (): ThemeChoice => {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light' || v === 'system') return v; } catch { /* storage unavailable */ }
  return 'system';
};
export const apply = (c: ThemeChoice) => { document.documentElement.dataset['theme'] = resolve(c); };

/** Persisted theme with instant switching (no reload) and live OS-preference tracking. */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored);
  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const m = mq();
    const on = () => apply('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [choice]);
  const set = (c: ThemeChoice) => { try { localStorage.setItem(KEY, c); } catch { /* ignore */ } setChoice(c); };
  return [choice, set];
}
