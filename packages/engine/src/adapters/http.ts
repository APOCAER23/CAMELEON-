import { redactString } from '@cameleon/kit';
import type { TestResult } from '@cameleon/shared';

export type ErrorKind = NonNullable<TestResult['errorKind']>;

export class HttpError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly httpStatus: number | null = null) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpResult {
  status: number;
  json: unknown;
  latencyMs: number;
}

const timeoutMs = () => Number(process.env['CAMELEON_HTTP_TIMEOUT_MS']) || 10_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** Remove every known secret value (and anything key-shaped) from provider-supplied text. */
export function scrub(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  return redactString(out).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function classifyNetworkError(e: unknown, url: string): HttpError {
  const err = e as { name?: string; cause?: { code?: string; message?: string }; message?: string };
  const code = err.cause?.code;
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return new HttpError('timeout', `No answer from ${host} within ${Math.round(timeoutMs() / 1000)}s`);
  if (code === 'ECONNREFUSED') return new HttpError('network', `Connection refused by ${host} — is the server running?`);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new HttpError('network', `Cannot resolve ${host} — check the URL and your internet connection`);
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return new HttpError('network', `Network error reaching ${host} (${code})`);
  if (code && /CERT|SSL|TLS/i.test(code)) return new HttpError('network', `TLS error with ${host} (${code})`);
  return new HttpError('network', `Cannot reach ${host}`);
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError('unexpected', 'Response too large — refusing to read it'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function request(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: unknown): Promise<HttpResult> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Never follow redirects: a hostile/misconfigured endpoint must not receive our credentials elsewhere.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    throw classifyNetworkError(e, url);
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError('redirect', 'The endpoint answered with a redirect — credentials are not forwarded. Check the Base URL (http vs https, trailing path).', res.status);
  }
  let text: string;
  try {
    text = await readLimited(res);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw classifyNetworkError(e, url);
  }
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const latencyMs = Math.round(performance.now() - started);
  if (res.status >= 400) throw statusError(res.status, json);
  return { status: res.status, json, latencyMs };
}

export const getJson = (url: string, headers: Record<string, string>) => request('GET', url, headers);
export const postJson = (url: string, headers: Record<string, string>, body: unknown) => request('POST', url, headers, body);

/** Provider error message when it is a plain string (never the raw body). Caller scrubs it. */
function providerMessage(json: unknown): string {
  const j = json as { error?: { message?: unknown } | string; message?: unknown } | null;
  const m = typeof j?.error === 'string' ? j.error : j?.error?.message ?? j?.message;
  return typeof m === 'string' ? m : '';
}

function statusError(status: number, json: unknown): HttpError {
  const detail = providerMessage(json);
  const suffix = detail ? ` — provider says: ${detail}` : '';
  if (status === 401 || status === 403) return new HttpError('auth', `Authentication failed (HTTP ${status}): the API key is invalid, expired or lacks access${suffix}`, status);
  if (status === 404) return new HttpError('not_found', `Endpoint not found (HTTP 404) — check the Base URL${suffix}`, status);
  if (status === 429) return new HttpError('rate_limited', `Rate limited (HTTP 429) — the key may be fine but cannot be verified right now${suffix}`, status);
  if (status >= 500) return new HttpError('server', `Provider error (HTTP ${status}) — try again later${suffix}`, status);
  return new HttpError('unexpected', `Unexpected response (HTTP ${status})${suffix}`, status);
}
