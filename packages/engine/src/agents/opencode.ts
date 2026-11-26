import { customHeaders, type AgentSpec } from './spec.js';

/**
 * OpenCode merges extra configuration from the file named by OPENCODE_CONFIG (documented) on top of the user's own config.
 * We generate a temporary file that contains NO secret: the API key is referenced as `{env:CAMELEON_API_KEY}` and travels
 * in the child's environment. The file is created 0600 and deleted when the session ends.
 */
const KEY_ENV = 'CAMELEON_API_KEY';

export const opencode: AgentSpec = {
  id: 'opencode',
  aliases: [],
  name: 'OpenCode',
  description: 'Open-source terminal coding agent with native multi-provider support.',
  binaries: ['opencode'],
  supportedOS: ['darwin', 'linux', 'win32'],
  protocols: ['openai', 'anthropic'],
  // OpenCode supports many providers natively, but tool support is a per-model property: only provider-reported support counts.
  firstPartyProviders: [],
  requiresTools: true,
  requiresStreaming: true,
  recommendedContext: 32_000,
  configFormat: 'Temporary JSON file via OPENCODE_CONFIG (merged over your own config; contains no secrets)',
  modelSelection: '"model": "<provider>/<model>" in the generated config',
  envRequirements: ['OPENCODE_CONFIG', 'CAMELEON_API_KEY (referenced as {env:CAMELEON_API_KEY})'],
  restore: 'Nothing to restore: your opencode.json is untouched. The temporary config file is deleted when the session ends.',
  docsUrl: 'https://opencode.ai/docs/config',
  install: {
    summary: 'Install OpenCode yourself, then run “Detect again”. CAMELEON never installs software on its own.',
    commands: ['npm install -g opencode-ai', 'curl -fsSL https://opencode.ai/install | bash'],
    url: 'https://opencode.ai/docs',
  },
  notes: [],

  assess: () => ({ reasons: [] }),

  buildPlan({ def, secrets, protocol, baseUrl, model, extraArgs }) {
    const providerKey = `cameleon-${def.id}`;
    const hasKey = Boolean(secrets['apiKey']);
    const env: Record<string, string> = { OPENCODE_CONFIG: '{{file:config}}' };
    const secretEnvKeys: string[] = [];
    if (hasKey) { env[KEY_ENV] = secrets['apiKey']!; secretEnvKeys.push(KEY_ENV); }

    const options: Record<string, unknown> = {
      // The AI SDK's Anthropic provider expects the /v1 suffix in baseURL; OpenAI-compatible URLs are used as-is.
      baseURL: protocol === 'anthropic' && !/\/v1$/.test(baseUrl) ? `${baseUrl}/v1` : baseUrl,
    };
    if (hasKey) options['apiKey'] = `{env:${KEY_ENV}}`;
    const headers = customHeaders(secrets);
    if (headers.length) {
      options['headers'] = Object.fromEntries(headers.map(([k], i) => [k, `{env:CAMELEON_HEADER_${i + 1}}`]));
      headers.forEach(([, v], i) => { env[`CAMELEON_HEADER_${i + 1}`] = v; secretEnvKeys.push(`CAMELEON_HEADER_${i + 1}`); });
    }

    const modelEntry: Record<string, unknown> = { name: model.displayName };
    if (model.contextWindow) modelEntry['limit'] = { context: model.contextWindow, output: model.maxOutputTokens ?? Math.min(model.contextWindow, 8192) };

    const config = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [providerKey]: {
          npm: protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
          name: `${def.name} (via CAMELEON)`,
          options,
          models: { [model.modelId]: modelEntry },
        },
      },
      model: `${providerKey}/${model.modelId}`,
    };
    return {
      args: [...extraArgs], env, secretEnvKeys, unsetEnv: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'],
      files: [{ key: 'config', filename: 'opencode.json', content: JSON.stringify(config, null, 2) }],
      notes: ['The generated config is merged over your own OpenCode configuration for this session only.'],
    };
  },
};
