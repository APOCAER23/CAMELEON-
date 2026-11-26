import { confirm, input, password, search } from '@inquirer/prompts';
import { EngineError, type ProviderView } from '@cameleon/shared';
import { connect } from '../engine-control.js';
import { bold, dim, green, isInteractive, mono, sym, table, withSpinner } from '../ui.js';
import { printSync } from './models.js';

const statusCell = (s: ProviderView['status']) =>
  s === 'connected' ? `${sym.dot} connected` : s === 'configured' ? `${sym.dot} configured ${dim('(untested)')}` : s === 'disabled' ? `${sym.warn} disabled` : s === 'error' ? `${sym.fail} error` : dim('○ not configured');

export async function listProviders(opts: { category?: string; configured?: boolean; json?: boolean }) {
  const { client } = await connect();
  let providers = await client.providers(opts.category ? { category: opts.category } : undefined);
  if (opts.configured) providers = providers.filter((p) => p.status !== 'not_configured');
  if (opts.json) return console.log(JSON.stringify(providers, null, 2));
  console.log(table(
    providers.map((p) => [mono(p.id), p.name, p.category, statusCell(p.status), String(p.credentialCount), p.modelCount ? String(p.modelCount) : dim('–')]),
    ['ID', 'NAME', 'TYPE', 'STATUS', 'KEYS', 'MODELS'],
  ));
}

export async function listCredentials(providerId?: string, json = false) {
  const { client } = await connect();
  const creds = await client.credentials(providerId);
  if (json) return console.log(JSON.stringify(creds, null, 2));
  if (!creds.length) return console.log(dim('No credentials yet. Run `cameleon provider configure`.'));
  console.log(table(
    creds.map((c) => [mono(c.providerId), c.label, c.maskedKey ?? dim('–'), c.enabled ? `${sym.dot} enabled` : `${sym.warn} disabled`, c.lastCheck ? (c.lastCheck.status === 'connected' ? `${sym.ok} ok` : `${sym.fail} failed`) : dim('untested'), c.updatedAt.slice(0, 10)]),
    ['PROVIDER', 'LABEL', 'KEY', 'STATE', 'LAST TEST', 'UPDATED'],
  ));
}

async function readStdinLine(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('--key-stdin expects the key to be piped, e.g.  echo "$KEY" | cameleon provider configure openrouter --key-stdin');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]!.trim();
}

function printIssues(e: EngineError) {
  console.error(`${sym.fail} ${e.message}`);
  for (const i of e.issues ?? []) console.error(`   ${dim(i.path.replace(/^values\./, ''))}: ${i.message}`);
}

export interface ConfigureOptions { label?: string; set?: string[]; keyStdin?: boolean; yes?: boolean; test?: boolean; force?: boolean; sync?: boolean }

export async function configureProvider(idArg: string | undefined, opts: ConfigureOptions) {
  const { client } = await connect();
  const providers = await client.providers();
  const interactive = isInteractive();

  let id = idArg;
  if (!id) {
    if (!interactive) throw new Error('Provider id required in non-interactive mode. See `cameleon provider list`.');
    id = await search<string>({
      message: 'Which provider?',
      source: (term) =>
        providers
          .filter((p) => !term || p.name.toLowerCase().includes(term.toLowerCase()) || p.id.includes(term.toLowerCase()))
          .map((p) => ({ name: `${p.name}  ${dim(`(${p.id} · ${p.category})`)}`, value: p.id, description: p.description })),
    });
  }
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider "${id}". Run \`cameleon provider list\`.`);

  console.log(`\n${bold(provider.name)}  ${dim(provider.description)}`);
  if (provider.docsUrl) console.log(dim(`Docs: ${provider.docsUrl}`));

  const existing = await client.credentials(provider.id);
  let label = opts.label;
  if (!label) {
    label = interactive ? await input({ message: 'Profile label', default: existing.length ? undefined : 'default', validate: (v) => v.trim().length > 0 || 'Required' }) : 'default';
  }
  label = label.trim();
  const current = existing.find((c) => c.label === label);

  // Non-secret values from --set key=value (secrets are NEVER accepted on the command line).
  const values: Record<string, string> = {};
  const secretKeys = new Set(provider.fields.filter((f) => f.kind === 'secret').map((f) => f.key));
  for (const kv of opts.set ?? []) {
    const i = kv.indexOf('=');
    if (i < 1) throw new Error(`Invalid --set "${kv}" (expected key=value)`);
    const k = kv.slice(0, i);
    if (secretKeys.has(k)) throw new Error(`"${k}" is a secret: never pass it as an argument. Use --key-stdin or the interactive prompt.`);
    values[k] = kv.slice(i + 1);
  }
  if (opts.keyStdin) {
    if (!secretKeys.has('apiKey')) throw new Error(`${provider.name} does not use an API key.`);
    values['apiKey'] = await readStdinLine();
  }

  for (const f of provider.fields) {
    if (f.key in values || !interactive) continue;
    const keepHint = current && (f.kind === 'secret' ? current.secretFields.includes(f.key) : f.key in current.fields);
    const message = `${f.label}${f.required ? '' : dim(' (optional)')}${keepHint ? dim(' — Enter to keep current') : ''}`;
    let answer: string;
    if (f.kind === 'secret') {
      answer = await password({ message, mask: '•', validate: (v) => (f.required && !keepHint && !v.trim() ? 'Required' : true) });
    } else {
      answer = await input({
        message, default: current?.fields[f.key] ?? f.default,
        validate: (v) => (f.required && !v.trim() ? 'Required' : true),
      });
    }
    if (answer.trim() || (!current && f.default)) values[f.key] = answer.trim();
  }

  // 1) Test BEFORE saving (the engine uses the values for this one request and stores nothing).
  if (opts.test !== false) {
    try {
      const t = await withSpinner('Testing connection…', () => client.testDraft(provider.id, { values: current && !Object.keys(values).length ? {} : values, credentialId: current?.id }));
      for (const w of t.warnings ?? []) console.log(`${sym.warn} ${w}`);
      if (t.status === 'connected') console.log(`${sym.ok} ${t.message}${t.latencyMs !== null ? dim(`  (${t.latencyMs} ms)`) : ''}`);
      else if (t.status === 'unsupported') console.log(`${sym.warn} ${t.message}`);
      else {
        console.log(`${sym.fail} ${t.message}`);
        const keep = interactive && !opts.force ? await confirm({ message: 'Save this credential anyway?', default: false }) : Boolean(opts.force);
        if (!keep) { process.exitCode = 1; console.log(dim('Nothing was saved. Use --force to save despite the failed test.')); return; }
      }
    } catch (e) {
      if (e instanceof EngineError && e.code === 'validation_error') { printIssues(e); process.exitCode = 1; return; }
      throw e;
    }
  }

  try {
    if (current) {
      if (!opts.yes && interactive && !(await confirm({ message: `Update the existing "${label}" credential?`, default: true }))) return;
      const r = await client.updateCredential(current.id, { values });
      done(provider.name, r.credential.label, r.credential.maskedKey, r.warnings, 'updated');
      await discover(client, provider.id, opts.sync);
    } else {
      const r = await client.createCredential({ providerId: provider.id, label, values });
      done(provider.name, r.credential.label, r.credential.maskedKey, r.warnings, 'saved');
      await discover(client, provider.id, opts.sync);
    }
  } catch (e) {
    if (e instanceof EngineError && e.code === 'validation_error') { printIssues(e); process.exitCode = 1; return; }
    throw e;
  }
}

