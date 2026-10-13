// The double-click launchers for people who download the ZIP: present, runnable, and pointing at the right place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
test('launchers: the .command file is executable bash with valid syntax; both start the ui from the right folder and explain a missing Node', () => {
  const cmd = path.join(root, 'Start-site-explorer.cmd'), sh = path.join(root, 'Start-site-explorer.command');
  const c = fs.readFileSync(cmd, 'utf8'), s = fs.readFileSync(sh, 'utf8');
  assert.match(s, /^#!\/usr\/bin\/env bash/); assert.match(s, /plugins\/site-explorer\/bin\/site-explorer\.mjs ui/); assert.match(c, /plugins\\site-explorer\\bin\\site-explorer\.mjs" ui/);
  for (const t of [c, s]) { assert.match(t, /nodejs\.org/); assert.match(t, /npm ci/); assert.ok(fs.existsSync(path.join(root, 'plugins', 'site-explorer', 'bin', 'site-explorer.mjs'))); }
  if (process.platform !== 'win32') { assert.ok(fs.statSync(sh).mode & 0o100, 'executable bit'); assert.equal(spawnSync('bash', ['-n', sh]).status, 0); }
  assert.ok(!/\r\n/.test(s), 'LF line endings in the shell script');
  assert.match(c, /"%RC%"=="10"/, 'closes by itself after the Quit button (exit code 10) and stays open with the code on any other exit'); assert.match(c, /pause/); for (const t of [c, s]) assert.match(t, /Quit/, 'tells people about the Quit button');
  // Windows cmd: the window vanished when non-ASCII text or an unescaped parenthesis sat inside a block; keep the script plain and block-free
  assert.ok(!/[^\x00-\x7f]/.test(c), 'ASCII only'); assert.ok(/\r\n/.test(c) && !/[^\r]\n/.test(c), 'CRLF line endings');
  assert.ok(!/^\s*\(|\(\s*$/m.test(c.replace(/\('node -v'\)/g, '')), 'no parenthesised blocks (a stray ) inside one aborts the whole script)');
  for (const l of c.split(/\r?\n/)) if (/^\s*echo\b/i.test(l)) assert.ok(!/[()&|<>^%]/.test(l.replace('%RC%', '')), 'echo line is safe for cmd: ' + l);
});
