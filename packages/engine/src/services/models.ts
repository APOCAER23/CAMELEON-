import {
  UNKNOWN_CAPABILITIES, type CapabilityFilter, type ManualModelInput, type ModelCapabilities, type ModelQuery, type ModelRecord, type SyncResult,
} from '@cameleon/shared';
import { adapterFor } from '../adapters/index.js';
import { HttpError, scrub, type DiscoveredModel } from '../adapters/index.js';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import type { ConnectionService } from './connections.js';
import type { CredentialService } from './credentials.js';

interface Row {
  provider_id: string; model_id: string; display_name: string; description: string | null; protocol: string; kind: string;
  context_window: number | null; max_output_tokens: number | null; capabilities_json: string; pricing_json: string | null;
  status: string; origin: string; synced_at: string;
}

const toRecord = (r: Row): ModelRecord => ({
  providerId: r.provider_id, modelId: r.model_id, displayName: r.display_name, description: r.description,
  protocol: r.protocol as ModelRecord['protocol'], kind: r.kind as ModelRecord['kind'],
  contextWindow: r.context_window, maxOutputTokens: r.max_output_tokens,
  capabilities: { ...UNKNOWN_CAPABILITIES, ...JSON.parse(r.capabilities_json) },
  pricing: r.pricing_json ? JSON.parse(r.pricing_json) : null,
  status: r.status as ModelRecord['status'], origin: r.origin as ModelRecord['origin'], syncedAt: r.synced_at,
});

const CAP_KEY: Record<CapabilityFilter, keyof ModelCapabilities> = {
  tools: 'toolCalling', streaming: 'streaming', vision: 'vision', structured: 'structuredOutput', reasoning: 'reasoning',
};
const NON_CHAT = new Set(['embedding', 'image', 'audio', 'moderation']);

/**
 * Model registry: a local cache of what each provider reports, plus manual entries.
 * Sync is on demand (no background polling). A failed sync NEVER erases the cache.
 */
