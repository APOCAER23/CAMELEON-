import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execa } from 'execa';
import { select } from '@inquirer/prompts';
import { EngineError, type AgentView, type LaunchPlan, type LaunchRequest } from '@cameleon/shared';
import { connect, getPaths } from '../engine-control.js';
import { pickSelection } from '../picker.js';
import { bold, compatBadge, dim, green, isInteractive, mono, sym } from '../ui.js';

export interface LaunchOptions {
  provider?: string; model?: string; label?: string; profile?: string; cwd?: string; dryRun?: boolean; force?: boolean;
}

const PLACEHOLDER = /\{\{file:([a-z0-9_-]+)\}\}/gi;

function printPlanSummary(plan: LaunchPlan, version: string | null, heading: string) {
  const s = plan.summary;
  console.log(`\n${heading} ${bold(plan.agentName)}${version ? dim(`  ${version}`) : ''}`);
  console.log(`  ${dim('provider')}  ${s.providerName} ${dim(`(${s.credentialLabel} · ${s.protocol} · ${s.baseUrl})`)}`);
  console.log(`  ${dim('model')}     ${mono(s.modelId)}`);
  console.log(`  ${dim('status')}    ${compatBadge(plan.compat.status)}`);
  for (const r of plan.compat.reasons.filter((x) => x.level !== 'blocker')) console.log(`            ${dim(`· ${r.message}`)}`);
  for (const n of plan.notes) console.log(`            ${dim(`· ${n}`)}`);
}

function printInstallGuide(a: AgentView) {
  console.error(`${sym.fail} ${a.name} is not installed (or not on PATH).`);
  console.error(`   ${a.install.summary}`);
  for (const c of a.install.commands) console.error(`   ${mono(c)}`);
  console.error(dim(`   ${a.install.url}`));
}

function printIncompatible(e: EngineError) {
  console.error(`${sym.fail} ${e.message}`);
  if (e.code === 'incompatible') console.error(dim('   See why: cameleon models show <provider> <model>.  Launch anyway (at your own risk): --force'));
}

/** Remove launch directories left behind by a crash (older than a day). */
function sweepStale(root: string) {
  try {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* nothing to sweep */ }
}

