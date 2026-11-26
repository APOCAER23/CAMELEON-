import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getAppPaths, runMigrations, MigrationError, redact, maskSecret, REDACTED,
  openVault, EncryptedFileStore, createRequestGuard, writeRuntime, readRuntime, clearRuntime, generateToken,
} from './index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));

test('paths: per-OS conventions and HOME override', () => {
  assert.equal(getAppPaths('cameleon', { platform: 'linux', home: '/h', env: {} }).config, '/h/.config/cameleon');
  assert.equal(getAppPaths('cameleon', { platform: 'darwin', home: '/h', env: {} }).data, '/h/Library/Application Support/cameleon/data');
  assert.match(getAppPaths('cameleon', { platform: 'win32', home: 'C:\\u', env: { APPDATA: 'C:\\R' } }).config, /R.cameleon$/);
  assert.match(getAppPaths('cameleon', { env: { CAMELEON_HOME: '/x' } }).data, /[\\/]x[\\/]data$/);
});

test('migrate: applies once, detects edits, blocks downgrade', () => {
  const db = new DatabaseSync(':memory:');
  const m = [{ id: 1, name: 'a', sql: 'CREATE TABLE t(x)' }, { id: 2, name: 'b', sql: 'ALTER TABLE t ADD COLUMN y' }];
  assert.deepEqual(runMigrations(db, m).applied, [1, 2]);
  assert.deepEqual(runMigrations(db, m).applied, []);
  assert.throws(() => runMigrations(db, [{ ...m[0]!, sql: 'CREATE TABLE t(z)' }, m[1]!]), MigrationError);
  assert.throws(() => runMigrations(db, [m[0]!]), /newer/);
  const bad = new DatabaseSync(':memory:');
  assert.throws(() => runMigrations(bad, [{ id: 1, name: 'x', sql: 'NOT SQL' }]), MigrationError);
  assert.equal(bad.prepare('SELECT count(*) c FROM schema_migrations').get()!['c'], 0); // rolled back
});

test('redact + mask never leak keys', () => {
  const out = redact({ apiKey: 'sk-abcdefghijklmnop', msg: 'using Bearer abcdefgh12345678 now', nested: { password: 'x' }, ok: 1 });
  assert.equal(out.apiKey, REDACTED);
  assert.ok(!JSON.stringify(out).includes('abcdefgh12345678'));
  assert.equal(out.ok, 1);
  assert.equal(maskSecret('sk-or-v1-1234567890abcdefghij'), 'sk-or-…ghij');
  assert.equal(maskSecret('short'), '•••••');
});

test('vault: encrypted file roundtrip, 0600, tamper detection, name binding', async () => {
  const dir = tmp();
  const { store, info } = await openVault({ service: 'kt', dir, forceFile: true });
  assert.equal(info.backend, 'encrypted-file');
  await store.set('a', 'secret-A');
  await store.set('b', 'secret-B');
  assert.equal(await store.get('a'), 'secret-A');
  assert.equal(await store.get('nope'), null);
  assert.ok(!fs.readFileSync(path.join(dir, 'vault.enc.json'), 'utf8').includes('secret-A'));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'vault.enc.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dir, 'vault.key')).mode & 0o777, 0o600);
  }
  // swap ciphertexts between names → must fail
  const f = path.join(dir, 'vault.enc.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  [data.entries.a, data.entries.b] = [data.entries.b, data.entries.a];
  fs.writeFileSync(f, JSON.stringify(data));
  await assert.rejects(new EncryptedFileStore(f, path.join(dir, 'vault.key')).get('a'), /Cannot decrypt/);
  assert.equal(await store.delete('b'), true);
});

test('vault: concurrent writes do not lose entries', async () => {
  const { store } = await openVault({ service: 'kt', dir: tmp(), forceFile: true });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`k${i}`, `v${i}`)));
  for (let i = 0; i < 20; i++) assert.equal(await store.get(`k${i}`), `v${i}`);
});

test('vault: falls back when keyring probe fails', async () => {
  const { info } = await openVault({
    service: 'kt', dir: tmp(),
    loadKeyring: async () => ({ Entry: class { setPassword() { throw new Error('no dbus'); } getPassword() { return null; } deletePassword() { return false; } } }),
  });
  assert.equal(info.backend, 'encrypted-file');
});

test('vault: uses keychain when probe works', async () => {
  const mem = new Map<string, string>();
  const { info, store } = await openVault({
    service: 'kt', dir: tmp(),
    loadKeyring: async () => ({
      Entry: class {
        constructor(private s: string, private u: string) {}
        setPassword(v: string) { mem.set(this.s + this.u, v); }
        getPassword() { return mem.get(this.s + this.u) ?? null; }
        deletePassword() { return mem.delete(this.s + this.u); }
      },
    }),
  });
  assert.equal(info.backend, 'os-keychain');
  await store.set('x', 'y');
  assert.equal(await store.get('x'), 'y');
});

test('guard: host, origin, sec-fetch-site, token', () => {
  const g = createRequestGuard({ token: 't0k', allowedHosts: () => ['127.0.0.1:9'], publicPaths: ['/health'] });
  const h = { host: '127.0.0.1:9', authorization: 'Bearer t0k' };
  assert.equal(g({ url: '/v1/x', headers: h }).ok, true);
  assert.equal((g({ url: '/v1/x', headers: { ...h, host: 'evil.com:9' } }) as any).code, 'bad_host');
  assert.equal((g({ url: '/v1/x', headers: { ...h, origin: 'http://evil.com' } }) as any).code, 'bad_origin');
  assert.equal((g({ url: '/v1/x', headers: { ...h, 'sec-fetch-site': 'cross-site' } }) as any).code, 'cross_site');
  assert.equal((g({ url: '/v1/x', headers: { host: '127.0.0.1:9' } }) as any).code, 'unauthorized');
  assert.equal((g({ url: '/v1/x', headers: { ...h, authorization: 'Bearer nope' } }) as any).status, 401);
  assert.equal(g({ url: '/health', headers: { host: '127.0.0.1:9' } }).ok, true);
});

test('runtime file: roundtrip, 0600, owner-only clear', () => {
  const f = path.join(tmp(), 'runtime.json');
  const info = { pid: process.pid, host: '127.0.0.1', port: 1, token: generateToken(), version: '1', startedAt: 'now' };
  writeRuntime(f, info);
  assert.deepEqual(readRuntime(f), info);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  clearRuntime(f, process.pid + 1);
  assert.ok(readRuntime(f));
  clearRuntime(f);
  assert.equal(readRuntime(f), null);
});
