import type { ModelKind, Protocol, ProviderDefinition } from '@cameleon/shared';
import { HttpError, scrub } from './http.js';
import type { AdapterInput, TestOutcome } from './types.js';

const FORBIDDEN = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade']);

/** Auth + provider-specific headers, built from the definition. Header values never leave this process except to the provider. */
export function buildHeaders({ def, fields, secrets }: AdapterInput): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json', 'user-agent': 'cameleon/0.2' };
  const key = secrets['apiKey'];
  if (key) {
    switch (def.auth.type) {
      case 'bearer': h['authorization'] = `Bearer ${key}`; break;
      case 'x-api-key': h['x-api-key'] = key; break;
      case 'header': if (def.auth.headerName) h[def.auth.headerName.toLowerCase()] = key; break;
      default: break;
    }
  }
  for (const [k, v] of Object.entries(def.auth.extraHeaders ?? {})) h[k.toLowerCase()] = v;
  if (fields['organization']) h['openai-organization'] = fields['organization'];
  if (fields['project']) h['openai-project'] = fields['project'];
  if (secrets['customHeaders']) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(secrets['customHeaders']) as Record<string, string>)) {
        if (!FORBIDDEN.has(k.toLowerCase())) h[k.toLowerCase()] = String(v);
      }
    } catch { /* validated at save time; ignore corrupt data */ }
  }
  return h;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * Base URL for one protocol.
 * A user-entered `baseUrl` always applies to the provider's PRIMARY protocol (and to every protocol of custom
 * providers). For Ollama it is the server root, from which the OpenAI-compatible `/v1` URL is derived.
 */
export function endpointFor(def: ProviderDefinition, fields: Record<string, string>, protocol: Protocol): string | null {
  const override = fields['baseUrl'] ? trimSlash(fields['baseUrl']) : null;
  if (override) {
    if (def.id === 'ollama') return protocol === 'openai' ? `${override}/v1` : override;
    if (protocol === def.protocols[0] || def.category === 'custom') return override;
  }
  const dflt = def.endpoints[protocol];
  return dflt ? trimSlash(dflt) : null;
}

export function requireEndpoint(def: ProviderDefinition, fields: Record<string, string>, protocol: Protocol): string {
  const url = endpointFor(def, fields, protocol);
  if (!url) throw new HttpError('unexpected', `No ${protocol} endpoint configured for ${def.name} — set a Base URL`);
  return url;
}

/** Wrap an adapter test: converts thrown HttpErrors into a failed outcome with a scrubbed message. */
export async function guardedTest(input: AdapterInput, fn: () => Promise<{ latencyMs: number; message: string; httpStatus: number }>): Promise<TestOutcome> {
  try {
    const r = await fn();
    return { status: 'connected', latencyMs: r.latencyMs, httpStatus: r.httpStatus, errorKind: null, message: r.message };
  } catch (e) {
    const secrets = Object.values(input.secrets);
    if (e instanceof HttpError) {
      return { status: 'failed', latencyMs: null, httpStatus: e.httpStatus, errorKind: e.kind, message: scrub(e.message, secrets) };
    }
    return { status: 'failed', latencyMs: null, httpStatus: null, errorKind: 'unexpected', message: scrub((e as Error).message, secrets) };
  }
}

export const positiveInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Only OBVIOUS non-chat families are classified; everything else stays `unknown` rather than guessed. */
export function inferKind(id: string): ModelKind {
  const s = id.toLowerCase();
  if (/embed/.test(s)) return 'embedding';
  if (/moderation/.test(s)) return 'moderation';
  if (/whisper|(^|[-/])tts([-/]|$)|transcribe|realtime/.test(s)) return 'audio';
  if (/dall-e|gpt-image|imagen|stable-diffusion|(^|[-/])flux/.test(s)) return 'image';
  return 'unknown';
}
