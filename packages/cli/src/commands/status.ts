import { connect, getPaths } from '../engine-control.js';
import { banner, bold, dim, fmtDuration, sym } from '../ui.js';

export async function printStatus(json = false): Promise<void> {
  const { client, info, startedNow } = await connect();
  const s = await client.status();
  if (json) {
    console.log(JSON.stringify({ ...s, port: info.port }, null, 2));
    return;
  }
  console.log(banner() + '\n');
  console.log(`${bold('Engine')}     ${sym.dot} running  ${dim(`v${s.engine.version} · pid ${s.engine.pid} · port ${info.port} · up ${fmtDuration(s.engine.uptimeSec)}`)}${startedNow ? dim('  (started now)') : ''}`);
  console.log(`${bold('Vault')}      ${s.vault.osProtected ? sym.ok : sym.warn} ${s.vault.backend}  ${dim(s.vault.detail)}`);
  console.log(`${bold('Database')}   ${dim(`${s.database.path} (schema v${s.database.schemaVersion})`)}`);
  console.log(`${bold('Providers')}  ${s.counts.providersTotal} available · ${s.counts.providersConfigured} configured · ${s.counts.providersConnected} connected · ${s.counts.credentials} credential(s)`);
  console.log(`${bold('Models')}     ${s.counts.models} in the registry ${s.counts.models === 0 ? dim('(run `cameleon models sync`)') : ''}`);
  const [agents, active] = await Promise.all([client.agents(), client.activeProfile()]);
  const found = agents.filter((a) => a.installed);
  console.log(`${bold('Agents')}     ${found.length} of ${agents.length} installed ${dim(found.map((a) => a.aliases[0] ?? a.id).join(', '))}`);
  console.log(`${bold('Profile')}    ${active ? `${active.name} ${dim(`(${active.agentId} → ${active.providerId}/${active.modelId})`)}` : dim('none active')}`);
  console.log(`${bold('Data')}       ${dim(getPaths().data)}`);
}
