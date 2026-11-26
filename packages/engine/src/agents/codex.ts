import { customHeaders, type AgentSpec } from './spec.js';

/**
 * Codex CLI accepts documented per-invocation overrides: `-c key=value` (TOML) and `-m <model>`.
 * We select a custom model provider this way, so ~/.codex/config.toml is never touched and nothing is written to disk.
 * The key is referenced by NAME (`env_key`) and passed in the environment — never in argv.
 */
const KEY_ENV = 'CAMELEON_API_KEY';
const toml = (s: string) => JSON.stringify(s); // JSON string escapes are valid TOML basic-string escapes

export const codex: AgentSpec = {
  id: 'codex',
  aliases: [],
  name: 'OpenAI Codex CLI',
  description: "OpenAI's open-source terminal coding agent.",
  binaries: ['codex'],
  supportedOS: ['darwin', 'linux', 'win32'],
  osNotes: { win32: 'Codex support on native Windows is experimental upstream; WSL is recommended.' },
  protocols: ['openai'],
  firstPartyProviders: ['openai'],
  requiresTools: true,
  requiresStreaming: true,
  recommendedContext: 32_000,
  configFormat: 'Per-invocation overrides: -m <model> and -c model_providers.<id>={…} (nothing written to disk)',
  modelSelection: '-m <model> with -c model_provider="cameleon"',
  envRequirements: ['OPENAI_API_KEY (OpenAI) or CAMELEON_API_KEY (custom provider, referenced via env_key)'],
  restore: 'Nothing to restore: ~/.codex/config.toml is never modified; the override exists only for this invocation.',
  docsUrl: 'https://github.com/openai/codex/blob/main/docs/config.md',
  install: {
    summary: 'Install Codex CLI yourself, then run “Detect again”. CAMELEON never installs software on its own.',
    commands: ['npm install -g @openai/codex', 'brew install codex'],
    url: 'https://github.com/openai/codex',
  },
  notes: ['Which wire protocol a third-party provider needs depends on your installed Codex version.'],

  assess(def) {
    if (def.id === 'openai') return { reasons: [] };
    return {
      untested: true,
      reasons: [{
        level: 'limitation', code: 'wire_api',
        message: `Codex talks to ${def.name} through its OpenAI-compatible chat-completions endpoint. Recent Codex versions favour the Responses API, so support for chat-completions providers depends on your Codex version and has not been verified.`,
      }],
    };
  },

  buildPlan({ def, fields, secrets, baseUrl, model, extraArgs }) {
    const key = secrets['apiKey'];
    const defaultOpenAI = def.id === 'openai' && !fields['baseUrl'] && !baseUrl.startsWith('http://127.0.0.1:');
    const args = ['-m', model.modelId];
    const env: Record<string, string> = {};
    const secretEnvKeys: string[] = [];

    if (defaultOpenAI) {
      // Built-in provider: only the standard OPENAI_API_KEY is needed.
      if (key) { env['OPENAI_API_KEY'] = key; secretEnvKeys.push('OPENAI_API_KEY'); }
    } else {
      const parts = [`name = ${toml(`${def.name} (via CAMELEON)`)}`, `base_url = ${toml(baseUrl)}`, `wire_api = ${toml(def.id === 'openai' ? 'responses' : 'chat')}`];
      if (key) { parts.push(`env_key = ${toml(KEY_ENV)}`); env[KEY_ENV] = key; secretEnvKeys.push(KEY_ENV); }
      const headers = customHeaders(secrets);
      if (headers.length) {
        parts.push(`env_http_headers = { ${headers.map(([k], i) => `${toml(k)} = ${toml(`CAMELEON_HEADER_${i + 1}`)}`).join(', ')} }`);
        headers.forEach(([, v], i) => { env[`CAMELEON_HEADER_${i + 1}`] = v; secretEnvKeys.push(`CAMELEON_HEADER_${i + 1}`); });
      }
      args.push('-c', `model_provider=${toml('cameleon')}`, '-c', `model_providers.cameleon={ ${parts.join(', ')} }`);
    }
    return {
      args: [...args, ...extraArgs], env, secretEnvKeys,
      unsetEnv: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', KEY_ENV],
      files: [],
      notes: defaultOpenAI ? [] : ['Uses a one-off custom model provider defined on the command line; your config.toml is untouched.'],
    };
  },
};
