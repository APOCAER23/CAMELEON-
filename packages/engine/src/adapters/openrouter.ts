import { UNKNOWN_CAPABILITIES, type CapabilityState, type ModelKind, type ModelPricing } from '@cameleon/shared';
import { asArray, asObject, buildHeaders, guardedTest, positiveInt, requireEndpoint, str } from './common.js';
import { getJson } from './http.js';
import { OpenAICompatAdapter } from './openai-compat.js';
import type { AdapterInput, DiscoveredModel } from './types.js';

/** USD-per-token string → USD per 1M tokens. OpenRouter uses "-1" for variable-price routers: that becomes null. */
const perMTok = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Number((n * 1_000_000).toFixed(6)) : null;
};

/**
 * OpenRouter publishes rich metadata: context, pricing, modalities and the list of supported parameters.
 * Its `GET /models` is PUBLIC (it does not check the key), so the connection test uses `GET /auth/key` instead.
 */
export class OpenRouterAdapter extends OpenAICompatAdapter {
  override test(input: AdapterInput) {
    return guardedTest(input, async () => {
      const r = await getJson(`${requireEndpoint(input.def, input.fields, 'openai')}/auth/key`, buildHeaders(input));
      return { latencyMs: r.latencyMs, httpStatus: r.status, message: 'Connected — API key accepted' };
    });
  }

  protected override parse(id: string, m: Record<string, unknown>): DiscoveredModel {
    const params = m['supported_parameters'];
    const hasParams = Array.isArray(params);
    const has = (...names: string[]): CapabilityState => (hasParams ? (names.some((n) => (params as unknown[]).includes(n)) ? 'supported' : 'unsupported') : 'unknown');

    const arch = asObject(m['architecture']);
    const inMods = asArray(arch['input_modalities']);
    const outMods = asArray(arch['output_modalities']);
    const kind: ModelKind = outMods.length
      ? outMods.includes('embeddings') ? 'embedding' : outMods.includes('text') ? 'chat' : outMods.includes('image') ? 'image' : outMods.includes('audio') ? 'audio' : 'unknown'
      : 'unknown';

    const p = asObject(m['pricing']);
    const pricing: ModelPricing | null = 'prompt' in p || 'completion' in p
      ? { inputPerMTok: perMTok(p['prompt']), outputPerMTok: perMTok(p['completion']), currency: 'USD', source: 'OpenRouter /models' }
      : null;

    return {
      modelId: id,
      displayName: str(m['name']) ?? id,
      description: str(m['description']),
      protocol: 'openai',
      kind,
      contextWindow: positiveInt(m['context_length']) ?? positiveInt(asObject(m['top_provider'])['context_length']),
      maxOutputTokens: positiveInt(asObject(m['top_provider'])['max_completion_tokens']),
      capabilities: {
        ...UNKNOWN_CAPABILITIES,
        toolCalling: has('tools'),
        vision: inMods.length ? (inMods.includes('image') ? 'supported' : 'unsupported') : 'unknown',
        structuredOutput: has('structured_outputs', 'response_format'),
        reasoning: has('reasoning', 'include_reasoning'),
        streaming: 'supported', // documented: streaming is available on every OpenRouter model
      },
      pricing,
    };
  }
}
