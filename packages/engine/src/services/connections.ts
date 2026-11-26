import type { SecretStore } from '@cameleon/kit';
import type { TestDraftInput, TestResult } from '@cameleon/shared';
import { adapterFor } from '../adapters/index.js';
import type { Db } from '../db.js';
import { AppError } from '../errors.js';
import type { ProviderRegistry } from '../catalog/registry.js';
import type { ActivityService } from './activity.js';
import type { CredentialService } from './credentials.js';
import { validateValues } from './validation.js';

/** Live connection tests: before saving (draft) or against a stored credential (result persisted). */
export class ConnectionService {
  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private credentials: CredentialService,
    private activity: ActivityService,
  ) {}

  /** Test values the user is still typing. Nothing is stored; secrets live only for the duration of this call. */
  async testDraft(providerId: string, input: TestDraftInput): Promise<{ result: TestResult; warnings: string[] }> {
    const { def } = this.registry.get(providerId);
    const secretKeys = new Set(def.fields.filter((f) => f.kind === 'secret').map((f) => f.key));
    let fields: Record<string, string> = {};
    let secrets: Record<string, string> = {};
    let warnings: string[];

    if (input.credentialId) {
      const stored = this.credentials.get(input.credentialId);
      if (stored.providerId !== providerId) throw new AppError(400, 'provider_mismatch', 'Credential belongs to another provider');
      const v = validateValues(def, input.values, 'update');
      fields = { ...stored.fields };
      secrets = await this.credentials.getSecrets(input.credentialId);
      for (const [k, val] of Object.entries(v.set)) (secretKeys.has(k) ? secrets : fields)[k] = val;
      for (const k of v.clear) { delete fields[k]; delete secrets[k]; }
      warnings = v.warnings;
    } else {
      const v = validateValues(def, input.values, 'create');
      for (const [k, val] of Object.entries(v.set)) (secretKeys.has(k) ? secrets : fields)[k] = val;
      warnings = v.warnings;
    }
    const outcome = await adapterFor(def).test({ def, fields, secrets });
    return { result: { ...outcome, checkedAt: new Date().toISOString() }, warnings };
  }

  /** Test a stored credential and remember the outcome (drives the provider's connected / error status). */
  async testCredential(id: string): Promise<TestResult> {
    const cred = this.credentials.get(id);
    const { def } = this.registry.get(cred.providerId);
    const secrets = await this.credentials.getSecrets(id);
    const outcome = await adapterFor(def).test({ def, fields: cred.fields, secrets });
    const result: TestResult = { ...outcome, checkedAt: new Date().toISOString() };
    this.record(id, result);
    this.activity.log(
      'connection.tested',
      `${def.name} "${cred.label}": ${result.status === 'connected' ? `connected (${result.latencyMs} ms)` : result.status === 'failed' ? `failed — ${result.message}` : 'not testable'}`,
      def.id,
    );
    return result;
  }

  /** Persist a check outcome. `unsupported` clears any previous result instead of storing a non-answer. */
  record(credentialId: string, r: TestResult): void {
    if (r.status === 'unsupported') {
      this.db.prepare('DELETE FROM connection_checks WHERE credential_id = ?').run(credentialId);
      return;
    }
    this.db.prepare(
      `INSERT INTO connection_checks (credential_id, status, checked_at, latency_ms, http_status, message) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(credential_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at,
         latency_ms = excluded.latency_ms, http_status = excluded.http_status, message = excluded.message`,
    ).run(credentialId, r.status, r.checkedAt, r.latencyMs, r.httpStatus, r.message);
  }
}
export type { SecretStore };
