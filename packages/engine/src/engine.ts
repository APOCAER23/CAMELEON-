import path from 'node:path';
import {
  clearRuntime, generateToken, getAppPaths, isPidAlive, readRuntime, writeRuntime, type AppPaths, type RuntimeInfo,
} from '@cameleon/kit';
import { APP_NAME, APP_VERSION } from '@cameleon/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createContext, type EngineContext } from './context.js';

export const HOST = '127.0.0.1';
export const runtimeFileOf = (paths: AppPaths) => path.join(paths.data, 'runtime.json');

export class EngineAlreadyRunningError extends Error {
  constructor(readonly info: RuntimeInfo) {
    super(`CAMELEON engine already running (pid ${info.pid}, port ${info.port})`);
    this.name = 'EngineAlreadyRunningError';
  }
}

export interface StartOptions {
  paths?: AppPaths;
  /** 0 (default) = let the OS pick a free port; the real port is published in runtime.json. */
  port?: number;
  forceFileVault?: boolean;
  logger?: boolean;
  /** Called after a client-requested shutdown completed (daemon uses it to exit the process). */
  onShutdownRequested?: () => void;
}

export interface RunningEngine {
  app: FastifyInstance;
  ctx: EngineContext;
  port: number;
  token: string;
  runtimeFile: string;
  close(): Promise<void>;
}

async function isHealthy(info: RuntimeInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://${info.host}:${info.port}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startEngine(opts: StartOptions = {}): Promise<RunningEngine> {
  const paths = opts.paths ?? getAppPaths(APP_NAME);
  const runtimeFile = runtimeFileOf(paths);

  const existing = readRuntime(runtimeFile);
  if (existing && isPidAlive(existing.pid) && (await isHealthy(existing))) throw new EngineAlreadyRunningError(existing);

  const ctx = await createContext(paths, { forceFileVault: opts.forceFileVault });
  const token = generateToken();
  let port = 0;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    clearRuntime(runtimeFile);
    await ctx.meterProxy.close();
    await app.close();
    ctx.db.close();
  };

  await ctx.meterProxy.start();

  const app = await buildApp(ctx, {
    token,
    getPort: () => port,
    logger: opts.logger,
    onShutdown: () => void close().finally(() => opts.onShutdownRequested?.()),
  });

  await app.listen({ host: HOST, port: opts.port ?? 0 });
  port = (app.server.address() as { port: number }).port;

  writeRuntime(runtimeFile, { pid: process.pid, host: HOST, port, token, version: APP_VERSION, startedAt: ctx.startedAt });
  ctx.activity.log('engine.started', `Engine ${APP_VERSION} started on ${HOST}:${port}`);
  return { app, ctx, port, token, runtimeFile, close };
}
