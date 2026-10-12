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
});
