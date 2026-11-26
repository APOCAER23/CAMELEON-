import { spawn as cpSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// node-pty is a native CJS addon — load via createRequire in ESM scope so both
// Node (tsx) and Electron's main process resolve the prebuilt binary cleanly.
const require = createRequire(import.meta.url);
const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty');

export interface InAppSessionSpec {
  command: string;
  args: string[];
  cwd: string;
  title: string;
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  cwd: string;
}

interface ActiveSession {
  id: string;
  proc: import('@lydell/node-pty').IPty;
  cwd: string;
  title: string;
}

const sessions = new Map<string, ActiveSession>();

/** Build platform-appropriate command & args for an embedded interactive session. */
export function buildInAppCommand(
  platform: NodeJS.Platform,
  nodeBin: string,
  cliBin: string,
  cliArgs: string[] | null,
  cwd: string,
): InAppSessionSpec {
  if (cliArgs && cliArgs.length > 0) {
    const label = cliArgs.includes('--profile')
      ? cliArgs[cliArgs.indexOf('--profile') + 1] ?? 'Profile'
      : cliArgs[1] ?? 'Agent';
    return {
      command: nodeBin,
      args: [cliBin, ...cliArgs],
      cwd,
      title: label,
    };
  }
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: [],
      cwd,
      title: 'Shell',
    };
  }
  return {
    command: process.env['SHELL'] || '/bin/sh',
    args: ['-i'],
    cwd,
    title: 'Shell',
  };
}

/** Release ConPTY worker threads and input socket handles that node-pty leaves open on Windows after exit/kill. */
function disposePty(proc: import('@lydell/node-pty').IPty): void {
  try {
    proc.kill();
  } catch {
    /* already exited */
  }
  try {
    const agent = (proc as unknown as { _agent?: { _inSocket?: { destroy?: () => void } } })._agent;
    agent?._inSocket?.destroy?.();
  } catch {
    /* ignore */
  }
}

/**
 * Spawn an interactive process inside a real pseudo-terminal (ConPTY on Windows,
 * Unix PTY on macOS/Linux).  The PTY handles echo, line editing, arrow keys,
 * colours, Ctrl+C — everything a real terminal surface needs.
 */
export function startInAppSession(
  spec: InAppSessionSpec,
  onData: (sessionId: string, text: string) => void,
  onExit: (sessionId: string, code: number, signal?: number) => void,
): SessionInfo {
  const id = randomUUID();

  const proc = pty.spawn(spec.command, spec.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: spec.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      PYTHONIOENCODING: 'utf-8',
    } as Record<string, string>,
  });

  sessions.set(id, { id, proc, cwd: spec.cwd, title: spec.title });

  proc.onData((chunk: string) => {
    onData(id, chunk);
  });

  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    disposePty(proc);
    onExit(id, exitCode, signal);
  });

  return { sessionId: id, title: spec.title, cwd: spec.cwd };
}

/** Forward raw data (keystrokes) from the renderer to the PTY. */
export function writeInAppSession(sessionId: string, data: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.proc.write(data);
  return true;
}

/** Resize the PTY to match the xterm.js viewport dimensions. */
export function resizeInAppSession(sessionId: string, cols: number, rows: number): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  try {
    s.proc.resize(cols, rows);
  } catch {
    /* ignore — PTY may already be closed */
  }
  return true;
}

export function killInAppSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  const pid = s.proc.pid;
  try {
    if (process.platform === 'win32' && pid) {
      // Kill full process tree on Windows so nested agents don't linger
      cpSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    }
    disposePty(s.proc);
  } catch {
    /* already exited */
  }
  sessions.delete(sessionId);
  return true;
}

export function killAllInAppSessions(): void {
  for (const id of [...sessions.keys()]) {
    killInAppSession(id);
  }
}
