import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { UsageService } from '../services/usage.js';

export interface MeterRoute {
  upstreamBaseUrl: string;
  launchId: string | null;
  agentId: string;
  providerId: string;
  modelId: string;
  protocol: string;
}

export interface ParsedTokenUsage {
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  hasUsage: boolean;
}

/**
 * Join an upstream provider base URL with the suffix path+query received after `/m/<token>`.
 * Avoids duplicate `/v1` when `upstreamBaseUrl` already ends with `/v1` and the client sends `/v1/...`.
 */
export function joinUpstreamUrl(upstreamBase: string, suffixPathAndQuery: string): string {
  const base = upstreamBase.replace(/\/+$/, '');
  const qIdx = suffixPathAndQuery.indexOf('?');
  const rawPath = qIdx === -1 ? suffixPathAndQuery : suffixPathAndQuery.slice(0, qIdx);
  const query = qIdx === -1 ? '' : suffixPathAndQuery.slice(qIdx);
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  if (base.endsWith('/v1') && (path === '/v1' || path.startsWith('/v1/'))) {
    path = path.slice(3) || '';
  }
  return `${base}${path}${query}`;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function applyJsonUsageObject(obj: Record<string, unknown>, acc: ParsedTokenUsage): void {
  if (typeof obj['model'] === 'string' && obj['model']) {
    acc.modelId = obj['model'];
  } else if (!acc.modelId && typeof obj['modelVersion'] === 'string' && obj['modelVersion']) {
    acc.modelId = obj['modelVersion'];
  }
  for (const nestedKey of ['message', 'response', 'x_groq'] as const) {
    const nested = obj[nestedKey];
    if (nested && typeof nested === 'object') {
      applyJsonUsageObject(nested as Record<string, unknown>, acc);
    }
  }

  // OpenAI / Anthropic / Groq usage object
  const usage = obj['usage'];
  if (usage && typeof usage === 'object') {
    const u = usage as Record<string, unknown>;
    const inTok = num(u['input_tokens']) || num(u['prompt_tokens']);
    const outTok = num(u['output_tokens']) || num(u['completion_tokens']);
    const promptDetails = u['prompt_tokens_details'] as Record<string, unknown> | undefined;
    const inputDetails = u['input_tokens_details'] as Record<string, unknown> | undefined;
    const cacheRead =
      num(u['cache_read_input_tokens']) ||
      num(promptDetails?.['cached_tokens']) ||
      num(inputDetails?.['cached_tokens']);
    const cacheWrite = num(u['cache_creation_input_tokens']);
    const tot = num(u['total_tokens']);
    if (inTok > 0) acc.inputTokens = Math.max(acc.inputTokens, inTok);
    if (outTok > 0) acc.outputTokens = Math.max(acc.outputTokens, outTok);
    if (cacheRead > 0) acc.cacheReadTokens = Math.max(acc.cacheReadTokens, cacheRead);
    if (cacheWrite > 0) acc.cacheWriteTokens = Math.max(acc.cacheWriteTokens, cacheWrite);
    if (tot > 0) acc.totalTokens = Math.max(acc.totalTokens, tot);
    if ('input_tokens' in u || 'prompt_tokens' in u || 'output_tokens' in u || 'completion_tokens' in u) {
      acc.hasUsage = true;
    }
  }

  // Gemini usageMetadata object
  const gem = obj['usageMetadata'];
  if (gem && typeof gem === 'object') {
    const g = gem as Record<string, unknown>;
    const inTok = num(g['promptTokenCount']);
    const outTok = num(g['candidatesTokenCount']);
    const cacheRead = num(g['cachedContentTokenCount']);
    const tot = num(g['totalTokenCount']);
    if (inTok > 0) acc.inputTokens = Math.max(acc.inputTokens, inTok);
    if (outTok > 0) acc.outputTokens = Math.max(acc.outputTokens, outTok);
    if (cacheRead > 0) acc.cacheReadTokens = Math.max(acc.cacheReadTokens, cacheRead);
    if (tot > 0) acc.totalTokens = Math.max(acc.totalTokens, tot);
    if ('promptTokenCount' in g || 'candidatesTokenCount' in g) acc.hasUsage = true;
  }

  // Ollama native /api/chat and /api/generate counters
  if ('prompt_eval_count' in obj || 'eval_count' in obj) {
    const inTok = num(obj['prompt_eval_count']);
    const outTok = num(obj['eval_count']);
    if (inTok > 0) acc.inputTokens = Math.max(acc.inputTokens, inTok);
    if (outTok > 0) acc.outputTokens = Math.max(acc.outputTokens, outTok);
    acc.hasUsage = true;
  }
}

/**
 * Extract token consumption from either a single JSON response body or an SSE stream
 * (`data: {...}` lines from Anthropic Messages, OpenAI Chat/Responses, or Gemini).
 */
export function extractUsageFromPayload(text: string): ParsedTokenUsage {
  const acc: ParsedTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    hasUsage: false,
  };

  const trimmed = text.trim();
  if (!trimmed) return acc;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') applyJsonUsageObject(parsed as Record<string, unknown>, acc);
    } catch {
      /* ignore malformed JSON */
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr) as unknown;
        if (parsed && typeof parsed === 'object') applyJsonUsageObject(parsed as Record<string, unknown>, acc);
      } catch {
        /* ignore partial/non-JSON SSE line */
      }
    }
  }

  if (acc.totalTokens === 0 && (acc.inputTokens > 0 || acc.outputTokens > 0)) {
    acc.totalTokens = acc.inputTokens + acc.outputTokens;
  }
  return acc;
}

