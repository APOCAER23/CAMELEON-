import { connect, getPaths, runningEngine, startDaemon, stopDaemon, tailLog, logFile } from '../engine-control.js';
import { dim, sym } from '../ui.js';

export async function engineStart() {
  const was = await runningEngine();
  const info = await startDaemon();
  console.log(`${sym.ok} Engine ${was ? 'already running' : 'started'} ${dim(`(pid ${info.pid}, 127.0.0.1:${info.port})`)}`);
}
export async function engineStop() {
  console.log((await stopDaemon()) ? `${sym.ok} Engine stopped` : `${sym.warn} Engine was not running`);
}
export async function engineStatus() {
  const info = await runningEngine();
  if (!info) { console.log(`${sym.off} Engine stopped`); process.exitCode = 1; return; }
  const { client } = await connect({ autostart: false });
  const h = await client.health();
  console.log(`${sym.dot} Engine running  ${dim(`v${h.version} · pid ${info.pid} · 127.0.0.1:${info.port} · since ${info.startedAt}`)}`);
}
export function engineLogs(lines: number) {
  const out = tailLog(getPaths(), lines);
  console.log(out.length ? out.join('\n') : dim(`No log yet (${logFile(getPaths())})`));
}
