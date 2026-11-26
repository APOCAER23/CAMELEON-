import { randomUUID } from 'node:crypto';
import { maskSecret } from '@cameleon/kit';
import type {
  AgentCompat, AgentView, CompatEntry, CompatQuery, CompatResult, CustomAgentInput, FinishLaunchInput, LaunchPlan, LaunchRecord, LaunchRequest, Protocol,
} from '@cameleon/shared';
import { AGENTS, buildCustomAgentSpec, detectBinary, type AgentSpec, type Detection } from '../agents/index.js';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import { evaluate, type CredentialState } from '../compat/engine.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import type { CredentialService } from './credentials.js';
import type { ModelService } from './models.js';
import type { MeterProxy } from '../proxy/meter.js';

const DETECT_TTL_MS = 30_000;
const ORDER = { compatible: 0, limited: 1, untested: 2, incompatible: 3 } as const;

export class LauncherService {
  private detections = new Map<string, Detection>();

  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private credentials: CredentialService,
    private models: ModelService,
    private activity: ActivityService,
    private meterProxy?: MeterProxy,
  ) {}

  /* ───── agents ───── */

  private loadCustomAgents(): AgentSpec[] {
    const rows = this.db.prepare('SELECT * FROM custom_agents ORDER BY created_at ASC').all() as {
      id: string;
      name: string;
      binary: string;
      aliases_json: string;
      description: string;
      protocols_json: string;
      model_flag: string;
      extra_args_json: string;
      env_template_json: string;
    }[];
    return rows.map((r) =>
      buildCustomAgentSpec({
        id: r.id,
        name: r.name,
        binary: r.binary,
        aliases: JSON.parse(r.aliases_json) as string[],
        description: r.description,
        protocols: JSON.parse(r.protocols_json) as Protocol[],
        modelFlag: r.model_flag,
        extraArgs: JSON.parse(r.extra_args_json) as string[],
        envTemplate: JSON.parse(r.env_template_json) as Record<string, string>,
      }),
    );
  }

  private allAgents(): { spec: AgentSpec; custom: boolean }[] {
    return [
      ...AGENTS.map((spec) => ({ spec, custom: false })),
      ...this.loadCustomAgents().map((spec) => ({ spec, custom: true })),
    ];
  }

  getAgentSpec(idOrAlias: string): AgentSpec {
    const all = this.allAgents().map((x) => x.spec);
    const a = all.find((x) => x.id === idOrAlias || x.aliases.includes(idOrAlias));
    if (!a) {
      throw new AppError(404, 'agent_not_found', `Unknown agent "${idOrAlias}". Available: ${all.map((x) => x.id).join(', ')}`);
    }
    return a;
  }

  private async detect(agent: AgentSpec, refresh = false): Promise<Detection> {
    const hit = this.detections.get(agent.id);
    if (!refresh && hit && Date.now() - Date.parse(hit.checkedAt) < DETECT_TTL_MS) return hit;
    const d = await detectBinary(agent.binaries);
    this.detections.set(agent.id, d);
    return d;
  }

  async agents(refresh = false): Promise<AgentView[]> {
    return Promise.all(this.allAgents().map(async ({ spec: a, custom }) => {
      const d = await this.detect(a, refresh);
      return {
        id: a.id, aliases: a.aliases, name: a.name, description: a.description,
        installed: d.installed, path: d.path, version: d.version, checkedAt: d.checkedAt,
        supportedOS: a.supportedOS, osSupported: a.supportedOS.includes(process.platform), osNote: a.osNotes?.[process.platform] ?? null,
        protocols: a.protocols, configFormat: a.configFormat, modelSelection: a.modelSelection, envRequirements: a.envRequirements,
        restore: a.restore, docsUrl: a.docsUrl, install: a.install, notes: a.notes,
        ...(custom ? { custom: true } : {}),
      };
    }));
  }

  async createCustomAgent(input: z_CustomAgentInput): Promise<AgentView> {
    const slug = (input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40);
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
      throw new AppError(400, 'invalid_agent_id', 'Agent ID must be 2-41 lowercase alphanumeric characters or hyphens.');
    }
    if (AGENTS.some((a) => a.id === slug || a.aliases.includes(slug))) {
      throw new AppError(409, 'agent_exists', `Built-in agent "${slug}" already exists.`);
    }
    const existing = this.db.prepare('SELECT id FROM custom_agents WHERE id = ?').get(slug);
    if (existing) {
      throw new AppError(409, 'agent_exists', `Custom agent "${slug}" already exists.`);
    }
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO custom_agents (id, name, binary, aliases_json, description, protocols_json, model_flag, extra_args_json, env_template_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      slug,
      input.name,
      input.binary,
      JSON.stringify(input.aliases ?? []),
      input.description ?? '',
      JSON.stringify(input.protocols ?? ['openai', 'anthropic']),
      input.modelFlag ?? '',
      JSON.stringify(input.extraArgs ?? []),
      JSON.stringify(input.envTemplate ?? {}),
      now,
      now,
    );
    this.detections.delete(slug);
    this.activity.log('agent.custom_created', `Registered custom agent "${input.name}" (${input.binary})`, slug);
    const list = await this.agents(true);
    return list.find((a) => a.id === slug)!;
  }

  deleteCustomAgent(id: string): void {
    const res = this.db.prepare('DELETE FROM custom_agents WHERE id = ?').run(id);
    if (res.changes === 0) throw new AppError(404, 'agent_not_found', `Custom agent "${id}" not found.`);
    this.detections.delete(id);
    this.activity.log('agent.custom_deleted', `Removed custom agent "${id}"`, id);
  }

  /* ───── compatibility ───── */

  private credState(providerId: string, label?: string | null): { cred: ReturnType<CredentialService['pick']>; state: CredentialState | null } {
    const cred = this.credentials.pick(providerId, label ?? undefined);
    return { cred, state: cred ? { enabled: cred.enabled, hasKey: cred.secretFields.includes('apiKey'), fields: cred.fields } : null };
  }

  /** Evaluate one (agent, provider, model). Missing pieces become blockers instead of errors. */
  evaluateFor(agent: AgentSpec | null, providerId: string, modelId: string, label?: string | null): CompatResult {
    const block = (code: string, message: string): CompatResult => ({ status: 'incompatible', protocol: null, baseUrl: null, reasons: [{ level: 'blocker', code, message }] });
    if (!agent) return block('agent_missing', 'This agent is no longer available.');
    if (!this.registry.has(providerId)) return block('provider_missing', `Provider "${providerId}" no longer exists.`);
    let model;
    try { model = this.models.get(providerId, modelId); } catch { return block('model_missing', `Model "${modelId}" is not in the registry — run a sync or register it.`); }
    const { def } = this.registry.get(providerId);
    return evaluate(agent, def, model, this.credState(providerId, label).state);
  }

  compatList(q: z_CompatQuery): CompatEntry[] {
    const agent = this.getAgentSpec(q.agentId);
    const wanted = new Set((q.status ?? 'compatible,limited,untested').split(',').map((s) => s.trim()).filter(Boolean));
    const states = new Map<string, CredentialState | null>();
    const out: CompatEntry[] = [];
    for (const m of this.models.list({ providerId: q.providerId, q: q.q, chatOnly: '1', limit: 5000 })) {
      if (!states.has(m.providerId)) states.set(m.providerId, this.credState(m.providerId).state);
      const { def } = this.registry.get(m.providerId);
      const compat = evaluate(agent, def, m, states.get(m.providerId) ?? null);
      if (wanted.has(compat.status)) out.push({ providerId: m.providerId, modelId: m.modelId, displayName: m.displayName, contextWindow: m.contextWindow, compat });
    }
    out.sort((a, b) => ORDER[a.compat.status] - ORDER[b.compat.status] || a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
    return out.slice(0, q.limit ?? 2000);
  }

  modelCompat(providerId: string, modelId: string): AgentCompat[] {
    return this.allAgents().map(({ spec: a }) => ({ agentId: a.id, agentName: a.name, compat: this.evaluateFor(a, providerId, modelId) }));
  }

  /* ───── launch plans ───── */

  async plan(req: LaunchRequestParsed, opts: { mask: boolean; record: boolean }): Promise<LaunchPlan> {
    const agent = this.getAgentSpec(req.agentId);
    const { def } = this.registry.get(req.providerId);
    let model;
    try { model = this.models.get(req.providerId, req.modelId); } catch {
      throw new AppError(404, 'model_not_found', `Model "${req.modelId}" is not in the registry for ${def.name}. Run \`cameleon models sync\` or register it with \`cameleon models add\`.`);
    }
    const { cred, state } = this.credState(def.id, req.credentialLabel);
    const compat = evaluate(agent, def, model, state);
    if (compat.status === 'incompatible' && !req.force) {
      throw new AppError(409, 'incompatible', `${agent.name} cannot use ${model.modelId} on ${def.name}: ${compat.reasons.filter((r) => r.level === 'blocker').map((r) => r.message).join(' ')}`,
        compat.reasons.map((r) => ({ path: r.code, message: r.message })));
    }
    if (!cred || !compat.protocol || !compat.baseUrl) {
      throw new AppError(409, 'incompatible', `Cannot build a launch plan: ${compat.reasons.filter((r) => r.level === 'blocker').map((r) => r.message).join(' ')}`);
    }

    const det = await this.detect(agent);
    if (opts.record) {
      if (!det.installed) throw new AppError(409, 'agent_not_installed', `${agent.name} is not installed. ${agent.install.summary} (${agent.install.commands[0] ?? agent.install.url})`);
      if (!agent.supportedOS.includes(process.platform)) throw new AppError(409, 'os_unsupported', `${agent.name} does not support ${process.platform}.`);
    }

    let launchId: string | null = null;
    if (opts.record) {
      launchId = randomUUID();
      this.db.prepare('INSERT INTO launches (id, agent_id, provider_id, model_id, profile_id, started_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(launchId, agent.id, def.id, model.modelId, req.profileId ?? null, new Date().toISOString());
      this.db.prepare('DELETE FROM launches WHERE id NOT IN (SELECT id FROM launches ORDER BY started_at DESC LIMIT 500)').run();
      this.activity.log('agent.launch', `${agent.name} launched with ${def.name} / ${model.modelId}`, def.id);
    }

    let effectiveBaseUrl = compat.baseUrl;
    if (opts.record && req.meter && this.meterProxy?.isRunning) {
      effectiveBaseUrl = this.meterProxy.register({
        upstreamBaseUrl: compat.baseUrl,
        launchId,
        agentId: agent.id,
        providerId: def.id,
        modelId: model.modelId,
        protocol: compat.protocol,
      });
    }

    const secrets = await this.credentials.getSecrets(cred.id);
    const body = agent.buildPlan({ def, fields: cred.fields, secrets, protocol: compat.protocol, baseUrl: effectiveBaseUrl, model, extraArgs: req.extraArgs ?? [] });

    // Defence in depth: a secret must only ever appear in `env`.
    const secretValues = new Set<string>(Object.values(secrets).filter((v) => v.length >= 6));
    try { for (const v of Object.values(JSON.parse(secrets['customHeaders'] ?? '{}') as Record<string, string>)) if (String(v).length >= 6) secretValues.add(String(v)); } catch { /* none */ }
    for (const text of [...body.args, ...body.files.map((f) => f.content)]) {
      for (const s of secretValues) if (text.includes(s)) throw new AppError(500, 'plan_leak', 'Internal error: a secret would have been exposed outside the environment — launch aborted.');
    }

    const env = { ...body.env };
    if (opts.mask) for (const k of body.secretEnvKeys) env[k] = k === 'ANTHROPIC_CUSTOM_HEADERS' ? '••••' : maskSecret(env[k] ?? '');

    return {
      launchId, agentId: agent.id, agentName: agent.name,
      command: det.path ?? agent.binaries[0]!, args: body.args, env, secretEnvKeys: body.secretEnvKeys, unsetEnv: body.unsetEnv, files: body.files,
      notes: body.notes,
      summary: { providerId: def.id, providerName: def.name, modelId: model.modelId, protocol: compat.protocol, baseUrl: compat.baseUrl, credentialLabel: cred.label },
      compat, agentInstalled: det.installed, masked: opts.mask,
    };
  }

  finish(id: string, input: FinishLaunchInput): void {
    const row = this.db.prepare('SELECT agent_id, provider_id, model_id FROM launches WHERE id = ?').get(id) as { agent_id: string; provider_id: string; model_id: string } | undefined;
    if (!row) throw new AppError(404, 'launch_not_found', 'Unknown launch');
    this.db.prepare('UPDATE launches SET ended_at = ?, exit_code = ?, signal = ? WHERE id = ? AND ended_at IS NULL')
      .run(new Date().toISOString(), input.exitCode, input.signal ?? null, id);
    this.activity.log('agent.exited', `${row.agent_id} session ended (${input.signal ? `signal ${input.signal}` : `exit ${input.exitCode}`})`, row.provider_id);
  }

  recent(limit = 20): LaunchRecord[] {
    const rows = this.db.prepare('SELECT * FROM launches ORDER BY started_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 200)) as {
      id: string; agent_id: string; provider_id: string; model_id: string; profile_id: string | null; started_at: string; ended_at: string | null; exit_code: number | null; signal: string | null;
    }[];
    return rows.map((r) => ({ id: r.id, agentId: r.agent_id, providerId: r.provider_id, modelId: r.model_id, profileId: r.profile_id, startedAt: r.started_at, endedAt: r.ended_at, exitCode: r.exit_code, signal: r.signal }));
  }
}

type z_CompatQuery = Omit<CompatQuery, 'limit'> & { limit?: number };
type LaunchRequestParsed = Omit<LaunchRequest, 'extraArgs' | 'force'> & { extraArgs?: string[]; force?: boolean; meter?: boolean };
type z_CustomAgentInput = CustomAgentInput;
