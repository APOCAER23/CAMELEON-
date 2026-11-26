import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  buildInAppCommand,
  startInAppSession,
  writeInAppSession,
  resizeInAppSession,
  killInAppSession,
} from './inapp-terminal.js';

test('inapp-terminal: buildInAppCommand constructs shell and agent commands safely', () => {
  const winShell = buildInAppCommand('win32', 'node', 'cli.js', null, 'C:\\proj');
  assert.equal(winShell.command, 'cmd.exe');
  assert.equal(winShell.cwd, 'C:\\proj');

  const linuxShell = buildInAppCommand('linux', 'node', 'cli.js', null, '/tmp');
  assert.ok(linuxShell.args.includes('-i'));

  const agentCmd = buildInAppCommand('win32', 'node', 'cli.js', ['launch', 'claude-code', '--provider', 'anthropic', '--model', 'claude-x'], 'C:\\proj');
  assert.equal(agentCmd.command, 'node');
  assert.equal(agentCmd.title, 'claude-code');
  assert.deepEqual(agentCmd.args.slice(0, 3), ['cli.js', 'launch', 'claude-code']);
});

test('inapp-terminal: spawns PTY session, streams output, accepts input, resizes, and exits cleanly', async () => {
  const spec = {
    command: process.execPath,
    args: ['-e', 'process.stdin.on("data", d => { const s = d.toString().trim(); if (s) { process.stdout.write("ECHO:" + s + "\\n"); process.exit(0); } });'],
    cwd: os.tmpdir(),
    title: 'Echo Test',
  };

  let output = '';
  let exitCode: number | null = null;

  await new Promise<void>((resolve) => {
    const info = startInAppSession(
      spec,
      (_id, text) => {
        output += text;
      },
      (_id, code) => {
        exitCode = code;
        resolve();
      },
    );

    assert.ok(info.sessionId);
    assert.equal(resizeInAppSession(info.sessionId, 100, 35), true);
    const ok = writeInAppSession(info.sessionId, 'hello-inapp\r');
    assert.equal(ok, true);
  });

  assert.equal(exitCode, 0);
  assert.match(output, /ECHO:hello-inapp/);
});

test('inapp-terminal: killInAppSession and resizeInAppSession return false for unknown id', () => {
  assert.equal(killInAppSession('non-existent-id'), false);
  assert.equal(resizeInAppSession('non-existent-id', 80, 24), false);
});
