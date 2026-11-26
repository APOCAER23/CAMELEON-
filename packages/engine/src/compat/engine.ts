import type { CompatReason, CompatResult, ModelRecord, ProviderDefinition } from '@cameleon/shared';
import type { AgentSpec } from '../agents/spec.js';
import { endpointFor } from '../adapters/common.js';

export interface CredentialState {
  enabled: boolean;
  hasKey: boolean;
  fields: Record<string, string>;
}

const NON_CHAT = new Set(['embedding', 'image', 'audio', 'moderation']);

const R = (level: CompatReason['level'], code: string, message: string): CompatReason => ({ level, code, message });

/**
 * Can this agent use this model through this provider?
 *   incompatible — at least one hard blocker (wrong protocol, non-chat model, tools/streaming reported unsupported, no usable key)
 *   untested     — nothing blocks it, but a requirement could not be verified (e.g. tool support not reported)
 *   limited      — works, with caveats
 *   compatible   — every requirement is verified or vendor-supported
 * "Unknown" is never treated as "supported".
 */
export function evaluate(agent: AgentSpec, def: ProviderDefinition, model: ModelRecord, cred: CredentialState | null): CompatResult {
  const reasons: CompatReason[] = [];
  const fields = cred?.fields ?? {};
  let untested = false;

  const protocol = agent.protocols.find((p) => def.protocols.includes(p) && endpointFor(def, fields, p)) ?? null;
  const baseUrl = protocol ? endpointFor(def, fields, protocol) : null;
  if (!protocol) {
    reasons.push(R('blocker', 'protocol',
      `${def.name} exposes ${def.protocols.join(' / ')}; ${agent.name} needs ${agent.protocols.join(' or ')}. ${agent.protocols.includes('anthropic') && !agent.protocols.includes('openai') ? 'A translation proxy would be required.' : 'Set a Base URL if your gateway offers it.'}`));
  }

  if (!cred) reasons.push(R('blocker', 'no_credential', `No credential configured for ${def.name}.`));
  else if (!cred.enabled) reasons.push(R('blocker', 'credential_disabled', `The ${def.name} credential is disabled.`));
  else if (!cred.hasKey && def.fields.some((f) => f.key === 'apiKey' && f.required)) reasons.push(R('blocker', 'no_key', `The ${def.name} credential has no API key.`));

  if (NON_CHAT.has(model.kind)) reasons.push(R('blocker', 'model_kind', `This is a ${model.kind} model, not a chat/coding model.`));

  const firstParty = agent.firstPartyProviders.includes('*') || agent.firstPartyProviders.includes(def.id);
  const caps = model.capabilities;

  if (agent.requiresTools) {
    if (caps.toolCalling === 'unsupported') reasons.push(R('blocker', 'no_tools', `${agent.name} needs tool calling, which this model is reported not to support.`));
    else if (caps.toolCalling === 'unknown' && !firstParty) {
      untested = true;
      reasons.push(R('info', 'tools_unknown', `${def.name} does not report whether this model supports tool calling, which ${agent.name} requires.`));
    }
  }
  if (agent.requiresStreaming) {
    if (caps.streaming === 'unsupported') reasons.push(R('blocker', 'no_streaming', `${agent.name} needs streaming, which this model is reported not to support.`));
    else if (caps.streaming === 'unknown') reasons.push(R('info', 'streaming_unknown', 'Streaming support is not reported by the provider.'));
  }
  if (model.contextWindow !== null && model.contextWindow < agent.recommendedContext) {
    reasons.push(R('limitation', 'small_context', `Context window is ${model.contextWindow.toLocaleString()} tokens; ${agent.name} works best with at least ${agent.recommendedContext.toLocaleString()} (advisory).`));
  }

  if (protocol) {
    const a = agent.assess(def, protocol);
    reasons.push(...a.reasons);
    if (a.untested) untested = true;
  }

  const hasBlocker = reasons.some((r) => r.level === 'blocker');
  const status = hasBlocker ? 'incompatible' : untested ? 'untested' : reasons.some((r) => r.level === 'limitation') ? 'limited' : 'compatible';
  return { status, protocol, baseUrl, reasons };
}
