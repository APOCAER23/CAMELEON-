import { z } from 'zod';

export const APP_NAME = 'cameleon';
export const APP_VERSION = '0.4.0';

/* ───────────── Provider catalog ───────────── */

export const ProviderCategory = z.enum(['direct', 'aggregator', 'local', 'custom']);
export type ProviderCategory = z.infer<typeof ProviderCategory>;

export const Protocol = z.enum(['openai', 'anthropic', 'gemini', 'ollama']);
export type Protocol = z.infer<typeof Protocol>;

export const AuthType = z.enum(['bearer', 'x-api-key', 'query-key', 'header', 'none']);
export type AuthType = z.infer<typeof AuthType>;

export const FieldKind = z.enum(['secret', 'text', 'url', 'select']);
export type FieldKind = z.infer<typeof FieldKind>;

const fieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/);

export const ProviderField = z.object({
  key: fieldKey,
  label: z.string().min(1).max(80),
  kind: FieldKind,
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  help: z.string().max(300).optional(),
  options: z.array(z.string().max(80)).max(50).optional(),
  default: z.string().max(500).optional(),
});
export type ProviderField = z.infer<typeof ProviderField>;

export const ProviderDefinition = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  category: ProviderCategory,
  protocols: z.array(Protocol).min(1),
  /** Default base URL per protocol. A credential may override it through a `baseUrl` field. */
  endpoints: z.object({
    openai: z.string().url().optional(),
    anthropic: z.string().url().optional(),
    gemini: z.string().url().optional(),
    ollama: z.string().url().optional(),
  }).default({}),
  auth: z.object({
    type: AuthType,
    headerName: z.string().max(80).optional(),
    extraHeaders: z.record(z.string().max(200)).optional(),
  }),
  fields: z.array(ProviderField).max(20),
  /** How models are obtained (implemented by provider adapters in Phase 2). */
  discovery: z.object({
    kind: z.enum(['endpoint', 'curated', 'manual']),
    path: z.string().max(200).optional(),
    protocol: Protocol.optional(),
  }),
  /** Expected key prefix — used for a soft format warning only. */
  keyPrefix: z.string().max(20).optional(),
  docsUrl: z.string().url().optional(),
});
export type ProviderDefinition = z.infer<typeof ProviderDefinition>;

