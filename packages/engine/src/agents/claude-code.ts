import { customHeaders, usesXApiKey, type AgentSpec } from './spec.js';

/**
 * Claude Code is configured through documented environment variables:
 *   ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN (Bearer) / ANTHROPIC_API_KEY (x-api-key), ANTHROPIC_MODEL,
 *   ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL, CLAUDE_CODE_SUBAGENT_MODEL, ANTHROPIC_CUSTOM_HEADERS.
 * Nothing is written to ~/.claude: the selection lives only in the child process environment.
 */
const MANAGED = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL',
];

export const claudeCode: AgentSpec = {
  id: 'claude-code',
  aliases: ['claude'],
  name: 'Claude Code',
  description: "Anthropic's terminal coding agent. Runs on any provider that exposes the Anthropic Messages API.",
  binaries: ['claude'],
  supportedOS: ['darwin', 'linux', 'win32'],
  protocols: ['anthropic'],
  firstPartyProviders: ['anthropic'],
  requiresTools: true,
  requiresStreaming: true,
  recommendedContext: 32_000,
  configFormat: 'Environment variables (nothing written to disk)',
  modelSelection: 'ANTHROPIC_MODEL, plus the Opus/Sonnet/Haiku/sub-agent aliases pinned to the same model',
  envRequirements: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
  restore: 'Nothing to restore: your ~/.claude settings are never modified. Conflicting variables are only removed from the launched process.',
  docsUrl: 'https://docs.claude.com/en/docs/claude-code',
  install: {
    summary: 'Install Claude Code yourself, then run “Detect again”. CAMELEON never installs software on its own.',
    commands: ['npm install -g @anthropic-ai/claude-code'],
    url: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  notes: ['Providers that only expose an OpenAI-compatible API need a translation proxy and are reported incompatible.'],

  assess(def) {
    if (this.firstPartyProviders.includes(def.id)) return { reasons: [] };
    return {
      reasons: [{
        level: 'limitation', code: 'third_party_endpoint',
        message: `${def.name} implements the Anthropic Messages API as a compatibility layer: features such as prompt caching, web search or extended thinking may be missing or behave differently.`,
      }],
    };
  },

  buildPlan({ def, secrets, baseUrl, model, extraArgs }) {
    const key = secrets['apiKey'];
    const env: Record<string, string> = { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_MODEL: model.modelId };
    const secretEnvKeys: string[] = [];
    const firstParty = def.id === 'anthropic';

    if (usesXApiKey(def)) {
      env['ANTHROPIC_API_KEY'] = key ?? '';
      if (key) secretEnvKeys.push('ANTHROPIC_API_KEY');
    } else {
      // Bearer-token providers (OpenRouter, DeepSeek, Ollama…). ANTHROPIC_API_KEY must be explicitly EMPTY so a stray key is never sent.
      env['ANTHROPIC_AUTH_TOKEN'] = key ?? (def.auth.type === 'none' ? 'ollama' : '');
      env['ANTHROPIC_API_KEY'] = '';
      if (key) secretEnvKeys.push('ANTHROPIC_AUTH_TOKEN');
    }
    if (!firstParty) {
      // Background calls would otherwise ask for claude-haiku-* etc., which a third-party endpoint does not serve.
      env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = model.modelId;
      env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = model.modelId;
      env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = model.modelId;
      env['ANTHROPIC_SMALL_FAST_MODEL'] = model.modelId;
      env['CLAUDE_CODE_SUBAGENT_MODEL'] = model.modelId;
    }
    const headers = customHeaders(secrets);
    if (headers.length) {
      env['ANTHROPIC_CUSTOM_HEADERS'] = headers.map(([k, v]) => `${k}: ${v}`).join('\n');
      secretEnvKeys.push('ANTHROPIC_CUSTOM_HEADERS');
    }
    return {
      args: [...extraArgs], env, secretEnvKeys, unsetEnv: MANAGED, files: [],
      notes: firstParty ? [] : ['All model aliases (Opus / Sonnet / Haiku / sub-agents) are pinned to the selected model.'],
    };
  },
};
