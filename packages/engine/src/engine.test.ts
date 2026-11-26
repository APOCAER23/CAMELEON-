import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { getAppPaths, readRuntime } from '@cameleon/kit';
import { createEngineClient, EngineError } from '@cameleon/shared';
import { startEngine, EngineAlreadyRunningError, BUILTIN_PROVIDERS, ProviderRegistry } from './index.js';

const mkPaths = () => getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'eng-')) } });
const KEY = 'sk-or-v1-SUPERSECRETKEY1234567890abcd';

function rawRequest(port: number, opts: { path: string; method?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode!, body: b }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('catalog: all built-in providers exist and are valid', () => {
  const ids = BUILTIN_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    'anthropic', 'openai', 'openrouter', 'gemini', 'deepseek', 'groq', 'mistral', 'together', 'fireworks', 'cerebras', 'xai', 'perplexity', 'ollama', 'lmstudio', 'custom-openai', 'custom-anthropic',
    'cohere', 'alibaba', 'alibaba-coding', 'zai', 'moonshot', 'minimax', 'nvidia', 'deepinfra', 'huggingface', 'novita', 'siliconflow', 'sambanova', 'opencode-zen', 'vllm', 'llamacpp',
  ]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.equal(BUILTIN_PROVIDERS.length, 68);
});

test('registry: loads user JSON files, reports invalid ones, blocks id collisions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify({
    id: 'my-llm', name: 'My LLM', description: 'x', protocols: ['openai'], endpoints: { openai: 'https://x.example/v1' },
    auth: { type: 'bearer' }, fields: [{ key: 'apiKey', label: 'Key', kind: 'secret', required: true }], discovery: { kind: 'manual' },
  }));
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"id":"x"}');
  fs.writeFileSync(path.join(dir, 'clash.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'good.json'), 'utf8')), id: 'openai' }));
  const reg = new ProviderRegistry();
  const rep = reg.loadDirectory(dir);
  assert.deepEqual(rep.loaded, ['my-llm']);
  assert.deepEqual(rep.errors.map((e) => e.file).sort(), ['bad.json', 'clash.json']);
  assert.equal(reg.get('my-llm').source, 'file');
  assert.throws(() => reg.unregister('openai'), /cannot be removed/);
});

test('engine end-to-end: credentials never leak, API behaves', async () => {
  const paths = mkPaths();
  const eng = await startEngine({ paths, forceFileVault: true });
  try {
    const rt = readRuntime(eng.runtimeFile)!;
    assert.equal(rt.port, eng.port);
    const api = createEngineClient({ host: rt.host, port: rt.port, token: rt.token });

    assert.equal((await api.health()).ok, true);
    const st = await api.status();
    assert.equal(st.counts.providersTotal, BUILTIN_PROVIDERS.length);
    assert.equal(st.vault.backend, 'encrypted-file');

    // create
    const { credential, warnings } = await api.createCredential({ providerId: 'openrouter', label: 'work', values: { apiKey: KEY } });
    assert.equal(credential.maskedKey, 'sk-or-…abcd');
    assert.deepEqual(warnings, []);
    assert.ok(!JSON.stringify(credential).includes('SUPERSECRET'));
    assert.deepEqual(credential.secretFields, ['apiKey']);

    // provider status derives from credentials
    assert.equal((await api.providers()).find((p) => p.id === 'openrouter')!.status, 'configured');
    assert.equal((await api.providers()).find((p) => p.id === 'openai')!.status, 'not_configured');

    // secret never lands in any file on disk (db, wal, vault, runtime is token only)
    ctxFlush(eng);
    for (const f of walk(paths.data)) assert.ok(!fs.readFileSync(f).includes(KEY), `plaintext key found in ${f}`);
    // …but the internal accessor can decrypt it for launches
    assert.equal((await eng.ctx.credentials.getSecrets(credential.id))['apiKey'], KEY);

    // validation + warnings
    await assert.rejects(api.createCredential({ providerId: 'openrouter', label: 'work', values: { apiKey: KEY } }), (e: EngineError) => e.status === 409);
    await assert.rejects(api.createCredential({ providerId: 'openrouter', values: {} }), (e: EngineError) => e.status === 400 && !!e.issues?.length);
    await assert.rejects(api.createCredential({ providerId: 'openrouter', label: 'x', values: { apiKey: KEY, nope: '1' } }), /Invalid input/);
    await assert.rejects(api.createCredential({ providerId: 'nope', values: {} }), (e: EngineError) => e.status === 404);
    await assert.rejects(api.createCredential({ providerId: 'openrouter', label: 'bad', values: { apiKey: 'has space in key 123' } }), (e: EngineError) => e.status === 400);
    const warn = await api.createCredential({ providerId: 'custom-openai', label: 'lan', values: { baseUrl: 'http://192.168.1.5:8000/v1/', apiKey: 'abcdefghij' } });
    assert.ok(warn.warnings.some((w) => w.includes('plain HTTP')));
    assert.equal(warn.credential.fields['baseUrl'], 'http://192.168.1.5:8000/v1');
    const pref = await api.createCredential({ providerId: 'openai', label: 'wrongprefix', values: { apiKey: 'abcdefghijkl' } });
    assert.ok(pref.warnings.some((w) => w.includes('"sk-"')));
    await assert.rejects(api.createCredential({ providerId: 'custom-openai', label: 'h', values: { baseUrl: 'https://a.b/v1', customHeaders: '{"Host":"evil"}' } }), /Invalid input/);
    await assert.rejects(api.createCredential({ providerId: 'custom-openai', label: 'u', values: { baseUrl: 'https://user:pw@a.b/v1' } }), /Invalid input/);

    // local provider without any key
    const oll = await api.createCredential({ providerId: 'ollama', label: 'default', values: {} });
    assert.equal(oll.credential.maskedKey, null);

    // update: replace key, rename, disable
    const upd = await api.updateCredential(credential.id, { values: { apiKey: 'sk-or-v1-NEWKEYNEWKEYNEWKEY9999' }, label: 'work2' });
    assert.equal(upd.credential.maskedKey, 'sk-or-…9999');
    assert.equal(upd.credential.label, 'work2');
    assert.equal((await eng.ctx.credentials.getSecrets(credential.id))['apiKey'], 'sk-or-v1-NEWKEYNEWKEYNEWKEY9999');
    await api.updateCredential(credential.id, { enabled: false });
    assert.equal((await api.providers()).find((p) => p.id === 'openrouter')!.status, 'disabled');
    await assert.rejects(api.updateCredential(credential.id, { values: { apiKey: '' } }), /Invalid input/); // required

    // delete removes the secret too
    await api.deleteCredential(credential.id);
    assert.equal(await eng.ctx.vault.get(`cred:${credential.id}`), null);
    assert.equal((await api.credentials('openrouter')).length, 0);

    // custom providers
    const cp = await api.createCustomProvider({
      id: 'acme', name: 'Acme', description: 'Acme gateway', category: 'direct', protocols: ['openai'], auth: { type: 'bearer' },
      fields: [{ key: 'apiKey', label: 'API key', kind: 'secret', required: true }], discovery: { kind: 'manual' },
    });
    assert.equal(cp.source, 'custom');
    assert.equal(cp.category, 'custom'); // forced
    await api.createCredential({ providerId: 'acme', values: { apiKey: 'abcdefghijkl' } });
    await assert.rejects(api.deleteCustomProvider('acme'), (e: EngineError) => e.status === 409);

    // filters
    assert.ok((await api.providers({ category: 'local' })).every((p) => p.category === 'local'));
    assert.deepEqual((await api.providers({ q: 'groq' })).map((p) => p.id), ['groq']);

    // activity is logged and secret-free
    const act = await api.activity(100);
    assert.ok(act.some((a) => a.kind === 'credential.created'));
    assert.ok(!JSON.stringify(act).includes('SUPERSECRET'));
  } finally {
    await eng.close();
  }
  assert.equal(readRuntime(eng.runtimeFile), null); // runtime file removed on close
});