export const ConnectionStatus = z.enum(['not_configured', 'configured', 'disabled', 'connected', 'error']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const ProviderView = ProviderDefinition.extend({
  source: z.enum(['builtin', 'file', 'custom']),
  status: ConnectionStatus,
  credentialCount: z.number().int(),
  modelCount: z.number().int(),
});
export type ProviderView = z.infer<typeof ProviderView>;

/* ───────────── Credentials ───────────── */

const fieldValues = z.record(fieldKey, z.string().max(4096));

export const CredentialSummary = z.object({
  id: z.string(),
  providerId: z.string(),
  label: z.string(),
  /** Masked hint only (e.g. `sk-or-…a1b2`). The real secret never leaves the vault. */
  maskedKey: z.string().nullable(),
  /** Non-secret field values (base URL, organization…). */
  fields: z.record(z.string()),
  /** Keys of secret fields that currently hold a value. */
  secretFields: z.array(z.string()),
  enabled: z.boolean(),
  /** Result of the most recent live connection test (cleared whenever the credential changes). */
  lastCheck: z.object({
    status: z.enum(['connected', 'failed']),
    checkedAt: z.string(),
    latencyMs: z.number().nullable(),
    message: z.string(),
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CredentialSummary = z.infer<typeof CredentialSummary>;

export const CreateCredentialInput = z.object({
  providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  label: z.string().trim().min(1).max(60).default('default'),
  /** All field values keyed by field key — the engine routes secret fields to the vault. */
  values: fieldValues,
});
export type CreateCredentialInput = z.infer<typeof CreateCredentialInput>;

export const UpdateCredentialInput = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  /** Only provided keys change. An empty string clears an optional field. */
  values: fieldValues.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialInput>;

export const CredentialResult = z.object({ credential: CredentialSummary, warnings: z.array(z.string()) });
export type CredentialResult = z.infer<typeof CredentialResult>;

/* ───────────── Engine status / activity ───────────── */

export const StatusResponse = z.object({
  engine: z.object({ version: z.string(), pid: z.number(), startedAt: z.string(), uptimeSec: z.number() }),
  vault: z.object({ backend: z.enum(['os-keychain', 'encrypted-file']), osProtected: z.boolean(), detail: z.string() }),
  database: z.object({ path: z.string(), schemaVersion: z.number() }),
  counts: z.object({
    providersTotal: z.number(), providersConfigured: z.number(), providersConnected: z.number(), credentials: z.number(), models: z.number(),
  }),
  host: z.object({ platform: z.string(), node: z.string() }),
  catalog: z.object({ providers: z.number(), userFiles: z.number(), invalidFiles: z.array(z.string()) }),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

export const ActivityEntry = z.object({
  id: z.number(),
  ts: z.string(),
  kind: z.string(),
  providerId: z.string().nullable(),
  message: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), issues: z.array(z.object({ path: z.string(), message: z.string() })).optional() }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ───────────── Phase 2: connection tests & model registry ───────────── */

/** Three states only — a capability is never guessed. */
export const CapabilityState = z.enum(['supported', 'unsupported', 'unknown']);
export type CapabilityState = z.infer<typeof CapabilityState>;

export const ModelCapabilities = z.object({
  toolCalling: CapabilityState,
  streaming: CapabilityState,
  vision: CapabilityState,
  structuredOutput: CapabilityState,
  reasoning: CapabilityState,
});
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;
export const UNKNOWN_CAPABILITIES: ModelCapabilities = {
  toolCalling: 'unknown', streaming: 'unknown', vision: 'unknown', structuredOutput: 'unknown', reasoning: 'unknown',
};

/** `kind` is reported by the provider when possible, otherwise inferred from the id (only for obvious cases). */
export const ModelKind = z.enum(['chat', 'embedding', 'image', 'audio', 'moderation', 'unknown']);
export type ModelKind = z.infer<typeof ModelKind>;

export const ModelPricing = z.object({
  /** USD per 1M tokens, exactly as published by the provider API. */
  inputPerMTok: z.number().nullable(),
  outputPerMTok: z.number().nullable(),
  currency: z.literal('USD'),
  source: z.string(),
});
export type ModelPricing = z.infer<typeof ModelPricing>;

export const ModelRecord = z.object({
  providerId: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  protocol: Protocol,
  kind: ModelKind,
  contextWindow: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  capabilities: ModelCapabilities,
  pricing: ModelPricing.nullable(),
  status: z.enum(['available', 'deprecated', 'unknown']),
  origin: z.enum(['discovered', 'curated', 'manual']),
  syncedAt: z.string(),
});
export type ModelRecord = z.infer<typeof ModelRecord>;

export const CapabilityFilter = z.enum(['tools', 'streaming', 'vision', 'structured', 'reasoning']);
export type CapabilityFilter = z.infer<typeof CapabilityFilter>;

export const ModelQuery = z.object({
  providerId: z.string().max(60).optional(),
  q: z.string().max(80).optional(),
  /** Comma-separated capability names that must be `supported`. */
  capabilities: z.string().max(100).optional(),
  kind: ModelKind.optional(),
  /** Hide embeddings / image / audio / moderation models. */
  chatOnly: z.enum(['1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ModelQuery = z.input<typeof ModelQuery>;

export const ManualModelInput = z.object({
  providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(120).optional(),
  protocol: Protocol.optional(),
  kind: ModelKind.optional(),
  contextWindow: z.number().int().positive().max(100_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(100_000_000).optional(),
  capabilities: ModelCapabilities.partial().optional(),
});
export type ManualModelInput = z.input<typeof ManualModelInput>;

export const TestResult = z.object({
  /** `unsupported`: the provider has no free, non-billable endpoint to test against. */
  status: z.enum(['connected', 'failed', 'unsupported']),
  latencyMs: z.number().nullable(),
  httpStatus: z.number().nullable(),
  errorKind: z.enum(['auth', 'network', 'timeout', 'rate_limited', 'server', 'not_found', 'redirect', 'unexpected']).nullable(),
  message: z.string(),
  checkedAt: z.string(),
  /** Non-blocking notes about the submitted values (e.g. unexpected key prefix). Draft tests only. */
  warnings: z.array(z.string()).optional(),
});
export type TestResult = z.infer<typeof TestResult>;

/** Test credentials BEFORE saving them. Secrets in `values` are used for this one request and never stored. */
export const TestDraftInput = z.object({
  values: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), z.string().max(4096)),
  /** Existing credential whose stored (secret) values complete the draft. */
  credentialId: z.string().max(80).optional(),
});
export type TestDraftInput = z.input<typeof TestDraftInput>;

export const SyncInput = z.object({ providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/).optional() });
export type SyncInput = z.input<typeof SyncInput>;

export const SyncResult = z.object({
  providerId: z.string(),
  providerName: z.string(),
  ok: z.boolean(),
  /** true when nothing was fetched on purpose (manual-registration provider). */
  skipped: z.boolean(),
  count: z.number(),
  added: z.number(),
  removed: z.number(),
  error: z.string().nullable(),
  syncedAt: z.string(),
});
export type SyncResult = z.infer<typeof SyncResult>;

/* ───────────── Phase 3: agents, compatibility, launcher ───────────── */

const agentId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/);

export const CompatStatus = z.enum(['compatible', 'limited', 'untested', 'incompatible']);
export type CompatStatus = z.infer<typeof CompatStatus>;

export const CompatReason = z.object({
  /** blocker → incompatible · limitation → works with caveats · info → context only */
  level: z.enum(['blocker', 'limitation', 'info']),
  code: z.string(),
  message: z.string(),
});
export type CompatReason = z.infer<typeof CompatReason>;

export const CompatResult = z.object({
  status: CompatStatus,
  /** Protocol the agent would use to talk to the provider. */
  protocol: Protocol.nullable(),
  baseUrl: z.string().nullable(),
  reasons: z.array(CompatReason),
});
export type CompatResult = z.infer<typeof CompatResult>;

export const AgentView = z.object({
  id: agentId,
  aliases: z.array(z.string()),
  name: z.string(),
  description: z.string(),
  installed: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  supportedOS: z.array(z.string()),
  osSupported: z.boolean(),
  osNote: z.string().nullable(),
  protocols: z.array(Protocol),
  configFormat: z.string(),
  modelSelection: z.string(),
  envRequirements: z.array(z.string()),
  restore: z.string(),
  docsUrl: z.string(),
  install: z.object({ summary: z.string(), commands: z.array(z.string()), url: z.string() }),
  notes: z.array(z.string()),
  checkedAt: z.string(),
  custom: z.boolean().optional(),
});
export type AgentView = z.infer<typeof AgentView>;

export const CustomAgentInput = z.object({
  id: agentId.optional(),
  name: z.string().trim().min(1).max(60),
  binary: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  description: z.string().trim().max(400).default(''),
  protocols: z.array(Protocol).min(1).default(['openai', 'anthropic']),
  modelFlag: z.string().trim().max(40).default(''),
  extraArgs: z.array(z.string().max(200)).max(20).default([]),
  envTemplate: z.record(z.string().trim().min(1).max(80), z.string().max(500)).default({}),
});
export type CustomAgentInput = z.infer<typeof CustomAgentInput>;

export const CompatEntry = z.object({
  providerId: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  contextWindow: z.number().nullable(),
  compat: CompatResult,
});
export type CompatEntry = z.infer<typeof CompatEntry>;

export const CompatQuery = z.object({
  agentId,
  providerId: z.string().max(60).optional(),
  q: z.string().max(80).optional(),
  /** Comma-separated statuses to keep (default: everything except incompatible). */
  status: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});
export type CompatQuery = z.input<typeof CompatQuery>;

export const AgentCompat = z.object({ agentId, agentName: z.string(), compat: CompatResult });
export type AgentCompat = z.infer<typeof AgentCompat>;

const arg = z.string().max(500).refine((s) => !s.includes('\u0000'), 'No NUL characters');
export const LaunchRequest = z.object({
  agentId,
  providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  modelId: z.string().trim().min(1).max(200),
  credentialLabel: z.string().max(60).optional(),
  profileId: z.string().max(80).optional(),
  /** Extra arguments passed to the agent verbatim (as an argv array — never through a shell). */
  extraArgs: z.array(arg).max(50).default([]),
  /** Launch even when the model is reported incompatible. */
  force: z.boolean().default(false),
  /** Route API requests through CAMELEON's local metering proxy to record per-model token usage. */
  meter: z.boolean().optional(),
});
export type LaunchRequest = z.input<typeof LaunchRequest>;

export const UsageRange = z.enum(['7d', '30d', 'all']);
export type UsageRange = z.infer<typeof UsageRange>;

export const TokenUsageTotals = z.object({
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  avgLatencyMs: z.number(),
});
export type TokenUsageTotals = z.infer<typeof TokenUsageTotals>;

export const ModelUsageRow = z.object({
  providerId: z.string(),
  providerName: z.string(),
  modelId: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  avgLatencyMs: z.number(),
  lastUsedAt: z.string(),
});
export type ModelUsageRow = z.infer<typeof ModelUsageRow>;

export const AgentUsageRow = z.object({
  agentId: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});
export type AgentUsageRow = z.infer<typeof AgentUsageRow>;

export const RecentUsageRow = z.object({
  id: z.string(),
  agentId: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  protocol: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  latencyMs: z.number(),
  statusCode: z.number(),
  createdAt: z.string(),
});
export type RecentUsageRow = z.infer<typeof RecentUsageRow>;

export const UsageSummary = z.object({
  range: UsageRange,
  totals: TokenUsageTotals,
  byModel: z.array(ModelUsageRow),
  byAgent: z.array(AgentUsageRow),
  recent: z.array(RecentUsageRow),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const LaunchPlan = z.object({
  launchId: z.string().nullable(),
  agentId,
  agentName: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  /** Variables to set for the agent process (values of `secretEnvKeys` are masked in inspect mode). */
  env: z.record(z.string()),
  secretEnvKeys: z.array(z.string()),
  /** Variables to remove from the inherited environment so they cannot override the selection. */
  unsetEnv: z.array(z.string()),
  /** Temporary files to create (0600) before launch and delete after exit. `{{file:key}}` in env/args = its path. */
  files: z.array(z.object({ key: z.string(), filename: z.string(), content: z.string() })),
  notes: z.array(z.string()),
  summary: z.object({
    providerId: z.string(), providerName: z.string(), modelId: z.string(), protocol: Protocol,
    baseUrl: z.string(), credentialLabel: z.string(),
  }),
  compat: CompatResult,
  agentInstalled: z.boolean(),
  /** true when secret values were replaced by masked hints (inspect). */
  masked: z.boolean(),
});
export type LaunchPlan = z.infer<typeof LaunchPlan>;

export const FinishLaunchInput = z.object({ exitCode: z.number().int().nullable(), signal: z.string().max(20).nullable().optional() });
export type FinishLaunchInput = z.input<typeof FinishLaunchInput>;

export const LaunchRecord = z.object({
  id: z.string(), agentId: z.string(), providerId: z.string(), modelId: z.string(), profileId: z.string().nullable(),
  startedAt: z.string(), endedAt: z.string().nullable(), exitCode: z.number().nullable(), signal: z.string().nullable(),
});
export type LaunchRecord = z.infer<typeof LaunchRecord>;

/* ───────────── Phase 4: profiles, diagnostics ───────────── */

export const ProfileInput = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/, 'Letters, digits, spaces, . _ - (max 60)'),
  agentId,
  providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  modelId: z.string().trim().min(1).max(200),
  credentialLabel: z.string().trim().max(60).nullable().optional(),
  launchArgs: z.array(arg).max(50).default([]),
  /** Informational association with a project folder (automatic detection arrives in Phase 5). */
  projectPath: z.string().trim().max(500).nullable().optional(),
});
export type ProfileInput = z.input<typeof ProfileInput>;

export const ProfileView = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string(),
  providerId: z.string(),
  providerName: z.string().nullable(),
  modelId: z.string(),
  credentialLabel: z.string().nullable(),
  launchArgs: z.array(z.string()),
  projectPath: z.string().nullable(),
  active: z.boolean(),
  compat: CompatResult,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const DiagnosticCheck = z.object({
  level: z.enum(['ok', 'warn', 'fail']),
  title: z.string(),
  detail: z.string().nullable(),
  fix: z.string().nullable(),
});
export type DiagnosticCheck = z.infer<typeof DiagnosticCheck>;
