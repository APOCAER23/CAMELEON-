import type { CapabilityState, ModelRecord, SyncResult } from '@cameleon/shared';
import { connect } from '../engine-control.js';
import { bold, capCell, dim, fmtTokens, green, mono, sym, table, withSpinner } from '../ui.js';

export interface ListOptions {
  provider?: string; tools?: boolean; vision?: boolean; reasoning?: boolean; structured?: boolean; streaming?: boolean;
  all?: boolean; limit?: string; json?: boolean;
}

const price = (m: ModelRecord) => {
  if (!m.pricing) return dim('–');
  const f = (n: number | null) => (n === null ? '?' : `$${+n.toFixed(4)}`);
  return `${f(m.pricing.inputPerMTok)} / ${f(m.pricing.outputPerMTok)}`;
};

export async function listModels(query: string | undefined, o: ListOptions) {
  const { client } = await connect();
  const caps = (['tools', 'vision', 'reasoning', 'structured', 'streaming'] as const).filter((c) => o[c]);
  const limit = Math.max(1, Number(o.limit ?? 50));
  const all = await client.models({
    providerId: o.provider, q: query, capabilities: caps.join(',') || undefined, chatOnly: o.all ? '0' : '1', limit: 2000,
  });
  if (o.json) return console.log(JSON.stringify(all, null, 2));
  if (!all.length) {
    console.log(dim('No models. Connect a provider (`cameleon provider configure`) then run `cameleon models sync`.'));
    return;
  }
  const shown = all.slice(0, limit);
  console.log(table(
    shown.map((m) => [mono(m.modelId.length > 44 ? `${m.modelId.slice(0, 43)}…` : m.modelId), m.providerId, fmtTokens(m.contextWindow), fmtTokens(m.maxOutputTokens), capCell(m.capabilities.toolCalling), capCell(m.capabilities.vision), capCell(m.capabilities.reasoning), price(m)]),
    ['MODEL', 'PROVIDER', 'CONTEXT', 'MAX OUT', 'TOOLS', 'VISION', 'REASON', 'USD / 1M TOKENS (in / out)'],
  ));
  console.log(dim(`\n${shown.length} of ${all.length} model(s). ✔ supported  ✖ unsupported  ? not reported by the provider`));
  if (all.length > shown.length) console.log(dim(`Use --limit ${all.length} or add filters (--provider, --tools, --vision …) to see more.`));
}

export function printSync(results: SyncResult[]): boolean {
  let ok = true;
  for (const r of results) {
    if (r.skipped) console.log(`${sym.warn} ${bold(r.providerName)}  ${dim('manual provider — register models with `cameleon models add`')}`);
    else if (r.ok) console.log(`${sym.ok} ${bold(r.providerName)}  ${r.count} models ${dim(`(+${r.added} / −${r.removed})`)}`);
    else { ok = false; console.log(`${sym.fail} ${bold(r.providerName)}  ${r.error}`); }
  }
  return ok;
}

export async function syncModels(providerId?: string) {
  const { client } = await connect();
  const res = await withSpinner('Discovering models…', () => client.syncModels(providerId ? { providerId } : {}));
  if (!res.length) { console.log(dim('Nothing to sync — no provider has an enabled credential yet.')); return; }
  if (!printSync(res)) process.exitCode = 1;
}

const cap = (s: CapabilityState) => (s === 'supported' ? `${sym.ok} supported` : s === 'unsupported' ? `${sym.fail} unsupported` : dim('? unknown (not reported)'));

export async function showModel(providerId: string, modelId: string) {
  const { client } = await connect();
  const m = await client.model(providerId, modelId);
  console.log(`${bold(m.displayName)}  ${mono(m.modelId)}`);
  if (m.description) console.log(dim(m.description));
  console.log(`\n${bold('Provider')}    ${m.providerId}   ${dim(`protocol ${m.protocol} · ${m.kind} · ${m.origin}`)}`);
  console.log(`${bold('Context')}     ${m.contextWindow?.toLocaleString() ?? dim('not reported')}`);
  console.log(`${bold('Max output')}  ${m.maxOutputTokens?.toLocaleString() ?? dim('not reported')}`);
  console.log(`${bold('Pricing')}     ${m.pricing ? `in $${m.pricing.inputPerMTok ?? '?'} / out $${m.pricing.outputPerMTok ?? '?'} per 1M tokens ${dim(`(${m.pricing.source})`)}` : dim('not published by the provider API')}`);
  console.log(`\n${bold('Capabilities')}`);
  console.log(`  Tool calling       ${cap(m.capabilities.toolCalling)}`);
  console.log(`  Streaming          ${cap(m.capabilities.streaming)}`);
  console.log(`  Vision             ${cap(m.capabilities.vision)}`);
  console.log(`  Structured output  ${cap(m.capabilities.structuredOutput)}`);
  console.log(`  Reasoning          ${cap(m.capabilities.reasoning)}`);
  console.log(dim(`\nLast synchronised ${m.syncedAt}`));
}

export interface AddOptions { name?: string; context?: string; maxOutput?: string; protocol?: string; tools?: string; vision?: string; reasoning?: string; structured?: string; streaming?: string }
const yn = (v?: string): CapabilityState | undefined => (v === undefined ? undefined : /^(y|yes|true|1)$/i.test(v) ? 'supported' : /^(n|no|false|0)$/i.test(v) ? 'unsupported' : (() => { throw new Error(`Expected yes/no, got "${v}"`); })());
const int = (v?: string) => (v === undefined ? undefined : Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : (() => { throw new Error(`Expected a positive integer, got "${v}"`); })());

export async function addModel(providerId: string, modelId: string, o: AddOptions) {
  const { client } = await connect();
  const capabilities = Object.fromEntries(Object.entries({
    toolCalling: yn(o.tools), vision: yn(o.vision), reasoning: yn(o.reasoning), structuredOutput: yn(o.structured), streaming: yn(o.streaming),
  }).filter(([, v]) => v !== undefined));
  const m = await client.addModel({
    providerId, modelId, displayName: o.name, protocol: o.protocol as never, contextWindow: int(o.context), maxOutputTokens: int(o.maxOutput), capabilities,
  });
  console.log(`${sym.ok} Registered ${green(m.modelId)} for ${providerId} ${dim('(manual — kept across syncs)')}`);
}

export async function removeModel(providerId: string, modelId: string) {
  const { client } = await connect();
  await client.deleteModel(providerId, modelId);
  console.log(`${sym.ok} Removed ${modelId}`);
}
