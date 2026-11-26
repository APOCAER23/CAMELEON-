import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** What a daemon publishes so that CLIs / GUIs can find and authenticate against it. */
export interface RuntimeInfo {
  pid: number;
  host: string;
  port: number;
  token: string;
  version: string;
  startedAt: string;
}

export const generateToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function writeRuntime(file: string, info: RuntimeInfo): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readRuntime(file: string): RuntimeInfo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RuntimeInfo>;
    if (
      typeof raw.pid === 'number' && typeof raw.host === 'string' && typeof raw.port === 'number' &&
      typeof raw.token === 'string' && typeof raw.version === 'string' && typeof raw.startedAt === 'string'
    ) return raw as RuntimeInfo;
    return null;
  } catch {
    return null;
  }
}

/** Remove the runtime file — only if it still belongs to `pid` (avoids racing a fresh daemon). */
export function clearRuntime(file: string, pid: number = process.pid): void {
  const cur = readRuntime(file);
  if (cur && cur.pid !== pid) return;
  fs.rmSync(file, { force: true });
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