test('engine security: token, host (DNS rebinding), origin, body limit, no secret echo', async () => {
  const eng = await startEngine({ paths: mkPaths(), forceFileVault: true });
  try {
    const auth = { authorization: `Bearer ${eng.token}` };
    assert.equal((await rawRequest(eng.port, { path: '/v1/status' })).status, 401);
    assert.equal((await rawRequest(eng.port, { path: '/v1/status', headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await rawRequest(eng.port, { path: '/v1/status', headers: { ...auth, host: 'evil.example.com' } })).status, 403);
    assert.equal((await rawRequest(eng.port, { path: '/v1/status', headers: { ...auth, origin: 'https://evil.example.com' } })).status, 403);
    assert.equal((await rawRequest(eng.port, { path: '/v1/status', headers: auth })).status, 200);
    assert.equal((await rawRequest(eng.port, { path: '/health', headers: { host: 'evil.example.com' } })).status, 403);
    assert.equal((await rawRequest(eng.port, { path: '/nope', headers: auth })).status, 404);

    const big = JSON.stringify({ providerId: 'openai', values: { apiKey: 'x'.repeat(100_000) } });
    assert.equal((await rawRequest(eng.port, { path: '/v1/credentials', method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: big })).status, 413);

    const badJson = await rawRequest(eng.port, { path: '/v1/credentials', method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"values":{"apiKey":"sk-leakleakleakleak' });
    assert.equal(badJson.status, 400);
    assert.ok(!badJson.body.includes('leakleak'));

    const hdrs = await fetch(`http://127.0.0.1:${eng.port}/health`);
    assert.equal(hdrs.headers.get('cache-control'), 'no-store');
  } finally {
    await eng.close();
  }
});

test('engine: single instance + remote shutdown', async () => {
  const paths = mkPaths();
  let exited = false;
  const eng = await startEngine({ paths, forceFileVault: true, onShutdownRequested: () => { exited = true; } });
  await assert.rejects(startEngine({ paths, forceFileVault: true }), EngineAlreadyRunningError);
  const api = createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token });
  await api.shutdown();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(exited, true);
  assert.equal(readRuntime(eng.runtimeFile), null);
});

test('db: schema survives restart, activity pruned list ordering', async () => {
  const paths = mkPaths();
  const a = await startEngine({ paths, forceFileVault: true });
  const apiA = createEngineClient({ host: '127.0.0.1', port: a.port, token: a.token });
  await apiA.createCredential({ providerId: 'groq', label: 'k', values: { apiKey: 'gsk_abcdefghijkl' } });
  await a.close();
  const b = await startEngine({ paths, forceFileVault: true });
  const apiB = createEngineClient({ host: '127.0.0.1', port: b.port, token: b.token });
  assert.equal((await apiB.credentials()).length, 1);
  assert.equal((await b.ctx.credentials.getSecrets((await apiB.credentials())[0]!.id))['apiKey'], 'gsk_abcdefghijkl');
  await b.close();
});

function ctxFlush(eng: { ctx: { db: { pragma(s: string): unknown } } }) { eng.ctx.db.pragma('wal_checkpoint(TRUNCATE)'); }
function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
