import { spawn } from 'node:child_process';
import { findExecutable } from '@cameleon/kit';

export interface TerminalRequest {
  nodeBin: string;
  cliBin: string;
  cwd: string;
  /** Arguments for the CAMELEON CLI, e.g. ['launch','claude','--provider','openrouter'] — or null for a plain shell. */
  cliArgs: string[] | null;
}
export interface TerminalCommand { command: string; args: string[] }

export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const isSafeModelId = (s: string): boolean => /^[A-Za-z0-9~][A-Za-z0-9._:/@+~-]{0,199}$/.test(s);
const asEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** A copy-pasteable command for when no terminal emulator can be opened automatically. */
export const manualCommand = (r: TerminalRequest) => (r.cliArgs ? [r.nodeBin, r.cliBin, ...r.cliArgs].map(shQuote).join(' ') : '');

// `sh -c SCRIPT sh <cwd> <node> <cli> <args…>`: user-controlled values are separate argv entries, never spliced into the script.
const SH_LAUNCH = 'cd "$1" || exit 1; shift; "$@"; code=$?; printf "\\n[CAMELEON] session ended (exit %s). Press Enter to close. " "$code"; read _';
const SH_SHELL = 'cd "$1" || exit 1; exec "${SHELL:-sh}"';

const LINUX_TERMINALS: [string, string[]][] = [
  ['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xfce4-terminal', ['-x']], ['alacritty', ['-e']], ['kitty', []], ['xterm', ['-e']],
];

/** Pure: build the OS-specific command that opens a terminal window running the CLI. Returns null when none is available. */
export function buildTerminalCommand(
  platform: NodeJS.Platform, r: TerminalRequest, which: (names: string[]) => string | null = (n) => findExecutable(n),
): TerminalCommand | null {
  const run = r.cliArgs ? [r.nodeBin, r.cliBin, ...r.cliArgs] : [];
  if (platform === 'darwin') {
    const script = r.cliArgs ? `cd ${shQuote(r.cwd)} && ${run.map(shQuote).join(' ')}` : `cd ${shQuote(r.cwd)}`;
    return { command: 'osascript', args: ['-e', `tell application "Terminal" to do script "${asEscape(script)}"`, '-e', 'tell application "Terminal" to activate'] };
  }
  if (platform === 'win32') {
    // Title contains a space so Node's argv builder wraps it in quotes (required by `start`); `call` keeps `cmd /k` from stripping outer quotes on quoted paths.
    const execArgs = run.length ? ['call', ...run] : [];
    return { command: 'cmd.exe', args: ['/d', '/c', 'start', 'CAMELEON Terminal', '/D', r.cwd, 'cmd.exe', '/k', ...execArgs] };
  }
  for (const [term, flags] of LINUX_TERMINALS) {
    const exe = which([term]);
    if (!exe) continue;
    const shell = r.cliArgs ? ['sh', '-c', SH_LAUNCH, 'sh', r.cwd, ...run] : ['sh', '-c', SH_SHELL, 'sh', r.cwd];
    return { command: exe, args: [...flags, ...shell] };
  }
  return null;
}

export function openTerminal(cmd: TerminalCommand): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd.command, cmd.args, { detached: true, stdio: 'ignore', shell: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}
