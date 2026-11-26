import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { findExecutable, redactString } from '@cameleon/kit';

export interface Detection {
  installed: boolean;
  path: string | null;
  version: string | null;
  checkedAt: string;
}

/** Directories where agent CLIs commonly land but which GUI apps often miss on PATH. */
function extraDirs(home = os.homedir()): string[] {
  return [
    path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.opencode', 'bin'),
    path.join(home, '.bun', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'),
    '/usr/local/bin', '/opt/homebrew/bin',
  ];
}

const find = (names: string[]) => findExecutable(names, { extraDirs: extraDirs() });

/** Locate the binary and read its `--version` (best effort — a failing version check never hides an installed agent). */
export async function detectBinary(names: string[]): Promise<Detection> {
  const checkedAt = new Date().toISOString();
  const file = find(names);
  if (!file) return { installed: false, path: null, version: null, checkedAt };
  let version: string | null = null;
  try {
    const r = await execa(file, ['--version'], { timeout: 5000, reject: false, stdin: 'ignore', env: { ...process.env, CI: '1', NO_COLOR: '1' }, maxBuffer: 64 * 1024 });
    const line = String(r.stdout || r.stderr || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (line && r.exitCode === 0) version = redactString(line).slice(0, 80);
  } catch { /* ignore */ }
  return { installed: true, path: file, version, checkedAt };
}
