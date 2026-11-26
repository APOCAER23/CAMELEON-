import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getAppPaths } from '@cameleon/kit';
import { createEngineClient } from '@cameleon/shared';
import { startEngine } from './index.js';
import { extractUsageFromPayload, joinUpstreamUrl } from './proxy/meter.js';

test('usage meter helpers: joinUpstreamUrl avoids duplicate /v1 and preserves query string', () => {
  assert.equal(joinUpstreamUrl('https://openrouter.ai/api', '/v1/messages'), 'https://openrouter.ai/api/v1/messages');
  assert.equal(joinUpstreamUrl('https://openrouter.ai/api/v1', '/v1/messages?beta=true'), 'https://openrouter.ai/api/v1/messages?beta=true');
  assert.equal(joinUpstreamUrl('https://api.openai.com/v1/', '/chat/completions'), 'https://api.openai.com/v1/chat/completions');
});

test('usage meter helpers: extractUsageFromPayload parses JSON and SSE across Anthropic, OpenAI, and Gemini', () => {
  const anthJson = extractUsageFromPayload(JSON.stringify({
    model: 'claude-sonnet-4',
    usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 500 },
  }));
  assert.deepEqual([anthJson.hasUsage, anthJson.modelId, anthJson.inputTokens, anthJson.outputTokens, anthJson.cacheReadTokens, anthJson.totalTokens],
    [true, 'claude-sonnet-4', 1200, 340, 500, 1540]);

  const anthSse = extractUsageFromPayload([
    'event: message_start',
    'data: {"type":"message_start","message":{"model":"claude-3-7-sonnet","usage":{"input_tokens":800,"cache_creation_input_tokens":200}}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":150}}',
    '',
  ].join('\n'));
  assert.deepEqual([anthSse.hasUsage, anthSse.modelId, anthSse.inputTokens, anthSse.outputTokens, anthSse.cacheWriteTokens, anthSse.totalTokens],
    [true, 'claude-3-7-sonnet', 800, 150, 200, 950]);

  const oaiSse = extractUsageFromPayload([
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    'data: {"model":"gpt-4o","usage":{"prompt_tokens":420,"completion_tokens":80,"total_tokens":500}}',
    'data: [DONE]',
  ].join('\n'));
  assert.deepEqual([oaiSse.hasUsage, oaiSse.modelId, oaiSse.inputTokens, oaiSse.outputTokens, oaiSse.totalTokens],
    [true, 'gpt-4o', 420, 80, 500]);

  const gemJson = extractUsageFromPayload(JSON.stringify({
    modelVersion: 'gemini-2.5-flash',
    usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 100, cachedContentTokenCount: 50, totalTokenCount: 350 },
  }));
  assert.deepEqual([gemJson.hasUsage, gemJson.modelId, gemJson.inputTokens, gemJson.outputTokens, gemJson.cacheReadTokens, gemJson.totalTokens],
    [true, 'gemini-2.5-flash', 250, 100, 50, 350]);

  const groqSse = extractUsageFromPayload([
    'data: {"choices":[{"delta":{"content":"ok"}}]}',
    'data: {"model":"qwen/qwen3-32b","x_groq":{"usage":{"prompt_tokens":90,"completion_tokens":30,"total_tokens":120}}}',
    'data: [DONE]',
  ].join('\n'));
  assert.deepEqual([groqSse.hasUsage, groqSse.modelId, groqSse.inputTokens, groqSse.outputTokens, groqSse.totalTokens],
    [true, 'qwen/qwen3-32b', 90, 30, 120]);

  const ollamaJson = extractUsageFromPayload(JSON.stringify({
    model: 'qwen2.5-coder:7b',
    done: true,
    prompt_eval_count: 140,
    eval_count: 60,
  }));
  assert.deepEqual([ollamaJson.hasUsage, ollamaJson.modelId, ollamaJson.inputTokens, ollamaJson.outputTokens, ollamaJson.totalTokens],
    [true, 'qwen2.5-coder:7b', 140, 60, 200]);
});