function mergeUsage(acc: ParsedTokenUsage | null, part: ParsedTokenUsage): ParsedTokenUsage {
  if (!acc) return { ...part };
  if (part.modelId) acc.modelId = part.modelId;
  acc.inputTokens = Math.max(acc.inputTokens, part.inputTokens);
  acc.outputTokens = Math.max(acc.outputTokens, part.outputTokens);
  acc.cacheReadTokens = Math.max(acc.cacheReadTokens, part.cacheReadTokens);
  acc.cacheWriteTokens = Math.max(acc.cacheWriteTokens, part.cacheWriteTokens);
  acc.totalTokens = Math.max(acc.totalTokens, part.totalTokens);
  acc.hasUsage = acc.hasUsage || part.hasUsage;
  return acc;
}

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'accept-encoding',
]);

const MAX_ROUTES = 500;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/**
 * Lightweight local HTTP reverse-proxy bound to 127.0.0.1.
 * Forwards agent API requests to the real provider endpoint transparently, streams SSE/JSON
 * back in real time, and extracts token counts into `UsageService` without storing prompts or keys.
 */
export class MeterProxy {
  private server: http.Server | null = null;
  private port = 0;
  private routes = new Map<string, MeterRoute>();

  constructor(private usage: UsageService) {}

  get isRunning(): boolean {
    return this.port > 0;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const srv = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = srv;
    this.port = (srv.address() as { port: number }).port;
    return this.port;
  }

  register(route: MeterRoute): string {
    if (!this.port) throw new Error('MeterProxy not started');
    if (this.routes.size >= MAX_ROUTES) {
      const oldest = this.routes.keys().next().value;
      if (oldest) this.routes.delete(oldest);
    }
    const token = randomBytes(16).toString('hex');
    this.routes.set(token, route);
    return `http://127.0.0.1:${this.port}/m/${token}`;
  }

