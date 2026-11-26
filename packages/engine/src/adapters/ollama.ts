import { UNKNOWN_CAPABILITIES, type ModelCapabilities, type ModelKind } from '@cameleon/shared';
import { asArray, asObject, buildHeaders, guardedTest, inferKind, positiveInt, requireEndpoint, str } from './common.js';
import { getJson, HttpError, postJson } from './http.js';
import type { AdapterInput, DiscoveredModel, ProviderAdapter } from './types.js';

/**
 * Local Ollama server. Models come from `GET /api/tags`; each one is enriched with `POST /api/show`
 * (capabilities, context length). Enrichment failures never fail the sync — those fields simply stay unknown.
 * Older Ollama versions do not report `capabilities`: tools/vision/reasoning then stay `unknown`.
 */
export class OllamaAdapter implements ProviderAdapter {
  readonly protocol = 'ollama' as const;

  test(input: AdapterInput) {
    return guardedTest(input, async () => {
      const r = await getJson(`${requireEndpoint(input.def, input.fields, 'ollama')}/api/version`, buildHeaders(input));
      const version = str(asObject(r.json)['version']);
      if (!version) throw new HttpError('unexpected', 'The server answered, but it does not look like Ollama — check the Base URL', r.status);
      return { latencyMs: r.latencyMs, httpStatus: r.status, message: `Connected — Ollama ${version}` };
    });
  }

  async discover(input: AdapterInput): Promise<DiscoveredModel[]> {
    const base = requireEndpoint(input.def, input.fields, 'ollama');
    const headers = buildHeaders(input);
    const tags = await getJson(`${base}/api/tags`, headers);
    const names = asArray(asObject(tags.json)['models']).map((m) => asObject(m)).filter((m) => str(m['name']));

    const out: DiscoveredModel[] = [];
    let next = 0;
    const worker = async () => {
      while (next < names.length) {
        const m = names[next++]!;
        const name = str(m['name'])!;
        let show: Record<string, unknown> = {};
        try { show = asObject((await postJson(`${base}/api/show`, headers, { model: name })).json); } catch { /* enrichment is optional */ }
        out.push(this.build(name, m, show));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, names.length) }, worker));
    return out.sort((a, b) => a.modelId.localeCompare(b.modelId));
  }

  private build(name: string, tag: Record<string, unknown>, show: Record<string, unknown>): DiscoveredModel {
    const capList = Array.isArray(show['capabilities']) ? (show['capabilities'] as unknown[]).map(String) : null;
    const caps: ModelCapabilities = { ...UNKNOWN_CAPABILITIES, streaming: 'supported' };
    let kind: ModelKind = inferKind(name);
    if (capList) {
      caps.toolCalling = capList.includes('tools') ? 'supported' : 'unsupported';
      caps.vision = capList.includes('vision') ? 'supported' : 'unsupported';
      caps.reasoning = capList.includes('thinking') ? 'supported' : 'unsupported';
      if (capList.includes('completion')) kind = 'chat';
      else if (capList.includes('embedding')) kind = 'embedding';
    }
    const info = asObject(show['model_info']);
    const ctxKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
    const d = asObject(tag['details']);
    const description = [str(d['family']), str(d['parameter_size']), str(d['quantization_level'])].filter(Boolean).join(' · ') || null;
    return {
      modelId: name, displayName: name, description, protocol: 'ollama', kind,
      contextWindow: ctxKey ? positiveInt(info[ctxKey]) : null,
      maxOutputTokens: null, capabilities: caps, pricing: null,
    };
  }
}
