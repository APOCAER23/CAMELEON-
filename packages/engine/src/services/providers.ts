import { ProviderDefinition, type ProviderCategory, type ProviderView, type ConnectionStatus } from '@cameleon/shared';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import type { CredentialService } from './credentials.js';

export class ProviderService {
  constructor(private db: Db, private registry: ProviderRegistry, private credentials: CredentialService, private activity: ActivityService) {}

  private modelCounts(): Map<string, number> {
    const rows = this.db.prepare('SELECT provider_id AS p, COUNT(*) AS n FROM models GROUP BY provider_id').all() as { p: string; n: number }[];
    return new Map(rows.map((r) => [r.p, r.n]));
  }

  private view(def: ProviderDefinition, source: ProviderView['source'], creds: ReturnType<CredentialService['counts']>, models: Map<string, number>): ProviderView {
    const c = creds.get(def.id);
    // connected / error come ONLY from recorded live tests; without a test result the status is just 'configured'.
    const status: ConnectionStatus = !c ? 'not_configured' : c.enabled === 0 ? 'disabled' : c.ok > 0 ? 'connected' : c.bad > 0 ? 'error' : 'configured';
    return { ...def, source, status, credentialCount: c?.total ?? 0, modelCount: models.get(def.id) ?? 0 };
  }

  list(filter: { category?: ProviderCategory; q?: string } = {}): ProviderView[] {
    const creds = this.credentials.counts();
    const models = this.modelCounts();
    return this.registry.list(filter).map((e) => this.view(e.def, e.source, creds, models));
  }

  get(id: string): ProviderView {
    const e = this.registry.get(id);
    return this.view(e.def, e.source, this.credentials.counts(), this.modelCounts());
  }

  createCustom(input: unknown): ProviderView {
    const def = ProviderDefinition.parse({ ...(input as object), category: 'custom' });
    this.registry.register(def, 'custom');
    this.db.prepare('INSERT INTO custom_providers (id, definition_json, created_at) VALUES (?, ?, ?)').run(def.id, JSON.stringify(def), new Date().toISOString());
    this.activity.log('provider.custom_created', `Custom provider "${def.name}" created`, def.id);
    return this.get(def.id);
  }

  deleteCustom(id: string): void {
    const entry = this.registry.get(id);
    if (entry.source !== 'custom') throw new AppError(403, 'not_custom', 'Only custom providers created in the app can be deleted here');
    if (this.credentials.list(id).length) throw new AppError(409, 'has_credentials', 'Remove this provider\'s credentials first');
    this.registry.unregister(id);
    this.db.prepare('DELETE FROM custom_providers WHERE id = ?').run(id);
    this.activity.log('provider.custom_deleted', `Custom provider "${entry.def.name}" deleted`, id);
  }

  loadCustomFromDb(): void {
    const rows = this.db.prepare('SELECT definition_json FROM custom_providers').all() as { definition_json: string }[];
    for (const r of rows) {
      try { this.registry.register(ProviderDefinition.parse(JSON.parse(r.definition_json)), 'custom'); } catch { /* skip corrupt rows */ }
    }
  }
}
