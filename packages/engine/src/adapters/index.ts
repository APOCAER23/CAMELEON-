import type { ProviderDefinition } from '@cameleon/shared';
import { AnthropicAdapter } from './anthropic.js';
import { CuratedAdapter } from './curated.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatAdapter } from './openai-compat.js';
import { OpenRouterAdapter } from './openrouter.js';
import type { ProviderAdapter } from './types.js';

export * from './types.js';
export * from './http.js';
export * from './common.js';

/**
 * Adapter selection: provider-specific adapters by id first, then by the protocol the definition declares.
 * User-supplied providers (providers.d / custom) get the generic adapter of their protocol — no code needed.
 */
export function adapterFor(def: ProviderDefinition): ProviderAdapter {
  switch (def.id) {
    case 'openrouter': return new OpenRouterAdapter();
    case 'ollama': return new OllamaAdapter();
    case 'gemini': return new GeminiAdapter();
    case 'perplexity': return new CuratedAdapter();
    default: break;
  }
  if (def.discovery.kind === 'curated') return new CuratedAdapter([]);
  const protocol = def.discovery.protocol ?? def.protocols[0];
  switch (protocol) {
    case 'anthropic': return new AnthropicAdapter();
    case 'gemini': return new GeminiAdapter();
    case 'ollama': return new OllamaAdapter();
    default: return new OpenAICompatAdapter();
  }
}
