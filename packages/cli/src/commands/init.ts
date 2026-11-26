import { ensureAppDirs } from '@cameleon/kit';
import { connect, getPaths } from '../engine-control.js';
import { banner, bold, dim, mono, sym } from '../ui.js';

export async function runInit() {
  const p = getPaths();
  ensureAppDirs(p);
  const { client, startedNow } = await connect();
  const s = await client.status();
  console.log(banner() + '\n');
  console.log(`${sym.ok} Directories ready  ${dim(p.data)}`);
  console.log(`${sym.ok} Engine ${startedNow ? 'started' : 'already running'}  ${dim(`v${s.engine.version}`)}`);
  console.log(`${s.vault.osProtected ? sym.ok : sym.warn} Secure vault: ${s.vault.backend}  ${dim(s.vault.detail)}`);
  console.log(`${sym.ok} ${s.counts.providersTotal} providers in the catalog`);
  console.log(`\n${bold('Next steps')}`);
  console.log(`  ${mono('cameleon provider configure')}   add an API key`);
  console.log(`  ${mono('cameleon models')}               browse discovered models`);
  console.log(`  ${mono('cameleon doctor')}               check your setup`);
}
