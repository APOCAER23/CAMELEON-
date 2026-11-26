import { useCallback, useEffect, useRef, useState } from 'react';

export interface Query<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Load data from the engine; reloads when the window regains focus (no background polling). */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    setLoading(true);
    fnRef.current().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  useEffect(() => {
    window.addEventListener('focus', run);
    return () => window.removeEventListener('focus', run);
  }, [run]);
  return { data, error, loading, reload: run };
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
