import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getAppPaths } from '@cameleon/kit';
import { createEngineClient, EngineError } from '@cameleon/shared';
import { startEngine } from './index.js';

process.env['CAMELEON_HTTP_TIMEOUT_MS'] = '400';

/* ───────── tiny fake provider server ───────── */
type Handler = (req: http.IncomingMessage, url: URL, res: http.ServerResponse, body: string) => void;
async function fake(handler: Handler) {
  const hits: { method: string; path: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      hits.push({ method: req.method!, path: url.pathname + url.search, headers: req.headers });
      handler(req, url, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function withEngine<T>(fn: (api: ReturnType<typeof createEngineClient>, eng: Awaited<ReturnType<typeof startEngine>>) => Promise<T>) {
  const paths = getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'p2-')) } });
  const eng = await startEngine({ paths, forceFileVault: true });
  try {
    return await fn(createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token }), eng);
  } finally {
    await eng.close();
  }
}

const GOOD = 'sk-or-v1-GOODKEYGOODKEYGOODKEY0001';

/* ───────── OpenRouter ───────── */
const orModels = {
  data: [
    {
      id: 'vendor/smart', name: 'Vendor: Smart', description: 'A smart model', context_length: 200000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0.000003', completion: '0.000015' },
      top_provider: { max_completion_tokens: 8192 },
      supported_parameters: ['tools', 'reasoning', 'temperature'],
    },
    { id: 'vendor/plain', name: 'Vendor: Plain', context_length: 8000, pricing: { prompt: '-1', completion: '-1' } },
    { id: 'vendor/embed', name: 'Embedder', architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] }, supported_parameters: [] },
  ],
};
const orHandler = (state: { models: unknown }): Handler => (req, url, res) => {
  if (url.pathname === '/api/v1/auth/key') {
    return req.headers.authorization === `Bearer ${GOOD}` ? send(res, 200, { data: { label: 'x' } })
      : send(res, 401, { error: { message: `Incorrect API key provided: ${String(req.headers.authorization).slice(7)}` } });
  }
  if (url.pathname === '/api/v1/models') return send(res, 200, state.models);
  send(res, 404, {});
};

