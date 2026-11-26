import { z } from 'zod';
import {
  AgentCompat, AgentView, CompatEntry, CompatQuery, CustomAgentInput, DiagnosticCheck, FinishLaunchInput, LaunchPlan, LaunchRecord, LaunchRequest, ProfileInput, ProfileView,
  ActivityEntry, ApiError, CreateCredentialInput, CredentialResult, CredentialSummary, ManualModelInput, ModelQuery, ModelRecord,
  ProviderDefinition, ProviderView, StatusResponse, SyncInput, SyncResult, TestDraftInput, TestResult, UpdateCredentialInput, UsageSummary, type UsageRange,
} from './schemas.js';

export interface EngineConnection {
  host: string;
  port: number;
  token: string;
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Typed client for the local engine API. Works in Node and Electron's main process.
 * Every response is validated with Zod so a mismatching engine version fails loudly.
 */
export function createEngineClient(conn: EngineConnection, fetchImpl: typeof fetch = fetch) {
  const base = `http://${conn.host.includes(':') ? `[${conn.host}]` : conn.host}:${conn.port}`;

  async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S | null, body?: unknown): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: {
          authorization: `Bearer ${conn.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new EngineError(`Engine unreachable: ${(e as Error).message}`, 'engine_unreachable', 0);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const parsed = ApiError.safeParse(json);
      if (parsed.success) throw new EngineError(parsed.data.error.message, parsed.data.error.code, res.status, parsed.data.error.issues);
      throw new EngineError(`Engine returned HTTP ${res.status}`, 'http_error', res.status);
    }
    return (schema ? schema.parse(json) : null) as z.infer<S>;
  }

  return {
    request,
    health: () => request('GET', '/health', z.object({ ok: z.literal(true), service: z.string(), version: z.string() })),
    status: () => request('GET', '/v1/status', StatusResponse),
    providers: (q?: { category?: string; q?: string }) => {
      const qs = new URLSearchParams(Object.entries(q ?? {}).filter(([, v]) => v) as [string, string][]).toString();
      return request('GET', `/v1/providers${qs ? `?${qs}` : ''}`, z.array(ProviderView));
    },
    credentials: (providerId?: string) =>
      request('GET', `/v1/credentials${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ''}`, z.array(CredentialSummary)),
    createCredential: (input: z.input<typeof CreateCredentialInput>) => request('POST', '/v1/credentials', CredentialResult, input),
    updateCredential: (id: string, input: z.input<typeof UpdateCredentialInput>) =>
      request('PATCH', `/v1/credentials/${encodeURIComponent(id)}`, CredentialResult, input),
    deleteCredential: (id: string) => request('DELETE', `/v1/credentials/${encodeURIComponent(id)}`, z.object({ deleted: z.literal(true) })),
    createCustomProvider: (def: z.input<typeof ProviderDefinition>) => request('POST', '/v1/custom-providers', ProviderView, def),
    deleteCustomProvider: (id: string) => request('DELETE', `/v1/custom-providers/${encodeURIComponent(id)}`, z.object({ deleted: z.literal(true) })),
    activity: (limit = 50) => request('GET', `/v1/activity?limit=${limit}`, z.array(ActivityEntry)),
    testDraft: (providerId: string, input: z.input<typeof TestDraftInput>) =>
      request('POST', `/v1/providers/${encodeURIComponent(providerId)}/test`, TestResult, input),
    testCredential: (id: string) => request('POST', `/v1/credentials/${encodeURIComponent(id)}/test`, TestResult, {}),
    syncModels: (input: z.input<typeof SyncInput> = {}) => request('POST', '/v1/models/sync', z.array(SyncResult), input),
    models: (q: z.input<typeof ModelQuery> = {}) => {
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]): [string, string] => [k, String(v)])).toString();
      return request('GET', `/v1/models${qs ? `?${qs}` : ''}`, z.array(ModelRecord));
    },
    model: (providerId: string, modelId: string) =>
      request('GET', `/v1/models/detail?${new URLSearchParams({ providerId, modelId })}`, ModelRecord),
    addModel: (input: z.input<typeof ManualModelInput>) => request('POST', '/v1/models', ModelRecord, input),
    deleteModel: (providerId: string, modelId: string) =>
      request('DELETE', `/v1/models?${new URLSearchParams({ providerId, modelId })}`, z.object({ deleted: z.literal(true) })),
    agents: (refresh = false) => request('GET', `/v1/agents${refresh ? '?refresh=1' : ''}`, z.array(AgentView)),
    createCustomAgent: (input: z.input<typeof CustomAgentInput>) => request('POST', '/v1/custom-agents', AgentView, input),
    deleteCustomAgent: (id: string) => request('DELETE', `/v1/custom-agents/${encodeURIComponent(id)}`, z.object({ deleted: z.literal(true) })),
    compat: (q: z.input<typeof CompatQuery>) => {
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]): [string, string] => [k, String(v)])).toString();
      return request('GET', `/v1/compat?${qs}`, z.array(CompatEntry));
    },
    modelCompat: (providerId: string, modelId: string) =>
      request('GET', `/v1/models/compat?${new URLSearchParams({ providerId, modelId })}`, z.array(AgentCompat)),
    /** Secrets masked — safe for display. */
    inspectLaunch: (input: z.input<typeof LaunchRequest>) => request('POST', '/v1/launch/inspect', LaunchPlan, input),
    /** Returns REAL secrets in `env` — only the CLI launcher uses this; it is not reachable from the desktop UI. */
    prepareLaunch: (input: z.input<typeof LaunchRequest>) => request('POST', '/v1/launch/prepare', LaunchPlan, input),
    finishLaunch: (id: string, input: z.input<typeof FinishLaunchInput>) =>
      request('POST', `/v1/launch/${encodeURIComponent(id)}/finish`, z.object({ ok: z.literal(true) }), input),
    launches: (limit = 20) => request('GET', `/v1/launches?limit=${limit}`, z.array(LaunchRecord)),
    profiles: () => request('GET', '/v1/profiles', z.array(ProfileView)),
    activeProfile: () => request('GET', '/v1/profiles/active', ProfileView.nullable()),
    createProfile: (input: z.input<typeof ProfileInput>) => request('POST', '/v1/profiles', ProfileView, input),
    updateProfile: (id: string, input: Partial<z.input<typeof ProfileInput>>) => request('PATCH', `/v1/profiles/${encodeURIComponent(id)}`, ProfileView, input),
    deleteProfile: (id: string) => request('DELETE', `/v1/profiles/${encodeURIComponent(id)}`, z.object({ deleted: z.literal(true) })),
    activateProfile: (id: string | null) => request('POST', '/v1/profiles/activate', z.object({ ok: z.literal(true) }), { id }),
    clearModelCache: () => request('DELETE', '/v1/models/cache', z.object({ removed: z.number() })),
    diagnostics: () => request('GET', '/v1/diagnostics', z.array(DiagnosticCheck)),
    usage: (range: UsageRange = '7d') => request('GET', `/v1/usage?range=${encodeURIComponent(range)}`, UsageSummary),
    clearUsage: () => request('DELETE', '/v1/usage', z.object({ deleted: z.number() })),
    shutdown: () => request('POST', '/v1/engine/shutdown', z.object({ ok: z.literal(true) }), {}),
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
