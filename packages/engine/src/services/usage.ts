import { randomUUID } from 'node:crypto';
import type { UsageRange, UsageSummary } from '@cameleon/shared';
import type { Db } from '../db.js';
import type { ProviderRegistry } from '../catalog/registry.js';

export interface RecordUsageInput {
  launchId: string | null;
  agentId: string;
  providerId: string;
  modelId: string;
  protocol: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  statusCode: number;
}

const MAX_USAGE_ROWS = 50_000;

/** Stores and aggregates per-model token consumption captured from metered agent API traffic. */
export class UsageService {
  constructor(private db: Db, private registry: ProviderRegistry) {}

  record(input: RecordUsageInput): void {
    const inTok = Math.max(0, Math.round(input.inputTokens));
    const outTok = Math.max(0, Math.round(input.outputTokens));
    const cacheRead = Math.max(0, Math.round(input.cacheReadTokens ?? 0));
    const cacheWrite = Math.max(0, Math.round(input.cacheWriteTokens ?? 0));
    const total = Math.max(0, Math.round(input.totalTokens ?? inTok + outTok));

    this.db.prepare(
      `INSERT INTO token_usage
         (id, launch_id, agent_id, provider_id, model_id, protocol,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          total_tokens, latency_ms, status_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.launchId,
      input.agentId,
      input.providerId,
      input.modelId,
      input.protocol,
      inTok,
      outTok,
      cacheRead,
      cacheWrite,
      total,
      Math.max(0, Math.round(input.latencyMs)),
      input.statusCode,
      new Date().toISOString(),
    );

    // Keep table bounded on long-lived installations
    this.db.prepare(
      `DELETE FROM token_usage WHERE id NOT IN (SELECT id FROM token_usage ORDER BY created_at DESC LIMIT ?)`,
    ).run(MAX_USAGE_ROWS);
  }

  private cutoffIso(range: UsageRange): string | null {
    if (range === 'all') return null;
    const days = range === '7d' ? 7 : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  summary(range: UsageRange = '7d'): UsageSummary {
    const cutoff = this.cutoffIso(range);
    const where = cutoff ? 'WHERE created_at >= ?' : '';
    const params = cutoff ? [cutoff] : [];

    const tot = this.db.prepare(
      `SELECT
         COUNT(*) AS requests,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
         COALESCE(SUM(total_tokens), 0) AS totalTokens,
         COALESCE(AVG(latency_ms), 0) AS avgLatencyMs
       FROM token_usage ${where}`,
    ).get(...params) as {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      avgLatencyMs: number;
    };

    const modelRows = this.db.prepare(
      `SELECT
         provider_id AS providerId,
         model_id AS modelId,
         COUNT(*) AS requests,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
         COALESCE(SUM(total_tokens), 0) AS totalTokens,
         COALESCE(AVG(latency_ms), 0) AS avgLatencyMs,
         MAX(created_at) AS lastUsedAt
       FROM token_usage ${where}
       GROUP BY provider_id, model_id
       ORDER BY totalTokens DESC, requests DESC`,
    ).all(...params) as {
      providerId: string;
      modelId: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      avgLatencyMs: number;
      lastUsedAt: string;
    }[];

    const byModel = modelRows.map((r) => ({
      ...r,
      avgLatencyMs: Math.round(r.avgLatencyMs),
      providerName: this.registry.has(r.providerId) ? this.registry.get(r.providerId).def.name : r.providerId,
    }));

    const byAgent = this.db.prepare(
      `SELECT
         agent_id AS agentId,
         COUNT(*) AS requests,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(total_tokens), 0) AS totalTokens
       FROM token_usage ${where}
       GROUP BY agent_id
       ORDER BY totalTokens DESC`,
    ).all(...params) as {
      agentId: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }[];

    const recent = this.db.prepare(
      `SELECT
         id,
         agent_id AS agentId,
         provider_id AS providerId,
         model_id AS modelId,
         protocol,
         input_tokens AS inputTokens,
         output_tokens AS outputTokens,
         total_tokens AS totalTokens,
         latency_ms AS latencyMs,
         status_code AS statusCode,
         created_at AS createdAt
       FROM token_usage ${where}
       ORDER BY created_at DESC
       LIMIT 40`,
    ).all(...params) as {
      id: string;
      agentId: string;
      providerId: string;
      modelId: string;
      protocol: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      latencyMs: number;
      statusCode: number;
      createdAt: string;
    }[];

    return {
      range,
      totals: {
        requests: tot.requests,
        inputTokens: tot.inputTokens,
        outputTokens: tot.outputTokens,
        cacheReadTokens: tot.cacheReadTokens,
        cacheWriteTokens: tot.cacheWriteTokens,
        totalTokens: tot.totalTokens,
        avgLatencyMs: Math.round(tot.avgLatencyMs),
      },
      byModel,
      byAgent,
      recent,
    };
  }

  clear(): number {
    const res = this.db.prepare('DELETE FROM token_usage').run();
    return res.changes;
  }
}