test('openrouter: draft test, status, discovery mapping, sync semantics, offline cache', async () => {
  const state = { models: orModels as unknown };
  const srv = await fake(orHandler(state));
  const base = `${srv.url}/api/v1`;
  await withEngine(async (api, eng) => {
    // draft test: good key
    const ok = await api.testDraft('openrouter', { values: { apiKey: GOOD, baseUrl: base } });
    assert.equal(ok.status, 'connected');
    assert.equal(typeof ok.latencyMs, 'number');
    // draft test: bad key — provider echoes the key in its error; it must be scrubbed
    const BAD = 'totally-custom-format-key-123456';
    const bad = await api.testDraft('openrouter', { values: { apiKey: BAD, baseUrl: base } });
    assert.equal(bad.status, 'failed');
    assert.equal(bad.errorKind, 'auth');
    assert.ok(!bad.message.includes(BAD), bad.message);
    assert.ok(bad.warnings?.some((w) => w.includes('sk-or-')));
    // nothing was stored by draft tests
    assert.equal((await api.credentials()).length, 0);

    // stored credential → persisted check → provider status
    const { credential } = await api.createCredential({ providerId: 'openrouter', label: 'w', values: { apiKey: GOOD, baseUrl: base } });
    assert.equal((await api.providers()).find((p) => p.id === 'openrouter')!.status, 'configured');
    const t = await api.testCredential(credential.id);
    assert.equal(t.status, 'connected');
    assert.equal((await api.providers()).find((p) => p.id === 'openrouter')!.status, 'connected');
    assert.equal((await api.credentials('openrouter'))[0]!.lastCheck?.status, 'connected');

    // sync + mapping
    const [r] = await api.syncModels({ providerId: 'openrouter' });
    assert.deepEqual([r!.ok, r!.count, r!.added, r!.removed], [true, 3, 3, 0]);
    const smart = await api.model('openrouter', 'vendor/smart');
    assert.equal(smart.contextWindow, 200000);
    assert.equal(smart.maxOutputTokens, 8192);
    assert.deepEqual(smart.pricing, { inputPerMTok: 3, outputPerMTok: 15, currency: 'USD', source: 'OpenRouter /models' });
    assert.equal(smart.capabilities.toolCalling, 'supported');
    assert.equal(smart.capabilities.reasoning, 'supported');
    assert.equal(smart.capabilities.vision, 'supported');
    assert.equal(smart.capabilities.structuredOutput, 'unsupported');
    assert.equal(smart.kind, 'chat');
    const plain = await api.model('openrouter', 'vendor/plain');
    assert.equal(plain.capabilities.toolCalling, 'unknown'); // supported_parameters absent → never guessed
    assert.equal(plain.capabilities.vision, 'unknown');
    assert.equal(plain.pricing?.inputPerMTok, null); // "-1" = variable pricing
    assert.equal((await api.model('openrouter', 'vendor/embed')).kind, 'embedding');
    assert.equal((await api.providers()).find((p) => p.id === 'openrouter')!.modelCount, 3);

    // filters
    assert.deepEqual((await api.models({ capabilities: 'tools' })).map((m) => m.modelId), ['vendor/smart']);
    assert.deepEqual((await api.models({ capabilities: 'vision,reasoning' })).map((m) => m.modelId), ['vendor/smart']);
    assert.equal((await api.models({ chatOnly: '1' })).length, 2);
    assert.deepEqual((await api.models({ q: 'EMBED' })).map((m) => m.modelId), ['vendor/embed']);
    await assert.rejects(api.models({ capabilities: 'telepathy' }), (e: EngineError) => e.status === 400);

    // manual model survives syncs; catalog models cannot be deleted manually
    await api.addModel({ providerId: 'openrouter', modelId: 'my/private', contextWindow: 32000, capabilities: { toolCalling: 'supported' } });
    await assert.rejects(api.addModel({ providerId: 'openrouter', modelId: 'vendor/smart' }), (e: EngineError) => e.status === 409);
    await assert.rejects(api.deleteModel('openrouter', 'vendor/smart'), (e: EngineError) => e.status === 403);
    state.models = { data: [orModels.data[0]!] }; // two models disappear upstream
    const [r2] = await api.syncModels({ providerId: 'openrouter' });
    assert.deepEqual([r2!.count, r2!.added, r2!.removed], [1, 0, 2]);
    assert.deepEqual((await api.models()).map((m) => m.modelId).sort(), ['my/private', 'vendor/smart']);

    // empty answer must not wipe the cache
    state.models = { data: [] };
    const [r3] = await api.syncModels({ providerId: 'openrouter' });
    assert.equal(r3!.ok, false);
    assert.equal((await api.models()).length, 2);

    // provider offline → sync fails gracefully, cache intact
    await srv.close();
    const [r4] = await api.syncModels({ providerId: 'openrouter' });
    assert.equal(r4!.ok, false);
    assert.match(r4!.error!, /cached models were kept/);
    assert.equal((await api.models()).length, 2);

    // changing the credential invalidates its last check
    await api.updateCredential(credential.id, { values: { apiKey: 'sk-or-v1-ANOTHERKEYANOTHERKEY0002' } });
    assert.equal((await api.credentials('openrouter'))[0]!.lastCheck, null);

    // activity never contains key material
    const log = JSON.stringify(await api.activity(200));
    assert.ok(!log.includes('GOODKEY') && !log.includes('ANOTHERKEY'));
    void eng;
  });
});

