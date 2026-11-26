import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureAppDirs, getAppPaths, isPidAlive, readRuntime, type AppPaths, type RuntimeInfo } from '@cameleon/kit';
import { APP_NAME, createEngineClient, EngineError, type EngineClient } from '@cameleon/shared';

export const getPaths = (): AppPaths => getAppPaths(APP_NAME);
export const runtimeFile = (p: AppPaths) => path.join(p.data, 'runtime.json');
export const logFile = (p: AppPaths) => path.join(p.logs, 'engine.log');

export async function probe(info: RuntimeInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://${info.host}:${info.port}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runningEngine(p = getPaths()): Promise<RuntimeInfo | null> {
  const info = readRuntime(runtimeFile(p));
  return info && isPidAlive(info.pid) && (await probe(info)) ? info : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start the engine as a detached background process (survives the terminal). */
/** `nodeBin` lets hosts that are not Node themselves (Electron) point to a real Node binary: the engine uses native modules built for Node. */
export async function startDaemon(p = getPaths(), nodeBin: string = process.execPath): Promise<RuntimeInfo> {
  const existing = await runningEngine(p);
  if (existing) return existing;
  ensureAppDirs(p);
  const log = logFile(p);
  try {
    if (fs.statSync(log).size > 5 * 1024 * 1024) fs.renameSync(log, `${log}.1`);
  } catch { /* no log yet */ }
  const fd = fs.openSync(log, 'a', 0o600);
  const daemon = fileURLToPath(import.meta.resolve('@cameleon/engine/daemon'));
  const child = spawn(nodeBin, [daemon], {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: process.env,
    shell: false,
  });
  child.unref();
  fs.closeSync(fd);

  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const info = await runningEngine(p);
    if (info) return info;
    if (child.exitCode !== null && child.exitCode !== 0 && child.exitCode !== 3) break;
  }
  throw new Error(`Engine did not start. Check the log: ${log}`);
}

export interface Connection {
  client: EngineClient;
  info: RuntimeInfo;
  startedNow: boolean;
}

/** Connect to the engine, starting it in the background if needed (the CLI never needs a GUI). */
export async function connect(opts: { autostart?: boolean } = {}): Promise<Connection> {
  const p = getPaths();
  let info = await runningEngine(p);
  let startedNow = false;
  if (!info) {
    if (opts.autostart === false) throw new EngineError('Engine is not running. Start it with `cameleon engine start`.', 'engine_stopped', 0);
    info = await startDaemon(p);
    startedNow = true;
  }
  return { client: createEngineClient({ host: info.host, port: info.port, token: info.token }), info, startedNow };
}

export async function stopDaemon(p = getPaths()): Promise<boolean> {
  const info = await runningEngine(p);
  if (!info) return false;
  try {
    await createEngineClient({ host: info.host, port: info.port, token: info.token }).shutdown();
  } catch {
    try { process.kill(info.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (!isPidAlive(info.pid)) return true;
  }
  try { process.kill(info.pid, 'SIGKILL'); } catch { /* ignore */ }
  return true;
}

export function tailLog(p = getPaths(), lines = 50): string[] {
  try {
    const buf = fs.readFileSync(logFile(p), 'utf8');
    return buf.split('\n').filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}
