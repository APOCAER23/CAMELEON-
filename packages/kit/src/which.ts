import fs from 'node:fs';
import path from 'node:path';

export interface WhichOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Extra directories searched after PATH (GUI apps often start with a minimal PATH). */
  extraDirs?: string[];
}

/** Locate an executable on PATH (honours PATHEXT on Windows). Returns an absolute path, never runs anything. */
export function findExecutable(names: string[], opts: WhichOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = [...(env['PATH'] ?? env['Path'] ?? '').split(sep).filter(Boolean), ...(opts.extraDirs ?? [])];
  const exts = platform === 'win32' ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const file = path.join(dir, name + ext);
        try {
          if (!fs.statSync(file).isFile()) continue;
          if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
          return file;
        } catch { /* keep looking */ }
      }
    }
  }
  return null;
}