function done(name: string, label: string, masked: string | null, warnings: string[], verb: string) {
  for (const w of warnings) console.log(`${sym.warn} ${w}`);
  console.log(`\n${sym.ok} ${bold(name)} credential "${label}" ${verb}${masked ? `  ${mono(masked)}` : ''}`);
  console.log(dim('  The key is stored in the secure vault and will never be displayed again.'));
}

/** The provider configuration changed → refresh its model catalog (skippable with --no-sync). */
async function discover(client: Awaited<ReturnType<typeof connect>>['client'], providerId: string, sync?: boolean) {
  if (sync === false) return;
  const res = await withSpinner('Discovering models…', () => client.syncModels({ providerId }));
  console.log();
  printSync(res);
}

export async function testProviders(id: string | undefined, opts: { label?: string }) {
  const { client } = await connect();
  const creds = (await client.credentials(id)).filter((c) => c.enabled && (!opts.label || c.label === opts.label));
  if (!creds.length) throw new Error(id ? `No enabled credential for "${id}".` : 'No enabled credentials. Run `cameleon provider configure`.');
  let failed = 0;
  for (const c of creds) {
    const t = await withSpinner(`Testing ${c.providerId} "${c.label}"…`, () => client.testCredential(c.id));
    const mark = t.status === 'connected' ? sym.ok : t.status === 'unsupported' ? sym.warn : sym.fail;
    if (t.status === 'failed') failed++;
    console.log(`${mark} ${bold(c.providerId)} ${dim(`"${c.label}"`)}  ${t.message}${t.latencyMs !== null ? dim(`  (${t.latencyMs} ms)`) : ''}`);
  }
  if (failed) process.exitCode = 1;
}

async function pickCredentials(idArg: string | undefined, label: string | undefined) {
  const { client } = await connect();
  if (!idArg) throw new Error('Provider id required.');
  const creds = (await client.credentials(idArg)).filter((c) => !label || c.label === label);
  if (!creds.length) throw new Error(label ? `No credential "${label}" for ${idArg}.` : `No credentials for ${idArg}.`);
  return { client, creds };
}

export async function removeProvider(id: string | undefined, opts: { label?: string; yes?: boolean }) {
  const { client, creds } = await pickCredentials(id, opts.label);
  if (!opts.yes) {
    if (!isInteractive()) throw new Error('Refusing to delete without --yes in non-interactive mode.');
    const ok = await confirm({ message: `Delete ${creds.length} credential(s) for ${id} (${creds.map((c) => c.label).join(', ')})? This cannot be undone.`, default: false });
    if (!ok) return;
  }
  for (const c of creds) await client.deleteCredential(c.id);
  console.log(`${sym.ok} Removed ${creds.length} credential(s) for ${green(id!)}`);
}

export async function toggleProvider(id: string | undefined, enabled: boolean, opts: { label?: string }) {
  const { client, creds } = await pickCredentials(id, opts.label);
  for (const c of creds) await client.updateCredential(c.id, { enabled });
  console.log(`${sym.ok} ${enabled ? 'Enabled' : 'Disabled'} ${creds.length} credential(s) for ${green(id!)}`);
}
