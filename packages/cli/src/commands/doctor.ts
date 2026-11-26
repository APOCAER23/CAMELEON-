import fs from 'node:fs';
import http from 'node:http';
import { createEngineClient } from '@cameleon/shared';
import { connect, getPaths, logFile, runtimeFile } from '../engine-control.js';
import { bold, dim, sym } from '../ui.js';

type Level = 'ok' | 'warn' | 'fail';
interface Check { level: Level; title: string; detail?: string; fix?: string }

export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];
  const add = (level: Level, title: string, detail?: string, fix?: string) => checks.push({ level, title, detail, fix });
  const p = getPaths();

  const [maj = 0, min = 0] = process.versions.node.split('.').map(Number);
  if (maj > 20 || (maj === 20 && min >= 6)) add('ok', `Node.js ${process.versions.node}`);
  else add('fail', `Node.js ${process.versions.node} is too old`, undefined, 'Install Node.js 20.6 or newer.');

  for (const [name, dir] of Object.entries(p)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.accessSync(dir, fs.constants.W_OK);
      if (process.platform !== 'win32' && (fs.statSync(dir).mode & 0o077) !== 0) add('warn', `${name} directory is accessible by other users`, dir, `chmod 700 "${dir}"`);
      else add('ok', `${name} directory writable`, dir);
    } catch (e) {
      add('fail', `${name} directory not writable`, `${dir} — ${(e as Error).message}`, 'Fix the permissions or set CAMELEON_HOME to another folder.');
    }
  }

  try {
    const { client, info, startedNow } = await connect();
    add('ok', startedNow ? 'Engine was stopped — started it in the background' : 'Engine reachable', `127.0.0.1:${info.port} · pid ${info.pid}`);

    if (info.host === '127.0.0.1' || info.host === '::1') add('ok', 'Engine listens on loopback only');
    else add('fail', `Engine bound to ${info.host}`, undefined, 'The engine must never be exposed beyond localhost.');

    const noToken = await fetch(`http://${info.host}:${info.port}/v1/status`).then((r) => r.status).catch(() => 0);
    if (noToken === 401) add('ok', 'Unauthenticated requests are rejected (401)');
    else add('fail', `Unauthenticated request returned ${noToken}`, undefined, 'Restart the engine: cameleon engine stop && cameleon engine start');

    // fetch() forbids overriding Host, so use a raw request to simulate a DNS-rebinding attempt.
    const wrongHost = await new Promise<number>((resolve) => {
      const req = http.request({ host: info.host, port: info.port, path: '/health', headers: { host: 'evil.example' }, timeout: 2000 }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.end();
    });
    if (wrongHost === 403) add('ok', 'Foreign Host headers are rejected (DNS-rebinding protection)');
    else add('warn', 'Host-header check could not be confirmed');

    if (process.platform !== 'win32') {
      const mode = fs.statSync(runtimeFile(p)).mode & 0o777;
      if (mode === 0o600) add('ok', 'Engine token file is private (0600)');
      else add('fail', `Engine token file permissions are ${mode.toString(8)}`, runtimeFile(p), `chmod 600 "${runtimeFile(p)}"`);
    }

    const s = await createEngineClient({ host: info.host, port: info.port, token: info.token }).status();
    if (s.vault.osProtected) add('ok', `Secrets stored in the ${s.vault.detail}`);
    else add('warn', 'OS credential manager unavailable — using the encrypted file vault', s.vault.detail,
      process.platform === 'linux' ? 'Install and start a Secret Service (gnome-keyring or KWallet) for stronger protection.' : 'Check that the OS credential manager is available to this user.');
    add('ok', `Database schema v${s.database.schemaVersion}`, s.database.path);
    add('ok', `${s.catalog.providers} providers in the catalog`);
    const agentList = await client.agents(true);
    const have = agentList.filter((a) => a.installed);
    if (have.length) add('ok', `${have.length} agent(s) detected`, have.map((a) => `${a.name}${a.version ? ` ${a.version}` : ''}`).join(', '));
    else add('warn', 'No supported agent detected', undefined, `Install one: ${agentList.map((a) => a.install.commands[0]).filter(Boolean).join('  |  ')}`);
    const provs = await client.providers();
    const broken = provs.filter((p) => p.status === 'error');
    if (broken.length) add('warn', `${broken.length} provider(s) failed their last connection test`, broken.map((p) => p.name).join(', '), 'Run `cameleon provider test` and re-enter the key if it was revoked.');
    const untested = provs.filter((p) => p.status === 'configured' && p.discovery.kind === 'endpoint');
    if (untested.length) add('warn', `${untested.length} configured provider(s) never tested`, untested.map((p) => p.name).join(', '), 'Run `cameleon provider test`.');
    if (s.counts.providersConfigured > 0 && s.counts.models === 0) add('warn', 'No models in the registry yet', undefined, 'Run `cameleon models sync`.');
    if (s.catalog.invalidFiles.length) add('warn', `${s.catalog.invalidFiles.length} invalid provider file(s) ignored`, s.catalog.invalidFiles.join(', '), `Fix the JSON in ${p.config}/providers.d`);
  } catch (e) {
    add('fail', 'Engine unreachable', (e as Error).message, `See the log: ${logFile(p)}`);
  }

  console.log(bold('CAMELEON doctor') + '\n');
  for (const c of checks) {
    console.log(`${c.level === 'ok' ? sym.ok : c.level === 'warn' ? sym.warn : sym.fail} ${c.title}${c.detail ? dim('  ' + c.detail) : ''}`);
    if (c.fix && c.level !== 'ok') console.log(`   ${dim('→ ' + c.fix)}`);
  }
  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  console.log(`\n${fails ? sym.fail : warns ? sym.warn : sym.ok} ${checks.length - fails - warns} passed · ${warns} warning(s) · ${fails} failure(s)`);
  return fails ? 1 : 0;
}
