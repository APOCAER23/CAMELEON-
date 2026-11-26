import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface AppPaths {
  /** Where user-editable configuration lives (e.g. providers.d/). */
  config: string;
  /** Databases, vault files and the daemon runtime file. */
  data: string;
  /** Disposable cache. */
  cache: string;
  /** Log files. */
  logs: string;
}

export interface PathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/**
 * Resolve per-user application directories following each OS convention.
 * Set `<APP>_HOME` (e.g. CAMELEON_HOME) to relocate everything under one folder —
 * handy for tests, portable installs and CI.
 */
export function getAppPaths(appName: string, opts: PathOptions = {}): AppPaths {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  const p = platform === 'win32' ? path.win32 : path.posix;
  const override = env[`${appName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_HOME`];
  if (override) {
    const root = path.resolve(override);
    return { config: path.join(root, 'config'), data: path.join(root, 'data'), cache: path.join(root, 'cache'), logs: path.join(root, 'logs') };
  }
  if (platform === 'win32') {
    const roaming = env['APPDATA'] ?? p.join(home, 'AppData', 'Roaming');
    const local = env['LOCALAPPDATA'] ?? p.join(home, 'AppData', 'Local');
    return {
      config: p.join(roaming, appName),
      data: p.join(local, appName, 'data'),
      cache: p.join(local, appName, 'cache'),
      logs: p.join(local, appName, 'logs'),
    };
  }
  if (platform === 'darwin') {
    const lib = p.join(home, 'Library');
    return {
      config: p.join(lib, 'Application Support', appName, 'config'),
      data: p.join(lib, 'Application Support', appName, 'data'),
      cache: p.join(lib, 'Caches', appName),
      logs: p.join(lib, 'Logs', appName),
    };
  }
  const xdg = (k: string, fallback: string) => env[k] || p.join(home, fallback);
  return {
    config: p.join(xdg('XDG_CONFIG_HOME', '.config'), appName),
    data: p.join(xdg('XDG_DATA_HOME', '.local/share'), appName),
    cache: p.join(xdg('XDG_CACHE_HOME', '.cache'), appName),
    logs: p.join(xdg('XDG_STATE_HOME', '.local/state'), appName, 'logs'),
  };
}

/** Create every directory with owner-only permissions (0700 on POSIX). */
export function ensureAppDirs(paths: AppPaths): void {
  for (const dir of Object.values(paths)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
