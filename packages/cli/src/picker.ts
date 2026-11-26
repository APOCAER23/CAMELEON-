import { search, select } from '@inquirer/prompts';
import type { AgentView, CompatEntry, EngineClient } from '@cameleon/shared';
import { dim, isInteractive } from './ui.js';

const mark = (s: CompatEntry['compat']['status']) => (s === 'compatible' ? '✔' : s === 'limited' ? '◐' : '?');

/** Choose provider + model among those the agent can use (incompatible models are hidden). */
export async function pickSelection(
  client: EngineClient, agent: AgentView, preset: { providerId?: string; modelId?: string },
): Promise<{ providerId: string; modelId: string }> {
  if (preset.providerId && preset.modelId) return { providerId: preset.providerId, modelId: preset.modelId };
  const entries = await client.compat({ agentId: agent.id, providerId: preset.providerId });
  if (!entries.length) {
    throw new Error(
      `No model is usable with ${agent.name}${preset.providerId ? ` on ${preset.providerId}` : ''} yet.\n` +
      '   → connect a provider:  cameleon provider configure\n' +
      '   → discover models:     cameleon models sync\n' +
      `   → see why:             cameleon models --provider <id>  /  cameleon models show <provider> <model>`,
    );
  }
  if (!isInteractive()) {
    throw new Error(`Non-interactive mode: pass --provider and --model (or --profile). ${entries.length} compatible model(s) available: cameleon models`);
  }

  let providerId = preset.providerId;
  if (!providerId) {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.providerId, (counts.get(e.providerId) ?? 0) + 1);
    providerId = counts.size === 1 ? [...counts.keys()][0]! : await select<string>({
      message: `Provider for ${agent.name}`,
      choices: [...counts].map(([id, n]) => ({ name: `${id}  ${dim(`${n} usable model${n > 1 ? 's' : ''}`)}`, value: id })),
    });
  }
  const mine = entries.filter((e) => e.providerId === providerId);
  const modelId = preset.modelId ?? await search<string>({
    message: `Model  ${dim('(✔ compatible · ◐ limited · ? untested)')}`,
    source: (term) => mine
      .filter((e) => !term || e.modelId.toLowerCase().includes(term.toLowerCase()) || e.displayName.toLowerCase().includes(term.toLowerCase()))
      .slice(0, 60)
      .map((e) => ({ name: `${mark(e.compat.status)} ${e.modelId}${e.contextWindow ? dim(`  ${Math.round(e.contextWindow / 1000)}k`) : ''}`, value: e.modelId, description: e.compat.reasons.map((r) => r.message).join(' ') || undefined })),
  });
  return { providerId, modelId };
}
