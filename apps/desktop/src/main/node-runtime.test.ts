import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveNodeBin } from './node-runtime.js';

test('uses the bundled runtime when available', (t) => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cameleon-runtime-'));
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
  const bundled = path.join(resourcesPath, 'runtime', 'node.exe');
  fs.mkdirSync(path.dirname(bundled));
  fs.writeFileSync(bundled, '');

  assert.equal(resolveNodeBin(resourcesPath, 'win32', {}), bundled);
});

test('allows an explicit Node.js override to take precedence', () => {
  assert.equal(resolveNodeBin(undefined, 'win32', { CAMELEON_NODE: 'custom-node' }), 'custom-node');
});
