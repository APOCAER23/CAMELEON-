import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { createRequestGuard } from '@cameleon/kit';
import {
  APP_VERSION, CompatQuery, CustomAgentInput, FinishLaunchInput, LaunchRequest, ProfileInput, CreateCredentialInput, ManualModelInput, ModelQuery, ProviderCategory, SyncInput, TestDraftInput, UpdateCredentialInput, UsageRange, type StatusResponse,
} from '@cameleon/shared';
import type { EngineContext } from './context.js';
import { AppError } from './errors.js';
import { runDiagnostics } from './services/diagnostics.js';

export interface AppOptions {
  token: string;
  /** Port the server is (or will be) bound to — used for Host-header validation. */
  getPort: () => number;
  onShutdown: () => void;
  logger?: boolean;
}

const ListQuery = z.object({ category: ProviderCategory.optional(), q: z.string().max(80).optional() });
const CredQuery = z.object({ providerId: z.string().max(60).optional() });
const ActivityQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });
const IdParam = z.object({ id: z.string().min(1).max(80) });
const ModelKey = z.object({ providerId: z.string().max(60), modelId: z.string().min(1).max(200) });
const heavy = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export async function buildApp(ctx: EngineContext, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1024, // 64 KiB — more than enough for any config payload
    logger: opts.logger ? { level: 'info', redact: ['req.headers.authorization'] } : false,
    trustProxy: false,
  });

  // Order matters: rate-limit first so failed-token guessing is throttled too.
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  const guard = createRequestGuard({
    token: opts.token,
    allowedHosts: () => {
      const p = opts.getPort();
      return [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`];
    },
    publicPaths: ['/health'],
  });
  app.addHook('onRequest', async (req, reply) => {
    const r = guard({ url: req.url, headers: req.headers });
    if (!r.ok) return reply.code(r.status).send({ error: { code: r.code, message: r.message } });
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }));
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'Invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) } });
    }
    // Fastify's own errors: never echo parser messages (they can quote the request body).
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: { code: 'body_too_large', message: 'Request body too large' } });
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: err.statusCode === 429 ? 'Too many requests' : 'Invalid request' } });
    }
    req.log.error({ errName: err?.name }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal engine error' } });
  });

  /* ───── routes ───── */

  app.get('/health', async () => ({ ok: true as const, service: 'cameleon-engine', version: APP_VERSION }));

  app.get('/v1/status', async (): Promise<StatusResponse> => {
    const providers = ctx.providers.list();
    const creds = ctx.credentials.list();
    const models = ctx.models.count();
    return {
      engine: { version: APP_VERSION, pid: process.pid, startedAt: ctx.startedAt, uptimeSec: Math.round((Date.now() - Date.parse(ctx.startedAt)) / 1000) },
      vault: ctx.vaultInfo,
      database: { path: ctx.dbPath, schemaVersion: ctx.schemaVersion },
      counts: {
        providersTotal: providers.length,
        providersConfigured: providers.filter((p) => p.status === 'configured' || p.status === 'connected' || p.status === 'error').length,
        providersConnected: providers.filter((p) => p.status === 'connected').length,
        credentials: creds.length,
        models,
      },
      host: { platform: process.platform, node: process.version },
      catalog: { providers: providers.length, userFiles: ctx.catalog.userFiles, invalidFiles: ctx.catalog.invalidFiles },
    };
  });

  app.get('/v1/providers', async (req) => ctx.providers.list(ListQuery.parse(req.query)));
  app.get('/v1/providers/:id', async (req) => ctx.providers.get(IdParam.parse(req.params).id));

  app.get('/v1/credentials', async (req) => ctx.credentials.list(CredQuery.parse(req.query).providerId));
  app.post('/v1/credentials', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const res = await ctx.credentials.create(CreateCredentialInput.parse(req.body));
    return reply.code(201).send(res);
  });
  app.patch('/v1/credentials/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    ctx.credentials.update(IdParam.parse(req.params).id, UpdateCredentialInput.parse(req.body)),
  );
  app.delete('/v1/credentials/:id', async (req) => {
    await ctx.credentials.delete(IdParam.parse(req.params).id);
    return { deleted: true as const };
  });

  app.post('/v1/providers/:id/test', heavy, async (req) => {
    const { result, warnings } = await ctx.connections.testDraft(IdParam.parse(req.params).id, TestDraftInput.parse(req.body));
    return { ...result, ...(warnings.length ? { warnings } : {}) };
  });
  app.post('/v1/credentials/:id/test', heavy, async (req) => ctx.connections.testCredential(IdParam.parse(req.params).id));

  app.get('/v1/models', async (req) => ctx.models.list(ModelQuery.parse(req.query)));
  app.get('/v1/models/detail', async (req) => {
    const k = ModelKey.parse(req.query);
    return ctx.models.get(k.providerId, k.modelId);
  });
  app.post('/v1/models', async (req, reply) => reply.code(201).send(ctx.models.addManual(ManualModelInput.parse(req.body))));
  app.delete('/v1/models', async (req) => {
    const k = ModelKey.parse(req.query);
    ctx.models.deleteManual(k.providerId, k.modelId);
    return { deleted: true as const };
  });
  app.post('/v1/models/sync', heavy, async (req) => {
    const { providerId } = SyncInput.parse(req.body ?? {});
    return providerId ? [await ctx.models.sync(providerId)] : ctx.models.syncAll();
  });

  app.delete('/v1/models/cache', async () => ({ removed: ctx.models.clearCache() }));
  app.get('/v1/models/compat', async (req) => {
    const k = ModelKey.parse(req.query);
    ctx.models.get(k.providerId, k.modelId);
    return ctx.launcher.modelCompat(k.providerId, k.modelId);
  });

  app.get('/v1/agents', async (req) => ctx.launcher.agents(z.object({ refresh: z.string().optional() }).parse(req.query).refresh === '1'));
  app.post('/v1/custom-agents', async (req, reply) => reply.code(201).send(await ctx.launcher.createCustomAgent(CustomAgentInput.parse(req.body))));
  app.delete('/v1/custom-agents/:id', async (req) => {
    ctx.launcher.deleteCustomAgent(IdParam.parse(req.params).id);
    return { deleted: true as const };
  });
  app.get('/v1/compat', async (req) => ctx.launcher.compatList(CompatQuery.parse(req.query)));

  // Inspect = same plan with secrets masked (safe for UIs). Prepare = real secrets, for the CLI launcher only.
  app.post('/v1/launch/inspect', heavy, async (req) => ctx.launcher.plan(LaunchRequest.parse(req.body), { mask: true, record: false }));
  app.post('/v1/launch/prepare', heavy, async (req) => ctx.launcher.plan(LaunchRequest.parse(req.body), { mask: false, record: true }));
  app.post('/v1/launch/:id/finish', async (req) => {
    ctx.launcher.finish(IdParam.parse(req.params).id, FinishLaunchInput.parse(req.body));
    return { ok: true as const };
  });
  app.get('/v1/launches', async (req) => ctx.launcher.recent(ActivityQuery.parse(req.query).limit));

  app.get('/v1/profiles', async () => ctx.profiles.list());
  app.get('/v1/profiles/active', async () => ctx.profiles.active());
  app.post('/v1/profiles/activate', async (req) => {
    ctx.profiles.activate(z.object({ id: z.string().max(80).nullable() }).parse(req.body).id);
    return { ok: true as const };
  });
  app.post('/v1/profiles', async (req, reply) => reply.code(201).send(ctx.profiles.create(ProfileInput.parse(req.body))));
  app.patch('/v1/profiles/:id', async (req) => ctx.profiles.update(IdParam.parse(req.params).id, ProfileInput.partial().parse(req.body)));
  app.delete('/v1/profiles/:id', async (req) => {
    ctx.profiles.delete(IdParam.parse(req.params).id);
    return { deleted: true as const };
  });

  app.get('/v1/diagnostics', async () => runDiagnostics(ctx));

  app.post('/v1/custom-providers', async (req, reply) => reply.code(201).send(ctx.providers.createCustom(req.body)));
  app.delete('/v1/custom-providers/:id', async (req) => {
    ctx.providers.deleteCustom(IdParam.parse(req.params).id);
    return { deleted: true as const };
  });

  app.get('/v1/activity', async (req) => ctx.activity.list(ActivityQuery.parse(req.query).limit));
  app.get('/v1/usage', async (req) => {
    const q = z.object({ range: UsageRange.default('7d') }).parse(req.query);
    return ctx.usage.summary(q.range);
  });
  app.delete('/v1/usage', async () => ({ deleted: ctx.usage.clear() }));

  app.post('/v1/engine/shutdown', async () => {
    setImmediate(opts.onShutdown);
    return { ok: true as const };
  });

  return app;
}
