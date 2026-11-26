import type { AgentSpec } from './spec.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import { githubCopilot } from './github-copilot.js';
import { opencode } from './opencode.js';
import { AppError } from '../errors.js';

export * from './spec.js';
export * from './detect.js';
export * from './custom.js';

/** Register new built-in agents here — the compatibility engine, launcher, CLI and UI pick them up automatically. */
export const AGENTS: readonly AgentSpec[] = [claudeCode, opencode, codex, githubCopilot];

export function getAgent(idOrAlias: string): AgentSpec {
  const a = AGENTS.find((x) => x.id === idOrAlias || x.aliases.includes(idOrAlias));
  if (!a) throw new AppError(404, 'agent_not_found', `Unknown agent "${idOrAlias}". Available: ${AGENTS.map((x) => x.id).join(', ')}`);
  return a;
}
