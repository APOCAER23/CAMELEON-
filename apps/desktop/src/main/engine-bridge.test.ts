import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRoute } from './engine-bridge.js';

test('IPC allow-list: UI routes pass, everything else is refused', () => {
  const ok: [string, string][] = [
    ['GET', '/v1/status'], ['GET', '/v1/providers'], ['GET', '/v1/providers?category=local&q=gro'], ['GET', '/v1/providers/openrouter'],
    ['POST', '/v1/providers/openrouter/test'], ['GET', '/v1/credentials?providerId=openai'], ['POST', '/v1/credentials'],
    ['PATCH', '/v1/credentials/6f1c2a9e-1111-4222-8333-944455556666'], ['POST', '/v1/credentials/6f1c2a9e-1111-4222-8333-944455556666/test'],
    ['DELETE', '/v1/credentials/abc-123'], ['GET', '/v1/models?providerId=openrouter&capabilities=tools,vision&chatOnly=1&limit=2000'],
    ['GET', '/v1/models/detail?providerId=ollama&modelId=llama3%3A8b'], ['POST', '/v1/models'], ['POST', '/v1/models/sync'],
    ['DELETE', '/v1/models?providerId=a-b&modelId=vendor%2Fsmart'], ['GET', '/v1/activity?limit=8'], ['POST', '/v1/custom-providers'],
    ['GET', '/v1/agents?refresh=1'], ['GET', '/v1/compat?agentId=claude-code&status=compatible,limited&limit=2000'], ['GET', '/v1/models/compat?providerId=a-b&modelId=x'],
    ['POST', '/v1/launch/inspect'], ['GET', '/v1/launches?limit=20'], ['GET', '/v1/profiles'], ['GET', '/v1/profiles/active'], ['POST', '/v1/profiles/activate'],
    ['POST', '/v1/profiles'], ['PATCH', '/v1/profiles/6f1c2a9e-1111-4222-8333-944455556666'], ['DELETE', '/v1/profiles/abc'], ['GET', '/v1/diagnostics'], ['DELETE', '/v1/models/cache'],
  ];
  for (const [m, p] of ok) assert.ok(isAllowedRoute(m, p), `${m} ${p} should be allowed`);

  const bad: [unknown, unknown][] = [
    ['POST', '/v1/engine/shutdown'], ['POST', '/v1/launch/prepare'], ['POST', '/v1/launch/abc/finish'], ['POST', '/v1/launch/inspect/x'], ['GET', '/health'], ['GET', '/v1/../health'], ['GET', 'http://evil.example/v1/status'],
    ['GET', '/v1/status/extra'], ['PUT', '/v1/status'], ['GET', '/v1/providers/UPPER'], ['GET', '/v1/models?x=<script>'],
    ['GET', '//v1/status'], ['GET', '/v1/credentials/../../engine/shutdown'], [undefined, '/v1/status'], ['GET', 42],
  ];
  for (const [m, p] of bad) assert.ok(!isAllowedRoute(m, p), `${String(m)} ${String(p)} must be refused`);
});
