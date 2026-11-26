import type { ModelRecord, Protocol, ProviderDefinition, CompatReason } from '@cameleon/shared';

export interface PlanContext {
  def: ProviderDefinition;
  /** Non-secret credential fields (baseUrl, organization…). */
  fields: Record<string, string>;
  /** Decrypted secrets — may only flow into `env`, never into args or files. */
  secrets: Record<string, string>;
  protocol: Protocol;
  baseUrl: string;
  model: ModelRecord;
  extraArgs: string[];
}

export interface PlanBody {
  args: string[];
  env: Record<string, string>;
  /** Keys of `env` whose values are secret. */
  secretEnvKeys: string[];
  unsetEnv: string[];
  files: { key: string; filename: string; content: string }[];
  notes: string[];
}

export interface AssessResult { reasons: CompatReason[]; untested?: boolean }

/**
 * One external coding agent. Adding an agent = adding one file that exports an AgentSpec and listing it in agents/index.ts.
 * Every adapter uses the agent's DOCUMENTED configuration mechanism and never edits the user's own config files.
 */
export interface AgentSpec {
  id: string;
  aliases: string[];
  name: string;
  description: string;
  /** Executable names to look for (first match wins). */
  binaries: string[];
  supportedOS: NodeJS.Platform[];
  osNotes?: Partial<Record<NodeJS.Platform, string>>;
  /** Protocols the agent can speak, in order of preference. */
  protocols: Protocol[];
  /** Provider ids the agent vendor supports natively ('*' = any). */
  firstPartyProviders: string[];
  requiresTools: boolean;
  requiresStreaming: boolean;
  /** Advisory only: below this context window the agent may struggle. */
  recommendedContext: number;
  configFormat: string;
  modelSelection: string;
  envRequirements: string[];
  restore: string;
  docsUrl: string;
  install: { summary: string; commands: string[]; url: string };
  notes: string[];
  /** Agent-specific caveats for a provider/protocol pair. */
  assess(def: ProviderDefinition, protocol: Protocol): AssessResult;
  buildPlan(ctx: PlanContext): PlanBody;
}

/** `Authorization: Bearer` providers vs `x-api-key` providers. */
export const usesXApiKey = (def: ProviderDefinition) => def.auth.type === 'x-api-key';

/** Custom headers from the vault (JSON object) → ordered [name, value] pairs. */
export function customHeaders(secrets: Record<string, string>): [string, string][] {
  try {
    return Object.entries(JSON.parse(secrets['customHeaders'] ?? '{}') as Record<string, string>).map(([k, v]) => [k, String(v)]);
  } catch {
    return [];
  }
}
