import { createHash, timingSafeEqual } from 'node:crypto';

export interface GuardOptions {
  /** Shared secret expected in `Authorization: Bearer <token>`. */
  token: string;
  /** Host header values accepted (DNS-rebinding defence). Evaluated per request so the port may be known late. */
  allowedHosts: () => readonly string[];
  /** Browser origins allowed to call the API. Default: none — browsers are refused. */
  allowedOrigins?: readonly string[];
  /** Paths reachable without a token (still host/origin checked). */
  publicPaths?: readonly string[];
}

export interface GuardRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: 'bad_host' | 'bad_origin' | 'cross_site' | 'unauthorized'; message: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Framework-agnostic guard for localhost-only HTTP APIs.
 * Layers: Host allow-list  →  Origin / Sec-Fetch-Site rejection  →  constant-time bearer token.
 */
export function createRequestGuard(opts: GuardOptions): (req: GuardRequest) => GuardResult {
  const expected = digest(opts.token);
  return (req) => {
    const host = first(req.headers['host'])?.toLowerCase();
    if (!host || !opts.allowedHosts().some((h) => h.toLowerCase() === host)) {
      return { ok: false, status: 403, code: 'bad_host', message: 'Host not allowed' };
    }
    const origin = first(req.headers['origin']);
    if (origin !== undefined && !(opts.allowedOrigins ?? []).includes(origin)) {
      return { ok: false, status: 403, code: 'bad_origin', message: 'Origin not allowed' };
    }
    if (first(req.headers['sec-fetch-site']) === 'cross-site') {
      return { ok: false, status: 403, code: 'cross_site', message: 'Cross-site requests are refused' };
    }
    const pathname = req.url.split('?')[0] ?? '';
    if (opts.publicPaths?.includes(pathname)) return { ok: true };
    const auth = first(req.headers['authorization']);
    const presented = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      return { ok: false, status: 401, code: 'unauthorized', message: 'Missing or invalid token' };
    }
    return { ok: true };
  };
}