/* ───────── Anthropic (pagination, headers, capabilities) ───────── */
test('anthropic: headers, pagination, capability mapping, failure kinds', async () => {
  const KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEY';
  const srv = await fake((req, url, res) => {
    if (req.headers['x-api-key'] !== KEY) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    if (req.headers['anthropic-version'] !== '2023-06-01') return send(res, 400, {});
    if (url.pathname !== '/v1/models') return send(res, 404, {});
    if (url.searchParams.get('after_id') === 'm2') {
      return send(res, 200, { data: [{ id: 'm3', display_name: 'Model 3' }], has_more: false, last_id: 'm3' });
    }
    if (url.searchParams.get('limit') === '1') return send(res, 200, { data: [{ id: 'm1' }], has_more: true, last_id: 'm1' });
    send(res, 200, {
      data: [
        { id: 'm1', display_name: 'Model 1', max_input_tokens: 200000, max_tokens: 64000, capabilities: { image_input: { supported: true }, thinking: { supported: false }, structured_outputs: { supported: true } } },
        { id: 'm2', display_name: 'Model 2' },
      ],
      has_more: true, last_id: 'm2',
    });
  });
  await withEngine(async (api) => {
    assert.equal((await api.testDraft('anthropic', { values: { apiKey: KEY, baseUrl: srv.url } })).status, 'connected');
    const bad = await api.testDraft('anthropic', { values: { apiKey: 'sk-ant-wrongwrongwrong', baseUrl: srv.url } });
    assert.equal(bad.errorKind, 'auth');

    await api.createCredential({ providerId: 'anthropic', values: { apiKey: KEY, baseUrl: srv.url } });
    const [r] = await api.syncModels({ providerId: 'anthropic' });
    assert.deepEqual([r!.ok, r!.count], [true, 3]); // two pages followed
    const m1 = await api.model('anthropic', 'm1');
    assert.equal(m1.contextWindow, 200000);
    assert.equal(m1.maxOutputTokens, 64000);
    assert.equal(m1.capabilities.vision, 'supported');
    assert.equal(m1.capabilities.reasoning, 'unsupported');
    assert.equal(m1.capabilities.structuredOutput, 'supported');
    assert.equal(m1.capabilities.toolCalling, 'unknown'); // not reported → unknown
    assert.equal(m1.capabilities.streaming, 'supported');
    assert.equal((await api.model('anthropic', 'm2')).contextWindow, null);
    assert.equal(m1.pricing, null);
  });
  await srv.close();
});

/* ───────── Ollama (no key, enrichment via /api/show) ───────── */
test('ollama: version test, tags + show enrichment tolerating failures', async () => {
  const srv = await fake((req, url, res, body) => {
    if (url.pathname === '/api/version') return send(res, 200, { version: '0.9.1' });
    if (url.pathname === '/api/tags') {
      return send(res, 200, { models: [
        { name: 'llama3:8b', details: { family: 'llama', parameter_size: '8.0B', quantization_level: 'Q4_0' } },
        { name: 'nomic-embed-text:latest', details: {} },
        { name: 'broken:1b', details: {} },
      ] });
    }
    if (url.pathname === '/api/show') {
      const m = JSON.parse(body).model;
      if (m === 'broken:1b') return send(res, 500, { error: 'boom' });
      if (m === 'llama3:8b') return send(res, 200, { capabilities: ['completion', 'tools'], model_info: { 'llama.context_length': 8192 } });
      return send(res, 200, { capabilities: ['embedding'], model_info: { 'nomic-bert.context_length': 2048 } });
    }
    send(res, 404, {});
  });
  await withEngine(async (api) => {
    const t = await api.testDraft('ollama', { values: { baseUrl: srv.url } });
    assert.equal(t.status, 'connected');
    assert.match(t.message, /0\.9\.1/);
    await api.createCredential({ providerId: 'ollama', values: { baseUrl: srv.url } });
    const [r] = await api.syncModels({ providerId: 'ollama' });
    assert.deepEqual([r!.ok, r!.count], [true, 3]);
    const llama = await api.model('ollama', 'llama3:8b');
    assert.equal(llama.contextWindow, 8192);
    assert.equal(llama.capabilities.toolCalling, 'supported');
    assert.equal(llama.capabilities.vision, 'unsupported');
    assert.equal(llama.description, 'llama · 8.0B · Q4_0');
    assert.equal(llama.protocol, 'ollama');
    assert.equal((await api.model('ollama', 'nomic-embed-text:latest')).kind, 'embedding');
    const broken = await api.model('ollama', 'broken:1b');
    assert.equal(broken.capabilities.toolCalling, 'unknown'); // enrichment failed → unknown, sync still OK
    assert.ok((await api.models({ chatOnly: '1' })).every((m) => m.kind !== 'embedding'));
  });
  await srv.close();
});

