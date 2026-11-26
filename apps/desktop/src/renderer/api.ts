import { createEngineClient } from '@cameleon/shared';

/**
 * The shared typed client, with its transport swapped for Electron IPC:
 * same validation and error handling as the CLI, but the token never reaches the renderer.
 */
const ipcFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  const r = await window.cameleon.engine.request(init?.method ?? 'GET', u.pathname + u.search, body);
  return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

export const api = createEngineClient({ host: '127.0.0.1', port: 0, token: 'ipc' }, ipcFetch);
