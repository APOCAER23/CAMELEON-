import type { AgentSpec } from './spec.js';

/**
 * GitHub Copilot CLI supports Bring Your Own Key (BYOK) via documented environment variables:
 *   COPILOT_PROVIDER_BASE_URL, COPILOT_PROVIDER_API_KEY, COPILOT_PROVIDER_TYPE,
 *   COPILOT_MODEL, COPILOT_OFFLINE.
 * Nothing is written to ~/.copilot: the selection lives only in the child process environment.
 */
const MANAGED = [
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_MODEL',
  'COPILOT_OFFLINE',
];

export const githubCopilot: AgentSpec = {
  id: 'github-copilot',
  aliases: ['copilot', 'github'],
  name: 'GitHub Copilot CLI',
  description: "GitHub's terminal coding agent. Supports custom OpenAI and Anthropic endpoints via BYOK.",
  binaries: ['copilot'],
  supportedOS: ['darwin', 'linux', 'win32'],
  protocols: ['openai', 'anthropic'],
  firstPartyProviders: [],
  requiresTools: true,
  requiresStreaming: true,
  recommendedContext: 32_000,
  configFormat: 'Environment variables (COPILOT_PROVIDER_* and COPILOT_MODEL — nothing written to disk)',
  modelSelection: 'COPILOT_MODEL=<providerType>/<modelId>',
  envRequirements: ['COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_MODEL'],
  restore: 'Nothing to restore: your Copilot configuration is never modified.',
  docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli',
  install: {
    summary: 'Install GitHub Copilot CLI yourself, then run “Detect again”. CAMELEON never installs software on its own.',
    commands: ['npm install -g @github/copilot'],
    url: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
  },
  notes: ['Uses BYOK environment variables with COPILOT_OFFLINE=1 so GitHub auth is bypassed for custom providers.'],

  assess: () => ({ reasons: [] }),

  buildPlan({ def, secrets, protocol, baseUrl, model, extraArgs }) {
    const providerType = protocol === 'anthropic' ? 'anthropic' : 'openai';
    const key = secrets['apiKey'];
    const env: Record<string, string> = {
      COPILOT_PROVIDER_TYPE: providerType,
      COPILOT_PROVIDER_BASE_URL: baseUrl,
      COPILOT_MODEL: `${providerType}/${model.modelId}`,
      COPILOT_OFFLINE: '1',
    };
    const secretEnvKeys: string[] = [];
    if (key) {
      env['COPILOT_PROVIDER_API_KEY'] = key;
      secretEnvKeys.push('COPILOT_PROVIDER_API_KEY');
    } else if (def.auth.type === 'none') {
      env['COPILOT_PROVIDER_API_KEY'] = 'ollama';
    }
    return {
      args: [...extraArgs],
      env,
      secretEnvKeys,
      unsetEnv: MANAGED,
      files: [],
      notes: [`Configured GitHub Copilot CLI in BYOK mode (${providerType}) pointing at ${baseUrl}.`],
    };
  },
};
