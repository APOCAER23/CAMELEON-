import chalk from 'chalk';
import ora from 'ora';

export const sym = {
  ok: chalk.green('✔'), warn: chalk.yellow('▲'), fail: chalk.red('✖'), dot: chalk.green('●'), off: chalk.gray('○'),
};
export const dim = chalk.gray;
export const bold = chalk.bold;
export const green = chalk.green;
export const mono = chalk.cyan;

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export function table(rows: string[][], headers?: string[]): string {
  const all = headers ? [headers, ...rows] : rows;
  const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const widths = all[0]!.map((_, i) => Math.max(...all.map((r) => strip(r[i] ?? '').length)));
  const line = (r: string[], head = false) =>
    r.map((c, i) => (head ? chalk.bold.gray(c) : c) + ' '.repeat(widths[i]! - strip(c).length)).join('  ').trimEnd();
  const out = all.map((r, i) => line(r, headers !== undefined && i === 0));
  if (headers) out.splice(1, 0, dim(widths.map((w) => '─'.repeat(w)).join('  ')));
  return out.join('\n');
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d`;
}

export const banner = () =>
  `${bold(green('CAMELEON'))} ${dim('— One CLI. Every Provider. Every Agent.')}`;

/** Spinner on a TTY, a plain line otherwise (CI, pipes). */
export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  if (!isInteractive()) { console.error(dim(`${text}`)); return fn(); } // progress goes to stderr: stdout stays machine-readable
  const sp = ora({ text, color: 'green' }).start();
  try {
    const r = await fn();
    sp.stop();
    return r;
  } catch (e) {
    sp.stop();
    throw e;
  }
}

export const fmtTokens = (n: number | null): string => {
  if (n === null) return dim('–');
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
};

export const capCell = (s: 'supported' | 'unsupported' | 'unknown'): string =>
  s === 'supported' ? green('✔') : s === 'unsupported' ? dim('✖') : dim('?');

export const compatBadge = (s: 'compatible' | 'limited' | 'untested' | 'incompatible'): string =>
  s === 'compatible' ? `${green('✔')} compatible` : s === 'limited' ? `${chalk.yellow('◐')} limited` : s === 'untested' ? `${dim('?')} untested` : `${chalk.red('✖')} incompatible`;

/** Minimal shell-style splitting for stored launch arguments (quotes supported, no expansion, no execution). */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '', quote: string | null = null, has = false;
  for (const ch of input) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += ch;
  }
  if (quote) throw new Error('Unbalanced quote in arguments');
  if (cur || has) out.push(cur);
  return out;
}
