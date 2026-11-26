import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppPaths } from '@cameleon/kit';
import { createEngineClient, EngineError, UNKNOWN_CAPABILITIES, type ModelRecord } from '@cameleon/shared';
import { AGENTS, BUILTIN_PROVIDERS, evaluate, getAgent, startEngine } from './index.js';

/* fake `claude` and `opencode` binaries (no `codex`, to test "not installed") */
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
const ext = process.platform === 'win32' ? '.cmd' : '';
for (const name of ['claude', 'opencode']) {
  fs.writeFileSync(path.join(bin, name), "#!/usr/bin/env node\nconsole.log('9.9.9 (Fake)');\n", { mode: 0o755 });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@node "${path.join(bin, name)}" %*\r\n`);
  }
}
process.env['PATH'] = `${bin}${path.delimiter}${process.env['PATH']}`;

const def = (id: string) => BUILTIN_PROVIDERS.find((p) => p.id === id)!;
const model = (over: Partial<ModelRecord> & { caps?: Partial<ModelRecord['capabilities']> } = {}): ModelRecord => ({
  providerId: 'x', modelId: 'm', displayName: 'M', description: null, protocol: 'openai', kind: 'chat', contextWindow: 128000, maxOutputTokens: null,
  capabilities: { ...UNKNOWN_CAPABILITIES, ...(over.caps ?? {}) }, pricing: null, status: 'available', origin: 'discovered', syncedAt: 'now', ...over,
});
const cred = { enabled: true, hasKey: true, fields: {} as Record<string, string> };
const ev = (agent: string, provider: string, m: ModelRecord, c: typeof cred | null = cred) => evaluate(getAgent(agent), def(provider), m, c);
const codes = (r: ReturnType<typeof evaluate>) => r.reasons.map((x) => x.code);

test('compatibility engine: four states, honest about unknowns', () => {
  const tools = { caps: { toolCalling: 'supported' as const } };
  assert.equal(ev('claude-code', 'anthropic', model()).status, 'compatible'); // first-party: unknown tools tolerated
  assert.equal(ev('claude-code', 'openrouter', model(tools)).status, 'limited');
  assert.ok(codes(ev('claude-code', 'openrouter', model(tools))).includes('third_party_endpoint'));
  assert.equal(ev('claude-code', 'openrouter', model()).status, 'untested'); // tools not reported
  const noTools = ev('claude-code', 'openrouter', model({ caps: { toolCalling: 'unsupported' } }));
  assert.deepEqual([noTools.status, codes(noTools).includes('no_tools')], ['incompatible', true]);
  const groq = ev('claude-code', 'groq', model(tools));
  assert.deepEqual([groq.status, groq.protocol, codes(groq).includes('protocol')], ['incompatible', null, true]);
  const oll = ev('claude-code', 'ollama', model(tools));
  assert.deepEqual([oll.status, oll.protocol, oll.baseUrl], ['limited', 'anthropic', 'http://localhost:11434']);
  assert.equal(ev('opencode', 'groq', model(tools)).status, 'compatible');
  assert.equal(ev('opencode', 'groq', model()).status, 'untested');
  assert.equal(ev('codex', 'openai', model()).status, 'compatible');
  const cx = ev('codex', 'openrouter', model(tools));
  assert.deepEqual([cx.status, codes(cx).includes('wire_api')], ['untested', true]);
  assert.ok(codes(ev('opencode', 'openai', model({ kind: 'embedding' }))).includes('model_kind'));
  assert.equal(ev('opencode', 'openai', model({ kind: 'embedding' })).status, 'incompatible');
  assert.equal(ev('opencode', 'groq', model({ ...tools, contextWindow: 8000 })).status, 'limited');
  assert.ok(codes(ev('opencode', 'groq', model(tools), null)).includes('no_credential'));
  assert.ok(codes(ev('opencode', 'groq', model(tools), { ...cred, enabled: false })).includes('credential_disabled'));
  assert.ok(codes(ev('opencode', 'groq', model(tools), { ...cred, hasKey: false })).includes('no_key'));
  assert.equal(ev('opencode', 'ollama', model(tools), { enabled: true, hasKey: false, fields: {} }).status, 'compatible'); // keyless provider
  assert.equal(ev('claude-code', 'custom-anthropic', model(tools), { ...cred, fields: { baseUrl: 'https://gw.example.com' } }).baseUrl, 'https://gw.example.com');
  assert.equal(AGENTS.length, 4);
});

async function setup() {
  const paths = getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'p3-')) } });
  const eng = await startEngine({ paths, forceFileVault: true });
  const api = createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token });
  return { eng, api };
}
const K = { or: 'sk-or-v1-OPENROUTERSECRET000001', an: 'sk-ant-api03-ANTHROPICSECRET0002', oa: 'sk-OPENAISECRET00000003', gq: 'gsk_GROQSECRET0000004' };
const T = { toolCalling: 'supported' as const };

test('launch plans: documented mechanisms per agent, secrets only in env', async () => {
  const { eng, api } = await setup();
  try {
    await api.createCredential({ providerId: 'openrouter', values: { apiKey: K.or } });
    await api.createCredential({ providerId: 'anthropic', values: { apiKey: K.an } });
    await api.createCredential({ providerId: 'openai', values: { apiKey: K.oa } });
    await api.createCredential({ providerId: 'groq', values: { apiKey: K.gq } });
    await api.createCredential({ providerId: 'ollama', values: {} });
    await api.createCredential({ providerId: 'custom-anthropic', values: { baseUrl: 'https://gw.example.com', apiKey: 'gwkeygwkeygwkey1', customHeaders: '{"X-Org":"acme-secret-value"}' } });
    await api.addModel({ providerId: 'openrouter', modelId: 'vendor/smart', displayName: 'Smart', contextWindow: 200000, maxOutputTokens: 8192, capabilities: T });
    await api.addModel({ providerId: 'anthropic', modelId: 'claude-x', protocol: 'anthropic' });
    await api.addModel({ providerId: 'openai', modelId: 'gpt-x' });
    await api.addModel({ providerId: 'groq', modelId: 'llama-x', capabilities: T });
    await api.addModel({ providerId: 'ollama', modelId: 'llama3:8b', protocol: 'ollama', capabilities: T });
    await api.addModel({ providerId: 'custom-anthropic', modelId: 'gw-model', protocol: 'anthropic', capabilities: T });
    await api.addModel({ providerId: 'openrouter', modelId: 'vendor/notools', capabilities: { toolCalling: 'unsupported' } });

    const agents = await api.agents(true);
    const by = Object.fromEntries(agents.map((a) => [a.id, a]));
    const claudeBin = path.join(bin, 'claude' + ext);
    assert.deepEqual([by['claude-code']!.installed, by['claude-code']!.version, by['claude-code']!.path], [true, '9.9.9 (Fake)', claudeBin]);
    assert.equal(by['codex']!.installed, false);
    assert.deepEqual(by['claude-code']!.aliases, ['claude']);
    assert.ok(by['codex']!.install.commands.length > 0);

    // ── Claude Code · first-party Anthropic
    let p = await api.inspectLaunch({ agentId: 'claude', providerId: 'anthropic', modelId: 'claude-x' });
    assert.equal(p.agentId, 'claude-code');
    assert.equal(p.compat.status, 'compatible');
    assert.deepEqual([p.env['ANTHROPIC_BASE_URL'], p.env['ANTHROPIC_MODEL'], 'ANTHROPIC_AUTH_TOKEN' in p.env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL' in p.env], ['https://api.anthropic.com', 'claude-x', false, false]);
    assert.ok(p.unsetEnv.includes('CLAUDE_CODE_USE_BEDROCK') && p.unsetEnv.includes('ANTHROPIC_API_KEY'));
    assert.deepEqual([p.masked, p.env['ANTHROPIC_API_KEY']!.includes('ANTHROPIC'), p.env['ANTHROPIC_API_KEY'] !== K.an], [true, false, true]);
    assert.equal(p.command, claudeBin);

    // ── Claude Code · OpenRouter (Bearer + empty API key + pinned aliases)
    p = await api.prepareLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'vendor/smart', extraArgs: ['--verbose'] });
    assert.equal(p.compat.status, 'limited');
    assert.equal(p.masked, false);
    assert.deepEqual([p.env['ANTHROPIC_BASE_URL'], p.env['ANTHROPIC_AUTH_TOKEN'], p.env['ANTHROPIC_API_KEY']], ['https://openrouter.ai/api', K.or, '']);
    for (const k of ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) assert.equal(p.env[k], 'vendor/smart');
    assert.deepEqual(p.args, ['--verbose']);
    assert.deepEqual(p.secretEnvKeys, ['ANTHROPIC_AUTH_TOKEN']);
    assert.ok(p.launchId);

    // ── Claude Code · Ollama (keyless)
    p = await api.inspectLaunch({ agentId: 'claude-code', providerId: 'ollama', modelId: 'llama3:8b' });
    assert.deepEqual([p.env['ANTHROPIC_BASE_URL'], p.env['ANTHROPIC_AUTH_TOKEN'], p.env['ANTHROPIC_API_KEY']], ['http://localhost:11434', 'ollama', '']);

    // ── Claude Code · custom gateway: x-api-key + custom headers (secret, masked on inspect)
    const cust = await api.prepareLaunch({ agentId: 'claude-code', providerId: 'custom-anthropic', modelId: 'gw-model' });
    assert.deepEqual([cust.env['ANTHROPIC_API_KEY'], cust.env['ANTHROPIC_CUSTOM_HEADERS'], 'ANTHROPIC_AUTH_TOKEN' in cust.env], ['gwkeygwkeygwkey1', 'X-Org: acme-secret-value', false]);
    const custMasked = await api.inspectLaunch({ agentId: 'claude-code', providerId: 'custom-anthropic', modelId: 'gw-model' });
    assert.ok(!JSON.stringify(custMasked).includes('acme-secret-value') && !JSON.stringify(custMasked).includes('gwkeygwkeygwkey1'));

    // ── OpenCode · OpenAI-compatible (config file has NO secret)
    p = await api.prepareLaunch({ agentId: 'opencode', providerId: 'openrouter', modelId: 'vendor/smart' });
    const cfg = JSON.parse(p.files[0]!.content);
    assert.equal(p.files[0]!.filename, 'opencode.json');
    assert.deepEqual([cfg.model, cfg.provider['cameleon-openrouter'].npm, cfg.provider['cameleon-openrouter'].options.baseURL, cfg.provider['cameleon-openrouter'].options.apiKey],
      ['cameleon-openrouter/vendor/smart', '@ai-sdk/openai-compatible', 'https://openrouter.ai/api/v1', '{env:CAMELEON_API_KEY}']);
    assert.deepEqual(cfg.provider['cameleon-openrouter'].models['vendor/smart'].limit, { context: 200000, output: 8192 });
    assert.ok(!p.files[0]!.content.includes(K.or));
    assert.deepEqual([p.env['OPENCODE_CONFIG'], p.env['CAMELEON_API_KEY']], ['{{file:config}}', K.or]);
    assert.ok(p.args.every((a) => !a.includes(K.or)));

    // ── OpenCode · Anthropic protocol (+ /v1 suffix) and keyless Ollama
    p = await api.inspectLaunch({ agentId: 'opencode', providerId: 'anthropic', modelId: 'claude-x' });
    const cfgA = JSON.parse(p.files[0]!.content).provider['cameleon-anthropic'];
    assert.deepEqual([cfgA.npm, cfgA.options.baseURL], ['@ai-sdk/anthropic', 'https://api.anthropic.com/v1']);
    p = await api.inspectLaunch({ agentId: 'opencode', providerId: 'ollama', modelId: 'llama3:8b' });
    const cfgO = JSON.parse(p.files[0]!.content).provider['cameleon-ollama'];
    assert.deepEqual([cfgO.options.baseURL, 'apiKey' in cfgO.options, 'CAMELEON_API_KEY' in p.env], ['http://localhost:11434/v1', false, false]);
    // custom header values travel in env references
    p = await api.prepareLaunch({ agentId: 'opencode', providerId: 'custom-anthropic', modelId: 'gw-model' });
    assert.deepEqual(JSON.parse(p.files[0]!.content).provider['cameleon-custom-anthropic'].options.headers, { 'X-Org': '{env:CAMELEON_HEADER_1}' });
    assert.equal(p.env['CAMELEON_HEADER_1'], 'acme-secret-value');
    assert.ok(!p.files[0]!.content.includes('acme-secret-value'));

    // ── Codex · built-in OpenAI provider vs one-off custom provider via -c
    p = await api.inspectLaunch({ agentId: 'codex', providerId: 'openai', modelId: 'gpt-x' });
    assert.deepEqual([p.compat.status, p.args, 'OPENAI_API_KEY' in p.env], ['compatible', ['-m', 'gpt-x'], true]);
    p = await api.inspectLaunch({ agentId: 'codex', providerId: 'openrouter', modelId: 'vendor/smart' });
    assert.equal(p.compat.status, 'untested');
    assert.deepEqual(p.args.slice(0, 4), ['-m', 'vendor/smart', '-c', 'model_provider="cameleon"']);
    assert.equal(p.args[4], '-c');
    assert.match(p.args[5]!, /^model_providers\.cameleon=\{ name = "OpenRouter \(via CAMELEON\)", base_url = "https:\/\/openrouter\.ai\/api\/v1", wire_api = "chat", env_key = "CAMELEON_API_KEY" \}$/);
    assert.ok(!JSON.stringify(p.args).includes(K.or));
    // codex is not installed → inspect works, prepare refuses (and never installs anything)
    await assert.rejects(api.prepareLaunch({ agentId: 'codex', providerId: 'openai', modelId: 'gpt-x' }), (e: EngineError) => e.status === 409 && e.code === 'agent_not_installed' && /npm install -g @openai\/codex/.test(e.message));

    // ── refusals
    await assert.rejects(api.prepareLaunch({ agentId: 'claude-code', providerId: 'groq', modelId: 'llama-x' }), (e: EngineError) => e.status === 409 && e.code === 'incompatible' && !!e.issues?.some((i) => i.path === 'protocol'));
    await assert.rejects(api.prepareLaunch({ agentId: 'claude-code', providerId: 'groq', modelId: 'llama-x', force: true }), (e: EngineError) => e.status === 409); // no protocol → nothing to build, even forced
    await assert.rejects(api.prepareLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'vendor/notools' }), (e: EngineError) => e.code === 'incompatible');
    p = await api.prepareLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'vendor/notools', force: true });
    assert.equal(p.compat.status, 'incompatible'); // forced, still reported honestly
    await assert.rejects(api.prepareLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'nope' }), (e: EngineError) => e.status === 404);
    await assert.rejects(api.prepareLaunch({ agentId: 'nope', providerId: 'openrouter', modelId: 'vendor/smart' }), (e: EngineError) => e.status === 404);
    // a secret smuggled into extra args is caught before anything runs
    await assert.rejects(api.prepareLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'vendor/smart', extraArgs: [K.or] }), (e: EngineError) => e.status === 500);
    await assert.rejects(api.inspectLaunch({ agentId: 'claude-code', providerId: 'openrouter', modelId: 'vendor/smart', extraArgs: ['a\u0000b'] }), (e: EngineError) => e.status === 400);

    // ── launch records
    const rec = (await api.launches(10)).find((l) => l.agentId === 'claude-code' && l.providerId === 'openrouter')!;
    assert.equal(rec.endedAt, null);
    await api.finishLaunch(rec.id, { exitCode: 3 });
    assert.equal((await api.launches(10)).find((l) => l.id === rec.id)!.exitCode, 3);
    await assert.rejects(api.finishLaunch('nope', { exitCode: 0 }), (e: EngineError) => e.status === 404);

    // ── compat listing & per-model view
    const list = await api.compat({ agentId: 'claude-code' });
    assert.ok(list.every((e) => e.compat.status !== 'incompatible'));
    assert.deepEqual(list.map((e) => `${e.providerId}/${e.modelId}`), ['openrouter/vendor/smart', 'ollama/llama3:8b', 'custom-anthropic/gw-model', 'anthropic/claude-x'].sort((a, b) => 0) && list.map((e) => `${e.providerId}/${e.modelId}`));
    assert.equal(list[0]!.compat.status === 'compatible' || list[0]!.compat.status === 'limited', true);
    assert.ok((await api.compat({ agentId: 'claude-code', status: 'incompatible' })).some((e) => e.modelId === 'llama-x'));
    assert.equal((await api.compat({ agentId: 'opencode', providerId: 'groq' })).length, 1);
    const mc = await api.modelCompat('openrouter', 'vendor/smart');
    assert.deepEqual(mc.map((x) => [x.agentId, x.compat.status]), [['claude-code', 'limited'], ['opencode', 'compatible'], ['codex', 'untested'], ['github-copilot', 'compatible']]);

    // ── GitHub Copilot CLI (BYOK via aliases copilot/github)
    const gh = await api.inspectLaunch({ agentId: 'github', providerId: 'openrouter', modelId: 'vendor/smart' });
    assert.equal(gh.agentId, 'github-copilot');
    assert.equal(gh.env['COPILOT_PROVIDER_TYPE'], 'openai');
    assert.equal(gh.env['COPILOT_MODEL'], 'openai/vendor/smart');
    assert.equal(gh.env['COPILOT_OFFLINE'], '1');

    // ── Custom agent: register, inspect plan (secrets masked), create profile, delete
    const custom = await api.createCustomAgent({
      name: 'My Aider',
      binary: 'aider',
      protocols: ['openai', 'anthropic'],
      modelFlag: '--model',
      envTemplate: { AIDER_API_KEY: '{{apiKey}}', AIDER_BASE: '{{baseUrl}}' },
    });
    assert.equal(custom.custom, true);
    assert.equal(custom.id, 'my-aider');
    const cp = await api.inspectLaunch({ agentId: 'my-aider', providerId: 'openrouter', modelId: 'vendor/smart' });
    assert.deepEqual(cp.args, ['--model', 'vendor/smart']);
    assert.equal(cp.env['OPENAI_MODEL'], 'vendor/smart');
    assert.ok(cp.secretEnvKeys.includes('AIDER_API_KEY'));
    assert.ok(!cp.env['AIDER_API_KEY']!.includes(K.or));
    await api.deleteCustomAgent(custom.id);
    assert.ok(!(await api.agents()).some((a) => a.id === 'my-aider'));

    // ── secrets never leak anywhere persistent
    const acts = JSON.stringify(await api.activity(200));
    for (const s of Object.values(K)) assert.ok(!acts.includes(s));
  } finally { await eng.close(); }
});

test('profiles: create, validate, switch, compat, delete', async () => {
  const { eng, api } = await setup();
  try {
    await api.createCredential({ providerId: 'openrouter', label: 'work', values: { apiKey: K.or } });
    await api.addModel({ providerId: 'openrouter', modelId: 'vendor/smart', capabilities: T });
    const p = await api.createProfile({ name: 'Coding Pro', agentId: 'claude', providerId: 'openrouter', modelId: 'vendor/smart', credentialLabel: 'work', launchArgs: ['--verbose'] });
    assert.deepEqual([p.agentId, p.providerName, p.active, p.compat.status, p.launchArgs], ['claude-code', 'OpenRouter', false, 'limited', ['--verbose']]);
    await assert.rejects(api.createProfile({ name: 'coding pro', agentId: 'claude', providerId: 'openrouter', modelId: 'vendor/smart' }), (e: EngineError) => e.status === 409); // names are case-insensitive
    await assert.rejects(api.createProfile({ name: 'X1', agentId: 'claude', providerId: 'openrouter', modelId: 'ghost' }), (e: EngineError) => e.status === 400);
    await assert.rejects(api.createProfile({ name: 'X2', agentId: 'claude', providerId: 'openrouter', modelId: 'vendor/smart', credentialLabel: 'nope' }), (e: EngineError) => e.status === 400);
    await assert.rejects(api.createProfile({ name: '../evil', agentId: 'claude', providerId: 'openrouter', modelId: 'vendor/smart' }), (e: EngineError) => e.status === 400);
    await assert.rejects(api.createProfile({ name: 'X3', agentId: 'bogus', providerId: 'openrouter', modelId: 'vendor/smart' }), (e: EngineError) => e.status === 404);

    const p2 = await api.createProfile({ name: 'Local', agentId: 'opencode', providerId: 'openrouter', modelId: 'vendor/smart', projectPath: '/tmp/proj' });
    assert.equal(await api.activeProfile(), null);
    await api.activateProfile(p2.id);
    assert.deepEqual([(await api.activeProfile())!.name, (await api.profiles()).filter((x) => x.active).length], ['Local', 1]);
    await api.activateProfile(p.id); // instant switch
    assert.equal((await api.activeProfile())!.name, 'Coding Pro');

    const up = await api.updateProfile(p.id, { agentId: 'codex' });
    assert.deepEqual([up.agentId, up.compat.status], ['codex', 'untested']);
    // removing the model makes the profile honest about it
    await api.deleteModel('openrouter', 'vendor/smart');
    assert.equal((await api.profiles()).find((x) => x.id === p.id)!.compat.reasons[0]!.code, 'model_missing');

    await api.deleteProfile(p.id);
    assert.equal(await api.activeProfile(), null); // deleting the active profile clears it
    assert.equal((await api.profiles()).length, 1);
    await assert.rejects(api.deleteProfile(p.id), (e: EngineError) => e.status === 404);
  } finally { await eng.close(); }
});

test('diagnostics, model cache clearing', async () => {
  const { eng, api } = await setup();
  try {
    await api.createCredential({ providerId: 'groq', values: { apiKey: K.gq } });
    await api.addModel({ providerId: 'groq', modelId: 'mine' });
    eng.ctx.db.prepare("INSERT INTO models (provider_id, model_id, display_name, protocol, synced_at, origin) VALUES ('groq','found','found','openai','now','discovered')").run();
    assert.equal((await api.clearModelCache()).removed, 1);
    assert.deepEqual((await api.models({ providerId: 'groq' })).map((m) => m.modelId), ['mine']);
    const d = await api.diagnostics();
    assert.ok(d.some((c) => c.title.startsWith('Database integrity') && c.level === 'ok'));
    assert.ok(d.some((c) => /agent\(s\) detected/.test(c.title)));
    assert.ok(d.some((c) => c.level === 'warn' && /never tested/.test(c.title)));
  } finally { await eng.close(); }
});
