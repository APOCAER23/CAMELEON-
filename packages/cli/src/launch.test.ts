import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin.js');
const KEY = 'sk-or-v1-LAUNCHTESTSECRETKEY000001';
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A fake agent: records argv, selected env vars and the OpenCode config, then exits with FAKE_EXIT. */
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (Fake)'); process.exit(0); }
const cfgPath = process.env.OPENCODE_CONFIG;
fs.writeFileSync(process.env.FAKE_OUT, JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), cfgPath: cfgPath || null,
  cfg: cfgPath && fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(ANTHROPIC|CAMELEON|OPENCODE|CODEX|OPENAI|CLAUDE)/.test(k))),
}));
process.exit(Number(process.env.FAKE_EXIT || 0));
`;
function binDir(names: string[]) {
  const d = tmp('fakebin-');
  for (const n of names) {
    fs.writeFileSync(path.join(d, n), FAKE, { mode: 0o755 });
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(d, `${n}.cmd`), `@node "${path.join(d, n)}" %*\r\n`);
    }
  }
  return d;
}

const home = tmp('cli-home-');
const out = path.join(home, 'out.json');
const workdir = tmp('proj-');
const baseEnv = (bin: string, extra: Record<string, string> = {}) => ({
  ...process.env, CAMELEON_HOME: home, CAMELEON_NO_METER: '1', PATH: `${bin}${path.delimiter}${process.env['PATH']}`, FAKE_OUT: out, NO_COLOR: '1', ...extra,
});
const cli = (args: string[], env: NodeJS.ProcessEnv, input?: string) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, input, encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: `${r.stdout}\n${r.stderr}` };
};
const readOut = () => { const j = JSON.parse(fs.readFileSync(out, 'utf8')); fs.rmSync(out); return j; };

test('cameleon launch: real subprocesses, documented mechanisms, secrets only in env, exit code propagated', () => {
  const binAll = binDir(['claude', 'opencode', 'codex', 'copilot']);
  const env = baseEnv(binAll);
  try {
    // setup — key via stdin, manual model (no network needed)
    assert.equal(cli(['provider', 'configure', 'openrouter', '--label', 'w', '--key-stdin', '--no-test', '--no-sync'], env, `${KEY}\n`).code, 0);
    assert.equal(cli(['models', 'add', 'openrouter', 'vendor/smart', '--context', '200000', '--max-output', '8192', '--tools', 'yes'], env).code, 0);

    // ── Claude Code
    let r = cli(['launch', 'claude', '-p', 'openrouter', '-m', 'vendor/smart', '--cwd', workdir, '--', '--verbose'],
      { ...env, FAKE_EXIT: '7', ANTHROPIC_BASE_URL: 'http://evil.example', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'sk-ant-LEAKED-FROM-PARENT' });
    assert.equal(r.code, 7); // the real exit status comes back
    let o = readOut();
    assert.deepEqual(o.argv, ['--verbose']);
    assert.equal(fs.realpathSync(o.cwd), fs.realpathSync(workdir));
    assert.deepEqual([o.env.ANTHROPIC_BASE_URL, o.env.ANTHROPIC_AUTH_TOKEN, o.env.ANTHROPIC_API_KEY, o.env.ANTHROPIC_MODEL, 'CLAUDE_CODE_USE_BEDROCK' in o.env],
      ['https://openrouter.ai/api', KEY, '', 'vendor/smart', false]); // parent's conflicting variables neutralised
    assert.ok(!r.all.includes(KEY) && !o.argv.join(' ').includes(KEY));
    assert.match(r.all, /limited/);

    // ── OpenCode: temp config exists during the run, contains no secret, is deleted afterwards
    r = cli(['launch', 'opencode', '-p', 'openrouter', '-m', 'vendor/smart'], env);
    assert.equal(r.code, 0);
    o = readOut();
    const cfg = JSON.parse(o.cfg);
    assert.equal(cfg.model, 'cameleon-openrouter/vendor/smart');
    assert.equal(cfg.provider['cameleon-openrouter'].options.apiKey, '{env:CAMELEON_API_KEY}');
    assert.ok(!o.cfg.includes(KEY));
    assert.equal(o.env.CAMELEON_API_KEY, KEY);
    assert.equal(fs.existsSync(o.cfgPath), false, 'temporary config must be removed after the session');
    assert.equal(fs.existsSync(path.dirname(o.cfgPath)), false);

    // ── Codex: one-off provider via -c, key referenced by env name only
    r = cli(['launch', 'codex', '-p', 'openrouter', '-m', 'vendor/smart'], env);
    assert.equal(r.code, 0);
    o = readOut();
    assert.deepEqual(o.argv.slice(0, 2), ['-m', 'vendor/smart']);
    assert.ok(o.argv.some((a: string) => a.includes('env_key = "CAMELEON_API_KEY"')));
    assert.ok(!o.argv.join(' ').includes(KEY));
    assert.equal(o.env.CAMELEON_API_KEY, KEY);

    // ── dry run: nothing started, secrets masked
    r = cli(['launch', 'claude', '-p', 'openrouter', '-m', 'vendor/smart', '--dry-run'], env);
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(out));
    assert.ok(!r.all.includes(KEY));
    assert.match(r.all, /Dry run/);
    assert.match(r.all, /ANTHROPIC_AUTH_TOKEN=sk-or-…0001/);
    assert.equal(cli(['agent', 'inspect', 'claude', '-p', 'openrouter', '-m', 'vendor/smart'], env).code, 0);

    // ── refusals: incompatible, missing model (non-interactive)
    assert.equal(cli(['provider', 'configure', 'groq', '--key-stdin', '--no-test', '--no-sync'], env, 'gsk_GROQLAUNCHTESTKEY0002\n').code, 0);
    assert.equal(cli(['models', 'add', 'groq', 'llama-x', '--tools', 'yes'], env).code, 0);
    r = cli(['launch', 'claude', '-p', 'groq', '-m', 'llama-x'], env);
    assert.equal(r.code, 1);
    assert.match(r.all, /Anthropic Messages|needs anthropic|translation proxy/i);
    assert.ok(!fs.existsSync(out), 'an incompatible launch must not start the agent');
    r = cli(['launch', 'claude', '-p', 'openrouter'], env);
    assert.equal(r.code, 1);
    assert.match(r.all, /--provider and --model/);
    assert.equal(cli(['launch', 'bogus', '-p', 'openrouter', '-m', 'vendor/smart'], env).code, 1);

    // ── profiles: create → switch → bare `cameleon launch`
    assert.equal(cli(['profile', 'create', 'Coding', '--agent', 'claude', '-p', 'openrouter', '-m', 'vendor/smart', '--args', `--verbose --note 'two words'`], env).code, 0);
    assert.match(cli(['profile', 'list'], env).stdout, /Coding/);
    assert.equal(cli(['launch'], env).code, 1); // no active profile yet
    assert.equal(cli(['profile', 'switch', 'coding'], env).code, 0);
    r = cli(['launch'], env);
    assert.equal(r.code, 0);
    o = readOut();
    assert.deepEqual(o.argv, ['--verbose', '--note', 'two words']);
    assert.match(r.all, /Using profile "Coding"/);
    assert.equal(cli(['launch', '--profile', 'Coding', '--', '--extra'], env).code, 0);
    assert.deepEqual(readOut().argv, ['--verbose', '--note', 'two words', '--extra']);

    // ── agents and status
    const agents = JSON.parse(cli(['agent', 'list', '--json', '--refresh'], env).stdout);
    assert.deepEqual(agents.map((a: { id: string; installed: boolean }) => [a.id, a.installed]), [['claude-code', true], ['opencode', true], ['codex', true], ['github-copilot', true]]);
    const st = cli(['status'], env).stdout;
    assert.match(st, /Agents\s+4 of 4 installed/);
    assert.match(st, /Profile\s+Coding/);

    // ── not installed: the engine restarts with a PATH that lacks codex → install guide, nothing started
    cli(['engine', 'stop'], env);
    const binTwo = binDir(['claude', 'opencode']);
    // keep the real PATH minus the fake dirs so no stray codex can be found
    const noCodex = { ...baseEnv(binTwo), PATH: `${binTwo}${path.delimiter}${(process.env['PATH'] ?? '').split(path.delimiter).filter((d) => d !== binAll).join(path.delimiter)}` };
    r = cli(['launch', 'codex', '-p', 'openrouter', '-m', 'vendor/smart'], noCodex);
    assert.equal(r.code, 1);
    assert.match(r.all, /not installed/);
    assert.match(r.all, /npm install -g @openai\/codex/);
    assert.ok(!fs.existsSync(out));
  } finally {
    cli(['engine', 'stop'], env);
  }
});
