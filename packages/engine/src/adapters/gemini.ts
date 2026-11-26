import { UNKNOWN_CAPABILITIES, type ModelKind } from '@cameleon/shared';
import { asArray, asObject, buildHeaders, guardedTest, positiveInt, requireEndpoint, str } from './common.js';
import { getJson } from './http.js';
import type { AdapterInput, DiscoveredModel, ProviderAdapter } from './types.js';

/** Google AI Studio native API: `GET /models` (paginated by `nextPageToken`) with token limits and supported methods. */
export class GeminiAdapter implements ProviderAdapter {
  readonly protocol = 'gemini' as const;

  private url(input: AdapterInput, query: string) {
    return `${requireEndpoint(input.def, input.fields, 'gemini')}/models?${query}`;
  }

  test(input: AdapterInput) {
    return guardedTest(input, async () => {
      const r = await getJson(this.url(input, 'pageSize=1'), buildHeaders(input));
      return { latencyMs: r.latencyMs, httpStatus: r.status, message: 'Connected — API key accepted' };
    });
  }

  async discover(input: AdapterInput): Promise<DiscoveredModel[]> {
    const out: DiscoveredModel[] = [];
    let token: string | null = null;
    for (let page = 0; page < 20; page++) {
      const q: string = `pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const r = await getJson(this.url(input, q), buildHeaders(input));
      const body = asObject(r.json);
      for (const raw of asArray(body['models'])) {
        const m = asObject(raw);
        const id = str(m['name'])?.replace(/^models\//, '');
        if (!id) continue;
        const methods = asArray(m['supportedGenerationMethods']).map(String);
        const kind: ModelKind = methods.includes('generateContent') ? 'chat'
          : methods.some((x) => /embed/i.test(x)) ? 'embedding' : methods.includes('predict') ? 'image' : 'unknown';
        out.push({
          modelId: id,
          displayName: str(m['displayName']) ?? id,
          description: str(m['description']),
          protocol: 'gemini',
          kind,
          contextWindow: positiveInt(m['inputTokenLimit']),
          maxOutputTokens: positiveInt(m['outputTokenLimit']),
          capabilities: { ...UNKNOWN_CAPABILITIES, reasoning: m['thinking'] === true ? 'supported' : 'unknown' },
          pricing: null,
        });
      }
      token = str(body['nextPageToken']);
      if (!token) break;
    }
    return out;
  }
}