export async function launchAgent(agentArg: string | undefined, passthrough: string[], o: LaunchOptions): Promise<void> {
  const { client } = await connect();
  const [agents, profiles] = await Promise.all([client.agents(true), client.profiles()]);
  const find = (x: string) => agents.find((a) => a.id === x || a.aliases.includes(x));

  /* 1 — profile and agent resolution */
  let profile = o.profile ? profiles.find((p) => p.name.toLowerCase() === o.profile!.toLowerCase()) : undefined;
  if (o.profile && !profile) throw new Error(`No profile named "${o.profile}". Available: ${profiles.map((p) => p.name).join(', ') || 'none'}`);
  if (!profile && !o.provider && !o.model) {
    const active = profiles.find((p) => p.active);
    if (active && (!agentArg || find(agentArg)?.id === active.agentId)) profile = active;
  }
  const agent = find(agentArg ?? profile?.agentId ?? '');
  if (!agent) {
    if (!agentArg) throw new Error(`Which agent? Try: cameleon launch ${agents.map((a) => a.aliases[0] ?? a.id).join(' | ')}   (or activate a profile: cameleon profile switch <name>)`);
    throw new Error(`Unknown agent "${agentArg}". Available: ${agents.map((a) => a.id).join(', ')}`);
  }
  if (profile && profile.agentId !== agent.id) throw new Error(`Profile "${profile.name}" is for ${profile.agentId}, not ${agent.id}.`);

  /* 2 — provider / model selection */
  const sel = await pickSelection(client, agent, { providerId: o.provider ?? profile?.providerId, modelId: o.model ?? (o.provider && o.provider !== profile?.providerId ? undefined : profile?.modelId) });
  const req: LaunchRequest = {
    agentId: agent.id, providerId: sel.providerId, modelId: sel.modelId,
    credentialLabel: o.label ?? (profile && profile.providerId === sel.providerId ? profile.credentialLabel ?? undefined : undefined),
    profileId: profile?.id, extraArgs: [...(profile?.launchArgs ?? []), ...passthrough], force: Boolean(o.force),
    meter: process.env['CAMELEON_NO_METER'] !== '1',
  };
  if (profile) console.log(dim(`Using profile "${profile.name}"`));

  /* 3 — dry run: show exactly what would happen, secrets masked */
  if (o.dryRun) {
    const plan = await client.inspectLaunch(req).catch((e) => { if (e instanceof EngineError) { printIncompatible(e); process.exitCode = 1; return null; } throw e; });
    if (!plan) return;
    printPlanSummary(plan, agent.version, '◇ Dry run —');
    console.log(`\n  ${dim('command')}   ${plan.command} ${plan.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log(`  ${dim('unset')}     ${plan.unsetEnv.join(', ') || '–'}`);
    console.log(`  ${dim('env')}`);
    for (const [k, v] of Object.entries(plan.env)) console.log(`    ${k}=${plan.secretEnvKeys.includes(k) ? dim(v) : v}`);
    for (const f of plan.files) console.log(`  ${dim(`temporary file ${f.filename} (deleted after the session):`)}\n${f.content.split('\n').map((l) => `    ${dim(l)}`).join('\n')}`);
    console.log(dim('\nNothing was started. Your own configuration files are never modified.'));
    return;
  }

  if (!agent.osSupported) throw new Error(`${agent.name} does not support ${process.platform}.`);
  if (!agent.installed) { printInstallGuide(agent); process.exitCode = 1; return; }
  if (agent.osNote) console.log(`${sym.warn} ${agent.osNote}`);

  /* 4 — ask the engine to prepare the launch (resolves secrets, checks compatibility, records the session) */
  let plan: LaunchPlan;
  try {
    plan = await client.prepareLaunch(req);
  } catch (e) {
    if (e instanceof EngineError && ['incompatible', 'agent_not_installed', 'os_unsupported', 'model_not_found'].includes(e.code)) { printIncompatible(e); process.exitCode = 1; return; }
    throw e;
  }
  printPlanSummary(plan, agent.version, '▶ Launching');
  if (plan.compat.status === 'incompatible') console.log(`  ${sym.warn} forced despite incompatibility`);
  console.log();

  /* 5 — materialise temporary files (0600, private directory) and resolve {{file:key}} */
  const cwd = path.resolve(o.cwd ?? process.cwd());
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
  const root = path.join(getPaths().data, 'launch');
  sweepStale(root);
  const dir = path.join(root, randomBytes(8).toString('hex'));
  const paths = new Map<string, string>();
  if (plan.files.length) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of plan.files) {
      const file = path.join(dir, path.basename(f.filename));
      fs.writeFileSync(file, f.content, { mode: 0o600 });
      paths.set(f.key, file);
    }
  }
  const sub = (s: string) => s.replace(PLACEHOLDER, (_m, k: string) => paths.get(k) ?? '');

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const k of plan.unsetEnv) delete env[k];
  for (const [k, v] of Object.entries(plan.env)) env[k] = sub(v);
  const args = plan.args.map(sub);

  /* 6 — run the real agent, attached to this terminal; monitor; clean up; report */
  let exitCode: number | null = null;
  let signal: string | null = null;
  const started = Date.now();
  try {
    const child = execa(plan.command, args, { stdio: 'inherit', env, extendEnv: false, cwd, reject: false, cleanup: true, windowsHide: false });
    const forward = (sig: NodeJS.Signals) => () => { child.kill(sig); };
    const onTerm = forward('SIGTERM'), onHup = forward('SIGHUP');
    process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
    const keepAlive = () => undefined; // Ctrl+C reaches the agent through the terminal; we must outlive it to clean up
    process.on('SIGINT', keepAlive);
    const r = await child;
    process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup); process.off('SIGINT', keepAlive);
    if (r.failed && (r as { code?: string }).code === 'ENOENT') throw new Error(`Could not start ${plan.command}`);
    signal = r.signal ?? null;
    exitCode = r.exitCode ?? (signal ? 128 + (os.constants.signals[signal as keyof typeof os.constants.signals] ?? 0) : 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (plan.launchId) await client.finishLaunch(plan.launchId, { exitCode, signal }).catch(() => undefined);
  }
  console.log(dim(`\n${agent.name} exited with code ${exitCode} after ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`));
  process.exitCode = exitCode ?? 1;
}

/** Interactive helper used by `cameleon agent launch` without an argument. */
export async function chooseAgent(): Promise<string> {
  const { client } = await connect();
  const agents = await client.agents();
  if (!isInteractive()) throw new Error('Agent required.');
  return select<string>({ message: 'Which agent?', choices: agents.map((a) => ({ name: `${a.name} ${a.installed ? green('●') : dim('○ not installed')}`, value: a.id })) });
}
