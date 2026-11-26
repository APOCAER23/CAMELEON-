import { UNKNOWN_CAPABILITIES, type ModelCapabilities, type CapabilityState } from '@cameleon/shared';
import { asArray, asObject, buildHeaders, guardedTest, inferKind, positiveInt, requireEndpoint, str } from './common.js';
import { getJson, HttpError } from './http.js';
import type { AdapterInput, DiscoveredModel, ProviderAdapter } from './types.js';

const flag = (v: unknown): CapabilityState => (v === true ? 'supported' : v === false ? 'unsupported' : 'unknown');

/**
 * Generic adapter for the very common `GET /models` → `{ data: [{ id, … }] }` shape.
 * Used by OpenAI, DeepSeek, Groq, Mistral, Together, Fireworks, Cerebras, xAI, LM Studio and custom gateways.
 *
 * The OpenAI spec itself only guarantees `id`. Richer fields that some vendors add (context length, Mistral's
 * `capabilities`, …) are read OPPORTUNISTICALLY — a value is only used when present and well-formed, otherwise
 * the property stays null / `unknown`.
 */
export class OpenAICompatAdapter implements ProviderAdapter {
  readonly protocol = 'openai' as const;

  protected modelsUrl(input: AdapterInput): string {
    return requireEndpoint(input.def, input.fields, 'openai') + (input.def.discovery.path ?? '/models');
  }

  protected list(json: unknown): unknown[] {
    const o = asObject(json);
    return Array.isArray(json) ? json : asArray(o['data']);
  }

  test(input: AdapterInput) {
    return guardedTest(input, async () => {
      const r = await getJson(this.modelsUrl(input), buildHeaders(input));
      const items = this.list(r.json);
      if (!items.length && !('data' in asObject(r.json))) {
        throw new HttpError('unexpected', 'The endpoint answered, but not with a model list — check the Base URL', r.status);
      }
      return { latencyMs: r.latencyMs, httpStatus: r.status, message: `Connected — ${items.length} model${items.length === 1 ? '' : 's'} available` };
    });
  }

  async discover(input: AdapterInput): Promise<DiscoveredModel[]> {
    const r = await getJson(this.modelsUrl(input), buildHeaders(input));
    const out = new Map<string, DiscoveredModel>();
    for (const raw of this.list(r.json)) {
      const m = asObject(raw);
      const id = str(m['id']);
      if (!id || out.has(id)) continue;
      out.set(id, this.parse(id, m));
    }
    return [...out.values()];
  }

  protected parse(id: string, m: Record<string, unknown>): DiscoveredModel {
    const caps: ModelCapabilities = { ...UNKNOWN_CAPABILITIES };
    const c = asObject(m['capabilities']); // Mistral-style
    if ('function_calling' in c) caps.toolCalling = flag(c['function_calling']);
    if ('vision' in c) caps.vision = flag(c['vision']);
    return {
      modelId: id,
      displayName: str(m['name']) ?? id,
      description: str(m['description']),
      protocol: 'openai',
      kind: inferKind(id),
      contextWindow: positiveInt(m['context_length']) ?? positiveInt(m['context_window']) ?? positiveInt(m['max_context_length']) ?? positiveInt(m['max_model_len']),
      maxOutputTokens: positiveInt(m['max_completion_tokens']) ?? positiveInt(m['max_output_tokens']),
      capabilities: caps,
      pricing: null,
    };
  }
}
