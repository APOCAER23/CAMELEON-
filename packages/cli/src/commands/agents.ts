import { connect } from '../engine-control.js';
import { bold, dim, mono, sym, table, withSpinner } from '../ui.js';

export async function listAgents(o: { json?: boolean; refresh?: boolean }) {
  const { client } = await connect();
  const agents = await withSpinner('Detecting agents…', () => client.agents(Boolean(o.refresh)));
  if (o.json) return console.log(JSON.stringify(agents, null, 2));
  console.log(table(
    agents.map((a) => [mono(a.aliases[0] ?? a.id), a.name, a.installed ? `${sym.dot} installed` : dim('○ not installed'), a.version ?? dim('–'), a.path ?? dim('–')]),
    ['ID', 'AGENT', 'STATUS', 'VERSION', 'PATH'],
  ));
  const missing = agents.filter((a) => !a.installed);
  if (missing.length) {
    console.log(`\n${bold('Not installed')} ${dim('(CAMELEON never installs software on its own)')}`);
    for (const a of missing) console.log(`  ${a.name}: ${mono(a.install.commands[0] ?? a.install.url)}  ${dim(a.install.url)}`);
  }
}