/* ───────── Generic OpenAI-compatible (DeepSeek / OpenAI) + failure modes ───────── */
test('openai-compatible: auth headers, org/project, redirects never leak credentials, network failures classified', async () => {
  const KEY = 'sk-deepseekdeepseekdeepseek01';
  const leak = await fake((_req, _url, res) => send(res, 200, { data: [] }));
  const srv = await fake((req, url, res) => {
    if (url.pathname === '/redir/models') { res.writeHead(302, { location: `${leak.url}/models` }); return res.end(); }
    if (url.pathname !== '/models') return send(res, 404, {});
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: { message: 'bad key' } });
    send(res, 200, { object: 'list', data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'text-embedding-x' }, { id: 'deepseek-chat' }] });
  });
  await withEngine(async (api) => {
    const ok = await api.testDraft('deepseek', { values: { apiKey: KEY, baseUrl: srv.url } });
    assert.equal(ok.status, 'connected');
    assert.match(ok.message, /4 models/);

    // org/project headers for OpenAI are forwarded
    await api.testDraft('openai', { values: { apiKey: 'sk-openaiopenaiopenai01', organization: 'org-1', project: 'proj-1', baseUrl: srv.url } });
    const last = srv.hits.at(-1)!;
    assert.equal(last.headers['openai-organization'], 'org-1');
    assert.equal(last.headers['openai-project'], 'proj-1');

    // wrong path → not_found hint
    const nf = await api.testDraft('deepseek', { values: { apiKey: KEY, baseUrl: `${srv.url}/nope` } });
    assert.equal(nf.errorKind, 'not_found');

    // redirect refused, and the second host never sees the key
    const rd = await api.testDraft('deepseek', { values: { apiKey: KEY, baseUrl: `${srv.url}/redir` } });
    assert.equal(rd.errorKind, 'redirect');
    assert.equal(leak.hits.length, 0);

    // connection refused / timeout
    const dead = await fake((_r, _u, res) => res.end());
    const deadPort = dead.port; await dead.close();
    const refused = await api.testDraft('deepseek', { values: { apiKey: KEY, baseUrl: `http://127.0.0.1:${deadPort}` } });
    assert.equal(refused.errorKind, 'network');
    assert.match(refused.message, /refused/);
    const hang = await fake(() => { /* never answers */ });
    const slow = await api.testDraft('deepseek', { values: { apiKey: KEY, baseUrl: hang.url } });
    assert.equal(slow.errorKind, 'timeout');
    await hang.close();

    // sync dedups ids, keeps kinds
    await api.createCredential({ providerId: 'deepseek', values: { apiKey: KEY, baseUrl: srv.url } });
    const [r] = await api.syncModels({ providerId: 'deepseek' });
    assert.equal(r!.count, 3);
    assert.equal((await api.model('deepseek', 'text-embedding-x')).kind, 'embedding');
    assert.equal((await api.model('deepseek', 'deepseek-chat')).capabilities.toolCalling, 'unknown');

    // a failed sync with a revoked key flips the provider to "error" without deleting models
    const srv2 = await fake((_q, _u, res) => send(res, 401, { error: { message: 'revoked' } }));
    const cred = (await api.credentials('deepseek'))[0]!;
    await api.updateCredential(cred.id, { values: { baseUrl: srv2.url } });
    const [r2] = await api.syncModels({ providerId: 'deepseek' });
    assert.equal(r2!.ok, false);
    assert.equal((await api.providers()).find((p) => p.id === 'deepseek')!.status, 'error');
    assert.equal((await api.models({ providerId: 'deepseek' })).length, 3);
    await srv2.close();
  });
  await srv.close();
  await leak.close();
});

