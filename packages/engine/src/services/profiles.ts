import { randomUUID } from 'node:crypto';
import type { ProfileInput, ProfileView } from '@cameleon/shared';
import type { AgentSpec } from '../agents/index.js';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import type { CredentialService } from './credentials.js';
import type { LauncherService } from './launcher.js';
import type { ModelService } from './models.js';

interface Row {
  id: string; name: string; agent_id: string; provider_id: string; model_id: string; credential_label: string | null;
  launch_args_json: string; project_path: string | null; created_at: string; updated_at: string;
}
const ACTIVE_KEY = 'activeProfileId';

/** Named (agent + provider + model [+ credential + args]) combinations, switchable instantly. */
export class ProfileService {
  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private credentials: CredentialService,
    private models: ModelService,
    private launcher: LauncherService,
    private activity: ActivityService,
  ) {}

  private activeId(): string | null {
    const r = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(ACTIVE_KEY) as { value_json: string } | undefined;
    return r ? (JSON.parse(r.value_json) as string | null) : null;
  }

  private view(r: Row, activeId: string | null): ProfileView {
    let agent: AgentSpec | null = null;
    try { agent = this.launcher.getAgentSpec(r.agent_id); } catch { agent = null; }
    return {
      id: r.id, name: r.name, agentId: r.agent_id,
      providerId: r.provider_id, providerName: this.registry.has(r.provider_id) ? this.registry.get(r.provider_id).def.name : null,
      modelId: r.model_id, credentialLabel: r.credential_label, launchArgs: JSON.parse(r.launch_args_json), projectPath: r.project_path,
      active: r.id === activeId, compat: this.launcher.evaluateFor(agent, r.provider_id, r.model_id, r.credential_label),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  private row(id: string): Row {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new AppError(404, 'profile_not_found', 'Profile not found');
    return r;
  }

  list(): ProfileView[] {
    const active = this.activeId();
    return (this.db.prepare('SELECT * FROM profiles ORDER BY name').all() as Row[]).map((r) => this.view(r, active));
  }

  get(id: string): ProfileView {
    return this.view(this.row(id), this.activeId());
  }

  active(): ProfileView | null {
    const id = this.activeId();
    if (!id) return null;
    try { return this.get(id); } catch { return null; }
  }

  private validate(input: { agentId: string; providerId: string; modelId: string; credentialLabel?: string | null }) {
    const agent = this.launcher.getAgentSpec(input.agentId);
    const { def } = this.registry.get(input.providerId);
    const issue = (path: string, message: string) => new AppError(400, 'validation_error', 'Invalid input', [{ path, message }]);
    try { this.models.get(def.id, input.modelId); } catch { throw issue('modelId', `"${input.modelId}" is not in the registry for ${def.name} — sync models or register it first`); }
    if (input.credentialLabel && !this.credentials.list(def.id).some((c) => c.label === input.credentialLabel)) {
      throw issue('credentialLabel', `${def.name} has no credential named "${input.credentialLabel}"`);
    }
    return agent;
  }

  create(input: ProfileInput & { launchArgs?: string[] }): ProfileView {
    const agent = this.validate(input);
    if (this.db.prepare('SELECT 1 FROM profiles WHERE name = ?').get(input.name)) throw new AppError(409, 'name_exists', `A profile named "${input.name}" already exists`);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO profiles (id, name, agent_id, provider_id, model_id, credential_label, launch_args_json, project_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.name, agent.id, input.providerId, input.modelId, input.credentialLabel ?? null, JSON.stringify(input.launchArgs ?? []), input.projectPath ?? null, now, now);
    this.activity.log('profile.created', `Profile "${input.name}" created (${agent.name})`, input.providerId);
    return this.get(id);
  }

  update(id: string, patch: Partial<ProfileInput>): ProfileView {
    const cur = this.row(id);
    const next = {
      name: patch.name ?? cur.name, agentId: patch.agentId ?? cur.agent_id, providerId: patch.providerId ?? cur.provider_id,
      modelId: patch.modelId ?? cur.model_id, credentialLabel: patch.credentialLabel === undefined ? cur.credential_label : patch.credentialLabel,
      launchArgs: patch.launchArgs ?? JSON.parse(cur.launch_args_json), projectPath: patch.projectPath === undefined ? cur.project_path : patch.projectPath,
    };
    const agent = this.validate(next);
    const clash = this.db.prepare('SELECT 1 FROM profiles WHERE name = ? AND id != ?').get(next.name, id);
    if (clash) throw new AppError(409, 'name_exists', `A profile named "${next.name}" already exists`);
    this.db.prepare(
      `UPDATE profiles SET name = ?, agent_id = ?, provider_id = ?, model_id = ?, credential_label = ?, launch_args_json = ?, project_path = ?, updated_at = ? WHERE id = ?`,
    ).run(next.name, agent.id, next.providerId, next.modelId, next.credentialLabel ?? null, JSON.stringify(next.launchArgs), next.projectPath ?? null, new Date().toISOString(), id);
    this.activity.log('profile.updated', `Profile "${next.name}" updated`, next.providerId);
    return this.get(id);
  }

  delete(id: string): void {
    const r = this.row(id);
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (this.activeId() === id) this.db.prepare('DELETE FROM settings WHERE key = ?').run(ACTIVE_KEY);
    this.activity.log('profile.deleted', `Profile "${r.name}" deleted`, r.provider_id);
  }

  activate(id: string | null): void {
    if (id === null) { this.db.prepare('DELETE FROM settings WHERE key = ?').run(ACTIVE_KEY); return; }
    const r = this.row(id);
    this.db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(ACTIVE_KEY, JSON.stringify(id));
    this.activity.log('profile.switched', `Active profile: "${r.name}"`, r.provider_id);
  }
}
