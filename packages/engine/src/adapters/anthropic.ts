import { UNKNOWN_CAPABILITIES, type CapabilityState, type ModelCapabilities } from '@cameleon/shared';
import { asArray, asObject, buildHeaders, guardedTest, positiveInt, requireEndpoint, str } from './common.js';
import { getJson } from './http.js';
import type { AdapterInput, DiscoveredModel, ProviderAdapter } from './types.js';

const supported = (v: unknown): CapabilityState => {
  const s = asObject(v)['supported'];
  return s === true ? 'supported' : s === false ? 'unsupported' : 'unknown';
};

/**
 * Anthropic Messages API (also used by custom Anthropic-compatible gateways).
 * `GET /v1/models` is paginated (`has_more` / `last_id`). When the response carries token limits or a `capabilities`
 * object they are mapped; anything not reported stays `unknown`. Streaming is a documented feature of the Messages API.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly protocol = 'anthropic' as const;

  private url(input: AdapterInput, query: string) {
    return `${requireEndpoint(input.def, input.fields, 'anthropic')}/v1/models?${query}`;
  }

  test(input: AdapterInput) {
    return guardedTest(input, async () => {
      const r = await getJson(this.url(input, 'limit=1'), buildHeaders(input));
      const data = asObject(r.json)['data'];
      if (!Array.isArray(data)) {
        throw Object.assign(new Error('The endpoint answered, but not with a model list — check the Base URL'), { name: 'Unexpected' });
      }
      return { latencyMs: r.latencyMs, httpStatus: r.status, message: 'Connected — API key accepted' };
    });
  }

  async discover(input: AdapterInput): Promise<DiscoveredModel[]> {
    const out: DiscoveredModel[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const q: string = `limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
      const r = await getJson(this.url(input, q), buildHeaders(input));
      const body = asObject(r.json);
      for (const raw of asArray(body['data'])) {
        const m = asObject(raw);
        const id = str(m['id']);
        if (!id) continue;
        const c = asObject(m['capabilities']);
        const caps: ModelCapabilities = {
          ...UNKNOWN_CAPABILITIES,
          streaming: 'supported',
          vision: supported(c['image_input']),
          structuredOutput: supported(c['structured_outputs']),
          reasoning: supported(c['thinking']),
        };
        out.push({
          modelId: id,
          displayName: str(m['display_name']) ?? id,
          description: null,
          protocol: 'anthropic',
          kind: 'chat',
          contextWindow: positiveInt(m['max_input_tokens']),
          maxOutputTokens: positiveInt(m['max_tokens']),
          capabilities: caps,
          pricing: null, // the Models API does not publish prices
        });
      }
      const last = str(body['last_id']);
      if (body['has_more'] === true && last) after = last; else break;
    }
    return out;
  }
}