/* ───────── Gemini, curated, manual providers, validation ───────── */
test('gemini pagination + perplexity curated + manual-only providers + no-credential sync', async () => {
  const KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE12345';
  const srv = await fake((req, url, res) => {
    if (req.headers['x-goog-api-key'] !== KEY) return send(res, 403, { error: { message: 'API key not valid' } });
    if (url.pathname !== '/v1beta/models') return send(res, 404, {});
    if (url.searchParams.get('pageToken') === 'p2') return send(res, 200, { models: [{ name: 'models/text-embedding-004', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] }] });
    send(res, 200, { models: [{ name: 'models/gemini-x', displayName: 'Gemini X', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'], thinking: true }], nextPageToken: 'p2' });
  });
  await withEngine(async (api) => {
    assert.equal((await api.testDraft('gemini', { values: { apiKey: KEY, baseUrl: `${srv.url}/v1beta` } })).status, 'connected');
    await api.createCredential({ providerId: 'gemini', values: { apiKey: KEY, baseUrl: `${srv.url}/v1beta` } });
    const [g] = await api.syncModels({ providerId: 'gemini' });
    assert.deepEqual([g!.ok, g!.count], [true, 2]);
    const gx = await api.model('gemini', 'gemini-x');
    assert.deepEqual([gx.contextWindow, gx.maxOutputTokens, gx.capabilities.reasoning, gx.protocol], [1048576, 65536, 'supported', 'gemini']);
    assert.equal((await api.model('gemini', 'text-embedding-004')).kind, 'embedding');

    // Perplexity: no free endpoint → honest "unsupported"; curated list marked as such
    const pt = await api.testDraft('perplexity', { values: { apiKey: 'pplx-abcdefghijkl' } });
    assert.equal(pt.status, 'unsupported');
    await api.createCredential({ providerId: 'perplexity', values: { apiKey: 'pplx-abcdefghijkl' } });
    const [p] = await api.syncModels({ providerId: 'perplexity' });
    assert.equal(p!.count, 5);
    assert.equal((await api.model('perplexity', 'sonar-pro')).origin, 'curated');
    assert.equal((await api.providers()).find((x) => x.id === 'perplexity')!.status, 'configured'); // unsupported test never fakes "connected"

    // manual-only provider (custom anthropic gateway has no listing endpoint declared)
    await api.createCredential({ providerId: 'custom-anthropic', values: { baseUrl: srv.url } });
    const [c] = await api.syncModels({ providerId: 'custom-anthropic' });
    assert.deepEqual([c!.ok, c!.skipped], [true, true]);
    await api.addModel({ providerId: 'custom-anthropic', modelId: 'gw-claude', protocol: 'anthropic' });
    await assert.rejects(api.addModel({ providerId: 'custom-anthropic', modelId: 'x', protocol: 'openai' }), (e: EngineError) => e.status === 400);

    // provider without a credential
    const [none] = await api.syncModels({ providerId: 'groq' });
    assert.equal(none!.ok, false);
    assert.match(none!.error!, /No enabled credential/);

    // draft validation reuses save-time validation
    await assert.rejects(api.testDraft('groq', { values: {} }), (e: EngineError) => e.status === 400);
    await assert.rejects(api.testDraft('groq', { values: { apiKey: 'gsk_abcdefghij', baseUrl: 'ftp://x' } }), (e: EngineError) => e.status === 400);

    // sync-all touches only providers that have an enabled credential
    const all = await api.syncModels({});
    assert.deepEqual(all.map((r) => r.providerId).sort(), ['custom-anthropic', 'gemini', 'perplexity']);
  });
  await srv.close();
});

test('draft test can complete a stored credential (secret not re-typed) without storing anything', async () => {
  const KEY = 'sk-or-v1-STOREDKEYSTOREDKEY00003';
  const s2 = await fake((req, url, res) => (url.pathname === '/api/v1/auth/key' && req.headers.authorization === `Bearer ${KEY}` ? send(res, 200, {}) : send(res, 401, {})));
  await withEngine(async (api) => {
    const { credential } = await api.createCredential({ providerId: 'openrouter', label: 'a', values: { apiKey: KEY } });
    const t = await api.testDraft('openrouter', { values: { baseUrl: `${s2.url}/api/v1` }, credentialId: credential.id });
    assert.equal(t.status, 'connected'); // stored key + new base URL
    assert.equal((await api.credentials('openrouter'))[0]!.fields['baseUrl'], undefined); // draft did not modify the stored credential
    await assert.rejects(api.testDraft('openai', { values: {}, credentialId: credential.id }), (e: EngineError) => e.status === 400);
  });
  await s2.close();
});

test('upgrade: a Phase 1 database (schema v2) migrates to the latest schema without losing credentials', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { runMigrations } = await import('@cameleon/kit');
  const { migrations } = await import('./migrations.js');
  const paths = getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'up-')) } });
  fs.mkdirSync(paths.data, { recursive: true });
  const db = new Database(path.join(paths.data, 'cameleon.db'));
  runMigrations(db, migrations.slice(0, 2));
  db.prepare("INSERT INTO credentials (id, provider_id, label, masked_key, fields_json, secret_fields_json, enabled, created_at, updated_at) VALUES ('old1','groq','legacy','gsk_ab…wxyz','{}','[]',1,'2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO models (provider_id, model_id, display_name, protocol, synced_at) VALUES ('groq','m','m','openai','2026-01-01')").run();
  db.close();

  const eng = await startEngine({ paths, forceFileVault: true });
  try {
    const api = createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token });
    assert.equal((await api.status()).database.schemaVersion, 6);
    const creds = await api.credentials();
    assert.equal(creds[0]!.label, 'legacy');
    assert.equal(creds[0]!.lastCheck, null);
    assert.equal((await api.models())[0]!.kind, 'unknown'); // new column defaulted
  } finally {
    await eng.close();
  }
});
