import { confirm, input, select } from '@inquirer/prompts';
import { EngineError } from '@cameleon/shared';
import { connect } from '../engine-control.js';
import { pickSelection } from '../picker.js';
import { bold, compatBadge, dim, isInteractive, mono, splitArgs, sym, table } from '../ui.js';

export async function listProfiles(o: { json?: boolean }) {
  const { client } = await connect();
  const list = await client.profiles();
  if (o.json) return console.log(JSON.stringify(list, null, 2));
  if (!list.length) return console.log(dim('No profiles yet. Create one: cameleon profile create'));
  console.log(table(
    list.map((p) => [`${p.active ? sym.dot : ' '} ${p.name}`, p.agentId, p.providerName ?? dim(p.providerId), mono(p.modelId), compatBadge(p.compat.status)]),
    ['PROFILE', 'AGENT', 'PROVIDER', 'MODEL', 'STATUS'],
  ));
  console.log(dim(`\n● active profile — used by \`cameleon launch\` without arguments`));
}

export async function showProfile(name: string) {
  const { client } = await connect();
  const p = (await client.profiles()).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) throw new Error(`No profile named "${name}".`);
  console.log(`${bold(p.name)} ${p.active ? dim('(active)') : ''}`);
  console.log(`  agent      ${p.agentId}\n  provider   ${p.providerName ?? p.providerId}${p.credentialLabel ? dim(` (${p.credentialLabel})`) : ''}\n  model      ${mono(p.modelId)}`);
  console.log(`  args       ${p.launchArgs.join(' ') || dim('–')}\n  project    ${p.projectPath ?? dim('–')}\n  status     ${compatBadge(p.compat.status)}`);
  for (const r of p.compat.reasons) console.log(`             ${dim(`· ${r.message}`)}`);
}

export interface CreateOptions { agent?: string; provider?: string; model?: string; label?: string; args?: string; project?: string }

export async function createProfile(nameArg: string | undefined, o: CreateOptions) {
  const { client } = await connect();
  const interactive = isInteractive();
  const agents = await client.agents();
  const name = nameArg ?? (interactive ? await input({ message: 'Profile name', validate: (v) => v.trim().length > 0 || 'Required' }) : undefined);
  if (!name) throw new Error('Profile name required.');
  const agentId = o.agent ?? (interactive ? await select<string>({ message: 'Default agent', choices: agents.map((a) => ({ name: a.name, value: a.id })) }) : undefined);
  const agent = agents.find((a) => a.id === agentId || a.aliases.includes(agentId ?? ''));
  if (!agent) throw new Error(`Agent required. Available: ${agents.map((a) => a.id).join(', ')}`);
  const sel = await pickSelection(client, agent, { providerId: o.provider, modelId: o.model });
  const launchArgs = o.args ? splitArgs(o.args) : interactive ? splitArgs(await input({ message: 'Extra launch arguments (optional)' })) : [];
  try {
    const p = await client.createProfile({ name, agentId: agent.id, providerId: sel.providerId, modelId: sel.modelId, credentialLabel: o.label ?? null, launchArgs, projectPath: o.project ?? null });
    console.log(`${sym.ok} Profile ${bold(p.name)} created  ${compatBadge(p.compat.status)}`);
    console.log(dim(`  Activate it with: cameleon profile switch "${p.name}"`));
  } catch (e) {
    if (e instanceof EngineError && e.issues?.length) { console.error(`${sym.fail} ${e.message}`); for (const i of e.issues) console.error(`   ${dim(i.path)}: ${i.message}`); process.exitCode = 1; return; }
    throw e;
  }
}

export async function switchProfile(name: string | undefined, o: { none?: boolean }) {
  const { client } = await connect();
  if (o.none) { await client.activateProfile(null); return console.log(`${sym.ok} No active profile`); }
  const profiles = await client.profiles();
  if (!name) {
    if (!isInteractive()) throw new Error('Profile name required.');
    name = await select<string>({ message: 'Activate which profile?', choices: profiles.map((p) => ({ name: `${p.name}  ${dim(`${p.agentId} · ${p.modelId}`)}`, value: p.name })) });
  }
  const p = profiles.find((x) => x.name.toLowerCase() === name!.toLowerCase());
  if (!p) throw new Error(`No profile named "${name}". Available: ${profiles.map((x) => x.name).join(', ') || 'none'}`);
  await client.activateProfile(p.id);
  console.log(`${sym.ok} Active profile: ${bold(p.name)}  ${compatBadge(p.compat.status)}`);
}

export async function deleteProfile(name: string, o: { yes?: boolean }) {
  const { client } = await connect();
  const p = (await client.profiles()).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) throw new Error(`No profile named "${name}".`);
  if (!o.yes) {
    if (!isInteractive()) throw new Error('Refusing to delete without --yes in non-interactive mode.');
    if (!(await confirm({ message: `Delete profile "${p.name}"?`, default: false }))) return;
  }
  await client.deleteProfile(p.id);
  console.log(`${sym.ok} Profile "${p.name}" deleted`);
}