export class ModelService {
  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private credentials: CredentialService,
    private connections: ConnectionService,
    private activity: ActivityService,
  ) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM models').get() as { n: number }).n;
  }

  list(q: ModelQuery & { limit?: number; offset?: number }): ModelRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.providerId) { where.push('provider_id = ?'); args.push(q.providerId); }
    if (q.kind) { where.push('kind = ?'); args.push(q.kind); }
    if (q.q?.trim()) {
      const like = `%${q.q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push("(lower(model_id) LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(description,'')) LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
    const rows = this.db.prepare(`SELECT * FROM models ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY provider_id, model_id`).all(...args) as Row[];
    let list = rows.map(toRecord);

    const caps = (q.capabilities ?? '').split(',').map((s) => s.trim()).filter(Boolean) as CapabilityFilter[];
    for (const c of caps) {
      if (!(c in CAP_KEY)) throw new AppError(400, 'validation_error', 'Invalid input', [{ path: 'capabilities', message: `Unknown capability "${c}"` }]);
      list = list.filter((m) => m.capabilities[CAP_KEY[c]] === 'supported');
    }
    if (q.chatOnly === '1') list = list.filter((m) => !NON_CHAT.has(m.kind));
    const offset = q.offset ?? 0;
    return list.slice(offset, offset + (q.limit ?? 500));
  }

  get(providerId: string, modelId: string): ModelRecord {
    const r = this.db.prepare('SELECT * FROM models WHERE provider_id = ? AND model_id = ?').get(providerId, modelId) as Row | undefined;
    if (!r) throw new AppError(404, 'model_not_found', 'Model not found');
    return toRecord(r);
  }

  addManual(input: ManualModelInput): ModelRecord {
    const { def } = this.registry.get(input.providerId);
    const protocol = input.protocol ?? def.protocols[0]!;
    if (!def.protocols.includes(protocol)) {
      throw new AppError(400, 'validation_error', 'Invalid input', [{ path: 'protocol', message: `${def.name} does not support the "${protocol}" protocol` }]);
    }
    const existing = this.db.prepare('SELECT origin FROM models WHERE provider_id = ? AND model_id = ?').get(def.id, input.modelId) as { origin: string } | undefined;
    if (existing && existing.origin !== 'manual') throw new AppError(409, 'model_exists', 'This model is already provided by the catalog');
    const caps: ModelCapabilities = { ...UNKNOWN_CAPABILITIES, ...(input.capabilities ?? {}) };
    this.db.prepare(
      `INSERT INTO models (provider_id, model_id, display_name, description, protocol, kind, context_window, max_output_tokens, capabilities_json, pricing_json, status, origin, synced_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'unknown', 'manual', ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET display_name = excluded.display_name, protocol = excluded.protocol, kind = excluded.kind,
         context_window = excluded.context_window, max_output_tokens = excluded.max_output_tokens, capabilities_json = excluded.capabilities_json, synced_at = excluded.synced_at`,
    ).run(def.id, input.modelId, input.displayName || input.modelId, protocol, input.kind ?? 'unknown', input.contextWindow ?? null, input.maxOutputTokens ?? null, JSON.stringify(caps), new Date().toISOString());
    this.activity.log('model.added', `Model "${input.modelId}" registered manually for ${def.name}`, def.id);
    return this.get(def.id, input.modelId);
  }

  deleteManual(providerId: string, modelId: string): void {
    const m = this.get(providerId, modelId);
    if (m.origin !== 'manual') throw new AppError(403, 'not_manual', 'Only manually registered models can be deleted — run a sync to refresh the catalog');
    this.db.prepare('DELETE FROM models WHERE provider_id = ? AND model_id = ?').run(providerId, modelId);
    this.activity.log('model.deleted', `Model "${modelId}" removed`, providerId);
  }

  /** Pick the credential to use for discovery: enabled, preferring one whose last test succeeded. */
  private pickCredential(providerId: string) {
    const enabled = this.credentials.list(providerId).filter((c) => c.enabled);
    return enabled.find((c) => c.lastCheck?.status === 'connected') ?? enabled.find((c) => c.lastCheck?.status !== 'failed') ?? enabled[0] ?? null;
  }

  async sync(providerId: string): Promise<SyncResult> {
    const { def } = this.registry.get(providerId);
    const syncedAt = new Date().toISOString();
    const base = { providerId: def.id, providerName: def.name, skipped: false, count: 0, added: 0, removed: 0, syncedAt };
    const fail = (error: string): SyncResult => ({ ...base, ok: false, error });

    const cred = this.pickCredential(def.id);
    if (!cred) return fail('No enabled credential — add one first');

    if (def.discovery.kind === 'manual') {
      return { ...base, ok: true, skipped: true, error: null, count: this.list({ providerId: def.id }).length };
    }

    const secrets = await this.credentials.getSecrets(cred.id);
    let found: DiscoveredModel[];
    try {
      found = await adapterFor(def).discover({ def, fields: cred.fields, secrets });
    } catch (e) {
      const msg = scrub(e instanceof HttpError ? e.message : (e as Error).message, Object.values(secrets));
      if (e instanceof HttpError && (e.kind === 'auth' || e.kind === 'not_found')) {
        this.connections.record(cred.id, { status: 'failed', latencyMs: null, httpStatus: e.httpStatus, errorKind: e.kind, message: msg, checkedAt: syncedAt });
      }
      this.activity.log('models.sync_failed', `${def.name}: model sync failed — ${msg}`, def.id);
      return fail(`${msg} (cached models were kept)`);
    }

    const existing = this.db.prepare("SELECT model_id FROM models WHERE provider_id = ? AND origin != 'manual'").all(def.id) as { model_id: string }[];
    if (found.length === 0 && existing.length > 0) {
      return fail('The provider returned an empty model list — cached models were kept');
    }

    const upsert = this.db.prepare(
      `INSERT INTO models (provider_id, model_id, display_name, description, protocol, kind, context_window, max_output_tokens, capabilities_json, pricing_json, status, origin, synced_at)
       VALUES (@provider_id, @model_id, @display_name, @description, @protocol, @kind, @context_window, @max_output_tokens, @capabilities_json, @pricing_json, @status, @origin, @synced_at)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET display_name = excluded.display_name, description = excluded.description, protocol = excluded.protocol,
         kind = excluded.kind, context_window = excluded.context_window, max_output_tokens = excluded.max_output_tokens, capabilities_json = excluded.capabilities_json,
         pricing_json = excluded.pricing_json, status = excluded.status, origin = excluded.origin, synced_at = excluded.synced_at
       WHERE models.origin != 'manual'`,
    );
    const seen = new Set(found.map((m) => m.modelId));
    const before = new Set(existing.map((r) => r.model_id));
    this.db.transaction(() => {
      for (const m of found) {
        upsert.run({
          provider_id: def.id, model_id: m.modelId, display_name: m.displayName, description: m.description, protocol: m.protocol, kind: m.kind,
          context_window: m.contextWindow, max_output_tokens: m.maxOutputTokens, capabilities_json: JSON.stringify(m.capabilities),
          pricing_json: m.pricing ? JSON.stringify(m.pricing) : null, status: m.status ?? 'available', origin: m.origin ?? 'discovered', synced_at: syncedAt,
        });
      }
      const del = this.db.prepare("DELETE FROM models WHERE provider_id = ? AND model_id = ? AND origin != 'manual'");
      for (const id of before) if (!seen.has(id)) del.run(def.id, id);
    })();

    const added = [...seen].filter((id) => !before.has(id)).length;
    const removed = [...before].filter((id) => !seen.has(id)).length;
    // A successful authenticated listing proves the credential works.
    if (def.discovery.kind === 'endpoint') {
      this.connections.record(cred.id, { status: 'connected', latencyMs: null, httpStatus: 200, errorKind: null, message: `Connected — ${found.length} models discovered`, checkedAt: syncedAt });
    }
    this.activity.log('models.synced', `${def.name}: ${found.length} models synced (+${added}, −${removed})`, def.id);
    return { ...base, ok: true, error: null, count: found.length, added, removed };
  }

  /** Forget everything that was discovered or curated (manual models are kept). */
  clearCache(): number {
    const n = this.db.prepare("DELETE FROM models WHERE origin != 'manual'").run().changes;
    this.activity.log('models.cache_cleared', `Model cache cleared (${n} models)`);
    return n;
  }

  /** Sync every provider that has an enabled credential, one after another (polite to providers). */
  async syncAll(): Promise<SyncResult[]> {
    const ids = [...new Set(this.credentials.list().filter((c) => c.enabled).map((c) => c.providerId))];
    const out: SyncResult[] = [];
    for (const id of ids) out.push(await this.sync(id));
    return out;
  }
}