  private handle(clientReq: IncomingMessage, clientRes: ServerResponse): void {
    const rawUrl = clientReq.url ?? '/';
    const match = /^\/m\/([a-f0-9]{32})(\/.*|\?.*)?$/i.exec(rawUrl);
    if (!match) {
      clientRes.writeHead(404, { 'content-type': 'application/json' });
      clientRes.end('{"error":"unknown_meter_route"}');
      return;
    }

    const token = match[1]!;
    const suffix = match[2] ?? '';
    const route = this.routes.get(token);
    if (!route) {
      clientRes.writeHead(404, { 'content-type': 'application/json' });
      clientRes.end('{"error":"expired_meter_route"}');
      return;
    }

    const targetUrlStr = joinUpstreamUrl(route.upstreamBaseUrl, suffix);
    let targetUrl: URL;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      clientRes.writeHead(400, { 'content-type': 'application/json' });
      clientRes.end('{"error":"invalid_upstream_url"}');
      return;
    }

    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(clientReq.headers)) {
      if (!v || HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    headers['host'] = targetUrl.host;
    // Request uncompressed payloads so SSE/JSON token usage can be parsed without modifying streams
    headers['accept-encoding'] = 'identity';

    const canInjectStreamUsage =
      (clientReq.method ?? 'GET').toUpperCase() === 'POST' &&
      route.protocol === 'openai' &&
      /\/chat\/completions(\?.*)?$/i.test(suffix) &&
      String(clientReq.headers['content-type'] ?? '').toLowerCase().includes('application/json') &&
      route.providerId !== 'perplexity' &&
      route.providerId !== 'custom-openai';

    const forwardRequest = (bodyBuf?: Buffer) => {
      if (bodyBuf) {
        delete headers['content-length'];
        headers['content-length'] = String(bodyBuf.length);
      }

      const startedAt = Date.now();
      const transport = targetUrl.protocol === 'https:' ? https : http;
      const upReq = transport.request(
        targetUrl,
        {
          method: clientReq.method ?? 'POST',
          headers,
        },
        (upRes) => {
          const resHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(upRes.headers)) {
            if (!v || k.toLowerCase() === 'transfer-encoding' || k.toLowerCase() === 'connection') continue;
            resHeaders[k] = v;
          }
          const statusCode = upRes.statusCode ?? 200;
          clientRes.writeHead(statusCode, resHeaders);

          // Track SSE tail / JSON body up to MAX_CAPTURE_BYTES so streams never blow up memory
          const chunks: Buffer[] = [];
          let captured = 0;
          let sseAcc: ParsedTokenUsage | null = null;
          const isSse = String(upRes.headers['content-type'] ?? '').includes('text/event-stream');
          let sseCarry = '';

          upRes.on('data', (chunk: Buffer) => {
            clientRes.write(chunk);
            if (isSse) {
              const text = sseCarry + chunk.toString('utf8');
              const lastNl = text.lastIndexOf('\n');
              const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
              sseCarry = lastNl === -1 ? text : text.slice(lastNl + 1);
              if (complete) {
                sseAcc = mergeUsage(sseAcc, extractUsageFromPayload(complete));
              }
            } else if (captured < MAX_CAPTURE_BYTES) {
              const slice = chunk.subarray(0, MAX_CAPTURE_BYTES - captured);
              chunks.push(slice);
              captured += slice.length;
            }
          });

          upRes.on('end', () => {
            clientRes.end();
            let parsed: ParsedTokenUsage;
            if (isSse) {
              if (sseCarry) {
                sseAcc = mergeUsage(sseAcc, extractUsageFromPayload(sseCarry));
              }
              parsed = sseAcc ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, hasUsage: false };
              if (parsed.totalTokens === 0 && (parsed.inputTokens > 0 || parsed.outputTokens > 0)) {
                parsed.totalTokens = parsed.inputTokens + parsed.outputTokens;
              }
            } else {
              parsed = extractUsageFromPayload(Buffer.concat(chunks).toString('utf8'));
            }

            // Only record inference calls (requests that produced usage or hit completion/message endpoints)
            const isModelCall = parsed.hasUsage || /\/(messages|chat\/completions|completions|responses|generateContent|api\/chat|api\/generate)/i.test(suffix);
            if (isModelCall && (parsed.hasUsage || statusCode >= 400)) {
              try {
                this.usage.record({
                  launchId: route.launchId,
                  agentId: route.agentId,
                  providerId: route.providerId,
                  modelId: parsed.modelId || route.modelId,
                  protocol: route.protocol,
                  inputTokens: parsed.inputTokens,
                  outputTokens: parsed.outputTokens,
                  cacheReadTokens: parsed.cacheReadTokens,
                  cacheWriteTokens: parsed.cacheWriteTokens,
                  totalTokens: parsed.totalTokens,
                  latencyMs: Date.now() - startedAt,
                  statusCode,
                });
              } catch {
                /* ignore DB errors if engine is closing */
              }
            }
          });
        },
      );

      upReq.on('error', (err) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'content-type': 'application/json' });
        }
        clientRes.end(JSON.stringify({ error: { message: `Upstream error: ${err.message}` } }));
      });

      if (bodyBuf) {
        upReq.end(bodyBuf);
      } else {
        clientReq.pipe(upReq);
      }
    };

    const contentLen = Number(clientReq.headers['content-length'] ?? '0');
    if (canInjectStreamUsage && Number.isFinite(contentLen) && contentLen > 0 && contentLen <= 4 * 1024 * 1024) {
      const reqChunks: Buffer[] = [];
      clientReq.on('data', (c: Buffer) => {
        reqChunks.push(c);
      });
      clientReq.on('end', () => {
        const raw = Buffer.concat(reqChunks);
        if (raw.length > 0) {
          try {
            const obj = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
            if (obj && typeof obj === 'object' && obj['stream'] === true && obj['stream_options'] === undefined) {
              obj['stream_options'] = { include_usage: true };
              forwardRequest(Buffer.from(JSON.stringify(obj), 'utf8'));
              return;
            }
          } catch {
            /* forward raw body as-is */
          }
        }
        forwardRequest(raw);
      });
      return;
    }

    forwardRequest();
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.port = 0;
    this.routes.clear();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}
