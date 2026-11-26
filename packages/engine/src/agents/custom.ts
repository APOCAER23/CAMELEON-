import type { Protocol } from '@cameleon/shared';
import type { AgentSpec } from './spec.js';
import { usesXApiKey } from './spec.js';

export interface CustomAgentRow {
  id: string;
  name: string;
  binary: string;
  aliases: string[];
  description: string;
  protocols: Protocol[];
  modelFlag: string;
  extraArgs: string[];
  envTemplate: Record<string, string>;
}

/**
 * Convert a user-registered custom agent row into a full AgentSpec so the compatibility engine,
 * launcher, profiles, CLI, and desktop UI all treat it identically to built-in agents.
 */
export function buildCustomAgentSpec(row: CustomAgentRow): AgentSpec {
  const protocols = row.protocols.length > 0 ? row.protocols : (['openai', 'anthropic'] as Protocol[]);
  return {
    id: row.id,
    aliases: row.aliases,
    name: row.name,
    description: row.description || `Custom CLI agent (${row.binary})`,
    binaries: [row.binary],
    supportedOS: ['darwin', 'linux', 'win32'],
    protocols,
    firstPartyProviders: [],
    requiresTools: false,
    requiresStreaming: true,
    recommendedContext: 16_000,
    configFormat: row.modelFlag
      ? `Standard protocol env vars + ${row.modelFlag} <model>`
      : 'Standard protocol environment variables (OPENAI_*, ANTHROPIC_*, GEMINI_*, CAMELEON_*)',
    modelSelection: row.modelFlag ? `${row.modelFlag} <model>` : 'OPENAI_MODEL / ANTHROPIC_MODEL / CAMELEON_MODEL',
    envRequirements: ['OPENAI_BASE_URL / ANTHROPIC_BASE_URL / CAMELEON_BASE_URL', 'OPENAI_API_KEY / ANTHROPIC_API_KEY / CAMELEON_API_KEY'],
    restore: 'Nothing to restore: custom agent configuration is injected only into the launched process environment.',
    docsUrl: '',
    install: {
      summary: `Ensure "${row.binary}" is installed and available on your PATH, then run “Detect again”.`,
      commands: [],
      url: '',
    },
    notes: ['Custom user-defined agent. Standard protocol variables and any custom env mappings are injected at launch.'],

    assess: () => ({ reasons: [] }),

    buildPlan({ def, secrets, protocol, baseUrl, model, extraArgs }) {
      const key = secrets['apiKey'] ?? '';
      const env: Record<string, string> = {
        CAMELEON_BASE_URL: baseUrl,
        CAMELEON_MODEL: model.modelId,
        CAMELEON_PROTOCOL: protocol,
      };
      const secretEnvKeys: string[] = [];

      if (key) {
        env['CAMELEON_API_KEY'] = key;
        secretEnvKeys.push('CAMELEON_API_KEY');
      }

      if (protocol === 'openai') {
        env['OPENAI_BASE_URL'] = baseUrl;
        env['OPENAI_MODEL'] = model.modelId;
        if (key) {
          env['OPENAI_API_KEY'] = key;
          secretEnvKeys.push('OPENAI_API_KEY');
        } else if (def.auth.type === 'none') {
          env['OPENAI_API_KEY'] = 'ollama';
        }
      } else if (protocol === 'anthropic') {
        env['ANTHROPIC_BASE_URL'] = baseUrl;
        env['ANTHROPIC_MODEL'] = model.modelId;
        if (usesXApiKey(def)) {
          if (key) {
            env['ANTHROPIC_API_KEY'] = key;
            secretEnvKeys.push('ANTHROPIC_API_KEY');
          }
        } else {
          env['ANTHROPIC_AUTH_TOKEN'] = key || (def.auth.type === 'none' ? 'ollama' : '');
          env['ANTHROPIC_API_KEY'] = '';
          if (key) secretEnvKeys.push('ANTHROPIC_AUTH_TOKEN');
        }
      } else if (protocol === 'gemini') {
        env['GOOGLE_GEMINI_BASE_URL'] = baseUrl;
        env['GEMINI_MODEL'] = model.modelId;
        if (key) {
          env['GEMINI_API_KEY'] = key;
          secretEnvKeys.push('GEMINI_API_KEY');
        }
      }

      // Apply user-defined environment variable templates
      for (const [k, tmpl] of Object.entries(row.envTemplate)) {
        const val = tmpl
          .replaceAll('{{apiKey}}', key)
          .replaceAll('{{baseUrl}}', baseUrl)
          .replaceAll('{{model}}', model.modelId)
          .replaceAll('{{protocol}}', protocol);
        env[k] = val;
        if (tmpl.includes('{{apiKey}}') && key && !secretEnvKeys.includes(k)) {
          secretEnvKeys.push(k);
        }
      }

      const args: string[] = [];
      if (row.modelFlag) {
        args.push(row.modelFlag, model.modelId);
      }
      args.push(...row.extraArgs, ...extraArgs);

      return {
        args,
        env,
        secretEnvKeys,
        unsetEnv: [],
        files: [],
        notes: [`Injected ${protocol} environment variables for custom agent "${row.name}".`],
      };
    },
  };
}