test('usage end-to-end: metered launch captures real per-model token consumption via proxy', async () => {
  // Fake local upstream AI provider
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url?.includes('stream=1')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: message_start\ndata: {"type":"message_start","message":{"model":"my-model","usage":{"input_tokens":500}}}\n\n');
        res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":125}}\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'my-model', usage: { input_tokens: 300, output_tokens: 100 } }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  const upPort = (upstream.address() as { port: number }).port;

  // Fake installed binary on PATH
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-bin-'));
  const binName = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  fs.writeFileSync(path.join(binDir, binName), process.platform === 'win32' ? '@echo 1.0.0\r\n' : '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 });
  const prevPath = process.env['PATH'];
  process.env['PATH'] = `${binDir}${path.delimiter}${prevPath ?? ''}`;

  const paths = getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'usage-eng-')) } });
  const eng = await startEngine({ paths, forceFileVault: true });

  try {
    const api = createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token });
    await api.createCredential({
      providerId: 'custom-anthropic',
      values: { baseUrl: `http://127.0.0.1:${upPort}`, apiKey: 'test-key-123456' },
    });
    await api.addModel({ providerId: 'custom-anthropic', modelId: 'my-model', protocol: 'anthropic', capabilities: { toolCalling: 'supported' } });

    const plan = await api.prepareLaunch({
      agentId: 'claude-code',
      providerId: 'custom-anthropic',
      modelId: 'my-model',
      meter: true,
    });

    const proxyBase = plan.env['ANTHROPIC_BASE_URL']!;
    assert.ok(proxyBase.startsWith('http://127.0.0.1:'));

    // Simulate 1 JSON request + 1 SSE streaming request from the agent
    const r1 = await fetch(`${proxyBase}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': plan.env['ANTHROPIC_API_KEY']! },
      body: JSON.stringify({ model: 'my-model', messages: [] }),
    });
    assert.equal(r1.status, 200);
    await r1.text();

    const r2 = await fetch(`${proxyBase}/v1/messages?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': plan.env['ANTHROPIC_API_KEY']! },
      body: JSON.stringify({ model: 'my-model', stream: true, messages: [] }),
    });
    assert.equal(r2.status, 200);
    await r2.text();

    // Wait briefly for response end handler to commit SQLite row
    await new Promise((r) => setTimeout(r, 100));

    const summary = await api.usage('7d');
    assert.equal(summary.totals.requests, 2);
    assert.equal(summary.totals.inputTokens, 800);
    assert.equal(summary.totals.outputTokens, 225);
    assert.equal(summary.totals.totalTokens, 1025);
    assert.equal(summary.byModel.length, 1);
    assert.equal(summary.byModel[0]!.modelId, 'my-model');
    assert.equal(summary.byAgent[0]!.agentId, 'claude-code');
    assert.equal(summary.recent.length, 2);

    const cleared = await api.clearUsage();
    assert.equal(cleared.deleted, 2);
    assert.equal((await api.usage('7d')).totals.requests, 0);
  } finally {
    process.env['PATH'] = prevPath;
    await eng.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test('usage end-to-end: injects stream_options.include_usage on OpenAI chat/completions streaming calls', async () => {
  let receivedBody: Record<string, unknown> | null = null;
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      receivedBody = JSON.parse(body) as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if ((receivedBody['stream_options'] as { include_usage?: boolean } | undefined)?.include_usage) {
        res.write('data: {"model":"llama-3.3-70b","usage":{"prompt_tokens":110,"completion_tokens":40,"total_tokens":150}}\n\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  const upPort = (upstream.address() as { port: number }).port;

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-oai-bin-'));
  const binName = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
  fs.writeFileSync(path.join(binDir, binName), process.platform === 'win32' ? '@echo 1.0.0\r\n' : '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 });
  const prevPath = process.env['PATH'];
  process.env['PATH'] = `${binDir}${path.delimiter}${prevPath ?? ''}`;

  const paths = getAppPaths('cameleon', { env: { CAMELEON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'usage-oai-eng-')) } });
  const eng = await startEngine({ paths, forceFileVault: true });

  try {
    const api = createEngineClient({ host: '127.0.0.1', port: eng.port, token: eng.token });
    await api.createCredential({
      providerId: 'groq',
      values: { baseUrl: `http://127.0.0.1:${upPort}/openai/v1`, apiKey: 'gsk_test_123456' },
    });
    await api.addModel({ providerId: 'groq', modelId: 'llama-3.3-70b', protocol: 'openai', capabilities: { toolCalling: 'supported' } });

    const plan = await api.prepareLaunch({
      agentId: 'github-copilot',
      providerId: 'groq',
      modelId: 'llama-3.3-70b',
      meter: true,
    });

    const proxyBase = plan.env['COPILOT_PROVIDER_BASE_URL']!;
    const res = await fetch(`${proxyBase}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${plan.env['COPILOT_PROVIDER_API_KEY']!}` },
      body: JSON.stringify({ model: 'llama-3.3-70b', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    await res.text();
    await new Promise((r) => setTimeout(r, 100));

    assert.equal((receivedBody?.['stream_options'] as { include_usage?: boolean } | undefined)?.include_usage, true);
    const summary = await api.usage('7d');
    assert.equal(summary.totals.totalTokens, 150);
    assert.equal(summary.byAgent[0]!.agentId, 'github-copilot');
  } finally {
    process.env['PATH'] = prevPath;
    await eng.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
