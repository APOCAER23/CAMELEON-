import { getPaths, runningEngine, startDaemon } from '@cameleon/cli';
import type { RuntimeInfo } from '@cameleon/kit';

/**
 * Desktop → engine bridge. Runs in the main process only, so the bearer token stays out of the renderer.
 * The renderer may reach a strict allow-list of routes — never shutdown, never anything outside /v1.
 */

const NODE_BIN = process.env['CAMELEON_NODE'] || 'node'; // Electron's own binary has a different native ABI than Node

/**
 * Routes the UI may call. Deliberately ABSENT: /v1/engine/shutdown and /v1/launch/prepare (returns decrypted secrets)
 * and /v1/launch/:id/finish — only the CLI launcher uses those.
 */
const ALLOWED_PATH = new RegExp(
  '^/v1/(' + [
    'status', 'activity', 'diagnostics', 'launches', 'agents', 'compat', 'usage',
    'providers(/[a-z0-9-]{2,41}(/test)?)?',
    'credentials(/[A-Za-z0-9-]{1,80}(/test)?)?',
    'custom-providers(/[a-z0-9-]{2,41})?',
    'custom-agents(/[a-z0-9-]{2,41})?',
    'models(/sync|/detail|/compat|/cache)?',
    'launch/inspect',
    'profiles(/active|/activate|/[A-Za-z0-9-]{1,80})?',
  ].join('|') + ')(\\?[A-Za-z0-9_=&%.,:+\\-]{0,400})?$',
);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

/** Pure route check, exported for tests. */
export const isAllowedRoute = (method: unknown, path: unknown): boolean =>
  typeof method === 'string' && ALLOWED_METHODS.has(method) && typeof path === 'string' && ALLOWED_PATH.test(path);

export async function ensureEngine(): Promise<RuntimeInfo> {
  const existing = await runningEngine();
  if (existing) return existing;
  return startDaemon(getPaths(), NODE_BIN);
}

export interface BridgeResponse { status: number; body: unknown }

const err = (status: number, code: string, message: string): BridgeResponse => ({ status, body: { error: { code, message } } });

export async function forward(req: unknown): Promise<BridgeResponse> {
  if (typeof req !== 'object' || req === null) return err(400, 'bad_request', 'Invalid request');
  const { method, path, body } = req as { method?: unknown; path?: unknown; body?: unknown };
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) return err(400, 'bad_request', 'Method not allowed');
  if (typeof path !== 'string' || !ALLOWED_PATH.test(path)) return err(403, 'forbidden_route', 'Route not allowed from the UI');
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    if (typeof body !== 'object') return err(400, 'bad_request', 'Body must be a JSON object');
    payload = JSON.stringify(body);
    if (payload.length > 60_000) return err(413, 'body_too_large', 'Request body too large');
  }

  let info: RuntimeInfo;
  try {
    info = await ensureEngine();
  } catch (e) {
    return err(503, 'engine_unreachable', `Engine could not be started: ${(e as Error).message}`);
  }
  try {
    const res = await fetch(`http://${info.host}:${info.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${info.token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { status: res.status, body: json };
  } catch (e) {
    return err(503, 'engine_unreachable', `Engine unreachable: ${(e as Error).message}`);
  }
}
