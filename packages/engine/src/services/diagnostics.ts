import fs from 'node:fs';
import type { DiagnosticCheck } from '@cameleon/shared';
import type { EngineContext } from '../context.js';

/** Health checks shown by the desktop "Diagnostics" panel (the CLI `doctor` adds client-side checks on top). */
export async function runDiagnostics(ctx: EngineContext): Promise<DiagnosticCheck[]> {
  const out: DiagnosticCheck[] = [];
  const add = (level: DiagnosticCheck['level'], title: string, detail: string | null = null, fix: string | null = null) => out.push({ level, title, detail, fix });

  add('ok', 'Engine running', `pid ${process.pid} · Node ${process.version}`);
  if (ctx.vaultInfo.osProtected) add('ok', 'Secrets stored in the OS credential manager', ctx.vaultInfo.detail);
  else add('warn', 'Secrets stored in the encrypted file vault', ctx.vaultInfo.detail, 'Install/start a system credential manager (Secret Service on Linux) for stronger protection.');

  const integrity = (ctx.db.pragma('integrity_check', { simple: true }) as string);
  if (integrity === 'ok') add('ok', 'Database integrity', `schema v${ctx.schemaVersion}`);
  else add('fail', 'Database integrity check failed', integrity, 'Restore from a backup or remove the database file to start fresh (credentials must be re-entered).');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(ctx.paths.data).mode & 0o077;
    if (mode === 0) add('ok', 'Data directory is private to your user', ctx.paths.data);
    else add('warn', 'Data directory is accessible by other users', ctx.paths.data, `chmod 700 "${ctx.paths.data}"`);
  }
  if (ctx.catalog.invalidFiles.length) add('warn', `${ctx.catalog.invalidFiles.length} invalid provider file(s) ignored`, ctx.catalog.invalidFiles.join(', '), `Fix the JSON in ${ctx.paths.config}/providers.d`);

  const providers = ctx.providers.list();
  const broken = providers.filter((p) => p.status === 'error');
  if (broken.length) add('warn', `${broken.length} provider(s) failed their last connection test`, broken.map((p) => p.name).join(', '), 'Test the connection again or replace the API key.');
  const untested = providers.filter((p) => p.status === 'configured' && p.discovery.kind === 'endpoint');
  if (untested.length) add('warn', `${untested.length} configured provider(s) never tested`, untested.map((p) => p.name).join(', '), 'Open the provider and run “Test connection”.');
  if (providers.some((p) => p.status !== 'not_configured') && ctx.models.count() === 0) add('warn', 'No models in the registry yet', null, 'Refresh the model catalog.');

  const agents = await ctx.launcher.agents();
  const installed = agents.filter((a) => a.installed);
  if (installed.length) add('ok', `${installed.length} agent(s) detected`, installed.map((a) => `${a.name}${a.version ? ` ${a.version}` : ''}`).join(', '));
  else add('warn', 'No supported agent detected', null, 'Install Claude Code, OpenCode or Codex CLI (see the Agents page).');
  return out;
}
