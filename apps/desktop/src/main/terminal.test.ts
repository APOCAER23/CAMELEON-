import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerminalCommand, isSafeModelId, manualCommand, shQuote } from './terminal.js';

const base = { nodeBin: '/usr/bin/node', cliBin: '/opt/cameleon/bin.js', cwd: "/home/u/my proj/it's", cliArgs: ['launch', 'claude', '--provider', 'openrouter', '--model', 'vendor/smart'] };

test('linux: user values travel as separate argv entries, never inside the shell script', () => {
  const c = buildTerminalCommand('linux', base, (n) => (n[0] === 'gnome-terminal' ? '/usr/bin/gnome-terminal' : null))!;
  assert.equal(c.command, '/usr/bin/gnome-terminal');
  assert.deepEqual(c.args.slice(0, 3), ['--', 'sh', '-c']);
  const script = c.args[3]!;
  assert.ok(!script.includes('claude') && !script.includes('proj') && !script.includes('vendor'));
  assert.deepEqual(c.args.slice(4), ['sh', base.cwd, base.nodeBin, base.cliBin, ...base.cliArgs]);
  assert.equal(buildTerminalCommand('linux', base, () => null), null);
  const shell = buildTerminalCommand('linux', { ...base, cliArgs: null }, () => '/usr/bin/xterm')!;
  assert.deepEqual(shell.args.slice(-2), ['sh', base.cwd]);
});

test('macOS: quoting survives hostile paths', () => {
  const c = buildTerminalCommand('darwin', { ...base, cwd: `/tmp/a'b "c"\\d` }, () => null)!;
  assert.equal(c.command, 'osascript');
  const script = c.args[1]!;
  assert.match(script, /^tell application "Terminal" to do script "cd /);
  // the AppleScript string must not be terminated early by a quote inside the path
  const inner = script.slice('tell application "Terminal" to do script "'.length, -1);
  assert.ok(!/(^|[^\\])"/.test(inner), 'unescaped double quote inside the AppleScript string');
});

test('windows: whole command is an argv array (no shell string concatenation)', () => {
  const c = buildTerminalCommand('win32', base)!;
  assert.equal(c.command, 'cmd.exe');
  assert.ok(c.args[3]?.includes(' '), 'start title must contain a space so Windows quotes it as title');
  assert.equal(c.args[c.args.indexOf('/k') + 1], 'call');
  assert.deepEqual(c.args.slice(-8), ['cmd.exe', '/k', base.nodeBin, base.cliBin, ...base.cliArgs].slice(-8));
});

test('manual fallback command is shell-quoted', () => {
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
  assert.match(manualCommand(base), /^'\/usr\/bin\/node' '\/opt\/cameleon\/bin\.js' 'launch' 'claude'/);
});

test('model validation accepts OpenRouter aliases without allowing shell metacharacters', () => {
  assert.equal(isSafeModelId('~anthropic/claude-sonnet-latest'), true);
  assert.equal(isSafeModelId('vendor/model&echo'), false);
});
