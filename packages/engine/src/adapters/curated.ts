import { UNKNOWN_CAPABILITIES } from '@cameleon/shared';
import type { AdapterInput, DiscoveredModel, ProviderAdapter } from './types.js';

/**
 * Providers with no model-listing endpoint (Perplexity). Their catalog is a short curated list taken from the
 * public docs; capabilities stay `unknown` and users can register others manually. Verify against the vendor docs
 * when updating — the list is data, not logic.
 */
const PERPLEXITY = ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'];

export class CuratedAdapter implements ProviderAdapter {
  readonly protocol = 'openai' as const;
  constructor(private ids: readonly string[] = PERPLEXITY) {}

  async test(_input: AdapterInput) {
    return {
      status: 'unsupported' as const, latencyMs: null, httpStatus: null, errorKind: null,
      message: 'This provider has no free endpoint to verify a key without a billable request — the key is checked on first use.',
    };
  }

  async discover(_input: AdapterInput): Promise<DiscoveredModel[]> {
    return this.ids.map((id) => ({
      modelId: id, displayName: id, description: null, protocol: 'openai' as const, kind: 'chat' as const,
      contextWindow: null, maxOutputTokens: null, capabilities: { ...UNKNOWN_CAPABILITIES }, pricing: null,
      origin: 'curated' as const,
    }));
  }
}
