import { randomUUID } from 'node:crypto';
import { maskSecret, type SecretStore } from '@cameleon/kit';
import type { CreateCredentialInput, CredentialSummary, UpdateCredentialInput, ProviderDefinition } from '@cameleon/shared';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import { validateValues } from './validation.js';

interface Row {
  id: string; provider_id: string; label: string; masked_key: string | null;
  fields_json: string; secret_fields_json: string; enabled: number; created_at: string; updated_at: string;
  chk_status: 'connected' | 'failed' | null; chk_at: string | null; chk_ms: number | null; chk_msg: string | null;
}

const SELECT = `SELECT c.*, k.status AS chk_status, k.checked_at AS chk_at, k.latency_ms AS chk_ms, k.message AS chk_msg
  FROM credentials c LEFT JOIN connection_checks k ON k.credential_id = c.id`;

const vaultName = (id: string) => `cred:${id}`;
const toSummary = (r: Row): CredentialSummary => ({
  id: r.id, providerId: r.provider_id, label: r.label, maskedKey: r.masked_key,
  fields: JSON.parse(r.fields_json), secretFields: JSON.parse(r.secret_fields_json),
  enabled: r.enabled === 1,
  lastCheck: r.chk_status && r.chk_at ? { status: r.chk_status, checkedAt: r.chk_at, latencyMs: r.chk_ms, message: r.chk_msg ?? '' } : null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/**
 * Credentials = non-secret metadata in SQLite + secret payload in the vault.
 * SQLite only ever sees a masked hint (`sk-or-…a1b2`); the real values live under `cred:<id>` in the vault.
 */
export class CredentialService {
  constructor(private db: Db, private vault: SecretStore, private registry: ProviderRegistry, private activity: ActivityService) {}

  list(providerId?: string): CredentialSummary[] {
    const rows = (providerId
      ? this.db.prepare(`${SELECT} WHERE c.provider_id = ? ORDER BY c.label`).all(providerId)
      : this.db.prepare(`${SELECT} ORDER BY c.provider_id, c.label`).all()) as Row[];
    return rows.map(toSummary);
  }

  /** Credential to use for a provider: the labelled one, else the best enabled one (recently tested OK first). */
  pick(providerId: string, label?: string): CredentialSummary | null {
    const all = this.list(providerId);
    if (label) return all.find((c) => c.label === label) ?? null;
    const enabled = all.filter((c) => c.enabled);
    return enabled.find((c) => c.lastCheck?.status === 'connected') ?? enabled.find((c) => c.lastCheck?.status !== 'failed') ?? enabled[0] ?? null;
  }

  private row(id: string): Row {
    const r = this.db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as Row | undefined;
    if (!r) throw new AppError(404, 'credential_not_found', 'Credential not found');
    return r;
  }

  get(id: string): CredentialSummary {
    return toSummary(this.row(id));
  }

  /** INTERNAL: decrypted secrets for launching agents / testing connections. Never expose through the HTTP API. */
  async getSecrets(id: string): Promise<Record<string, string>> {
    this.row(id);
    const raw = await this.vault.get(vaultName(id));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }

  private split(def: ProviderDefinition, values: Record<string, string>) {
    const secretKeys = new Set(def.fields.filter((f) => f.kind === 'secret').map((f) => f.key));
    const secrets: Record<string, string> = {};
    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) (secretKeys.has(k) ? secrets : plain)[k] = v;
    return { secrets, plain };
  }

  async create(input: CreateCredentialInput): Promise<{ credential: CredentialSummary; warnings: string[] }> {
    const { def } = this.registry.get(input.providerId);
    const exists = this.db.prepare('SELECT 1 FROM credentials WHERE provider_id = ? AND label = ?').get(def.id, input.label);
    if (exists) throw new AppError(409, 'label_exists', `${def.name} already has a credential named "${input.label}"`);

    const { set, warnings } = validateValues(def, input.values, 'create');
    const { secrets, plain } = this.split(def, set);
    const id = randomUUID();
    const now = new Date().toISOString();

    if (Object.keys(secrets).length) await this.vault.set(vaultName(id), JSON.stringify(secrets));
    try {
      this.db.prepare(
        `INSERT INTO credentials (id, provider_id, label, masked_key, fields_json, secret_fields_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, def.id, input.label, secrets['apiKey'] ? maskSecret(secrets['apiKey']) : null, JSON.stringify(plain), JSON.stringify(Object.keys(secrets)), now, now);
    } catch (e) {
      await this.vault.delete(vaultName(id));
      throw e;
    }
    this.activity.log('credential.created', `Credential "${input.label}" added for ${def.name}`, def.id);
    return { credential: this.get(id), warnings };
  }

  async update(id: string, input: UpdateCredentialInput): Promise<{ credential: CredentialSummary; warnings: string[] }> {
    const row = this.row(id);
    const { def } = this.registry.get(row.provider_id);

    if (input.label && input.label !== row.label) {
      const clash = this.db.prepare('SELECT 1 FROM credentials WHERE provider_id = ? AND label = ? AND id != ?').get(row.provider_id, input.label, id);
      if (clash) throw new AppError(409, 'label_exists', `${def.name} already has a credential named "${input.label}"`);
    }

    const { set, clear, warnings } = validateValues(def, input.values ?? {}, 'update');
    const { secrets: secretSet, plain: plainSet } = this.split(def, set);
    const secretKeys = new Set(def.fields.filter((f) => f.kind === 'secret').map((f) => f.key));

    const plain: Record<string, string> = { ...JSON.parse(row.fields_json), ...plainSet };
    for (const k of clear) if (!secretKeys.has(k)) delete plain[k];

    const oldRaw = await this.vault.get(vaultName(id));
    const secrets: Record<string, string> = { ...(oldRaw ? JSON.parse(oldRaw) : {}), ...secretSet };
    for (const k of clear) if (secretKeys.has(k)) delete secrets[k];

    const secretsChanged = Object.keys(secretSet).length > 0 || clear.some((k) => secretKeys.has(k));
    if (secretsChanged) {
      if (Object.keys(secrets).length) await this.vault.set(vaultName(id), JSON.stringify(secrets));
      else await this.vault.delete(vaultName(id));
    }
    const masked = secretsChanged ? (secrets['apiKey'] ? maskSecret(secrets['apiKey']) : null) : row.masked_key;
    try {
      this.db.prepare(
        `UPDATE credentials SET label = ?, masked_key = ?, fields_json = ?, secret_fields_json = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      ).run(input.label ?? row.label, masked, JSON.stringify(plain), JSON.stringify(Object.keys(secrets)), input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0, new Date().toISOString(), id);
    } catch (e) {
      if (secretsChanged) { // restore previous vault state
        if (oldRaw) await this.vault.set(vaultName(id), oldRaw); else await this.vault.delete(vaultName(id));
      }
      throw e;
    }
    if (secretsChanged || Object.keys(plainSet).length || clear.length) {
      this.db.prepare('DELETE FROM connection_checks WHERE credential_id = ?').run(id); // result no longer describes this credential
    }
    const what = input.enabled !== undefined && input.enabled !== (row.enabled === 1)
      ? (input.enabled ? 'enabled' : 'disabled')
      : secretsChanged ? 'secrets replaced' : 'updated';
    this.activity.log('credential.updated', `Credential "${input.label ?? row.label}" for ${def.name}: ${what}`, row.provider_id);
    return { credential: this.get(id), warnings };
  }

  async delete(id: string): Promise<void> {
    const row = this.row(id);
    this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM connection_checks WHERE credential_id = ?').run(id);
    await this.vault.delete(vaultName(id));
    this.activity.log('credential.deleted', `Credential "${row.label}" removed`, row.provider_id);
  }

  /** provider id → credential counts, including how many enabled credentials last tested OK / failed. */
  counts(): Map<string, { total: number; enabled: number; ok: number; bad: number }> {
    const rows = this.db.prepare(
      `SELECT c.provider_id AS p, COUNT(*) AS n, SUM(c.enabled) AS e,
              SUM(CASE WHEN c.enabled = 1 AND k.status = 'connected' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN c.enabled = 1 AND k.status = 'failed' THEN 1 ELSE 0 END) AS bad
       FROM credentials c LEFT JOIN connection_checks k ON k.credential_id = c.id GROUP BY c.provider_id`,
    ).all() as { p: string; n: number; e: number; ok: number; bad: number }[];
    return new Map(rows.map((r) => [r.p, { total: r.n, enabled: r.e, ok: r.ok, bad: r.bad }]));
  }
}
