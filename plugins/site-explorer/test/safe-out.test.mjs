// Output safety: the tool must never delete or overwrite files it did not create.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, tmp, siteDir, haveBrowser = true;
const run = (script, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => resolve({ status, out }));
});
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  if (!haveBrowser) return;
  server = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tiny site for output safety tests</title><meta name="viewport" content="width=device-width"></head><body><h1>Tiny</h1><p>' + 'word '.repeat(60) + '</p></body></html>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se safe-'));
  await run('crawl.mjs', [`http://127.0.0.1:${server.address().port}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'site')]);
  siteDir = path.join(tmp, 'site', `127.0.0.1_${server.address().port}`);
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });
const skip = (t) => (!haveBrowser ? (t.skip('no browser'), true) : false);

test('handoff refuses a folder that holds someone else\'s files — and leaves them untouched', async (t) => {
  if (skip(t)) return;
  const mine = path.join(tmp, 'precious'); fs.mkdirSync(path.join(mine, 'sub'), { recursive: true }); fs.writeFileSync(path.join(mine, 'thesis.docx'), 'my thesis draft'); fs.writeFileSync(path.join(mine, 'sub', 'notes.txt'), 'x');
  const r = await run('build-handoff.mjs', ['--site', siteDir, '--out', mine]);
  assert.equal(r.status, 1); assert.match(r.out, /資料夾不是空的/); assert.match(r.out, /不會動到你現有的檔案/);
  assert.equal(fs.readFileSync(path.join(mine, 'thesis.docx'), 'utf8'), 'my thesis draft'); assert.ok(fs.existsSync(path.join(mine, 'sub', 'notes.txt')));
  assert.deepEqual(fs.readdirSync(mine).sort(), ['sub', 'thesis.docx'], 'nothing was added either');
});

test('handoff refuses home, cwd (".") and filesystem root', async (t) => {
  if (skip(t)) return;
  const home = path.join(tmp, 'fakehome'); fs.mkdirSync(home); fs.writeFileSync(path.join(home, 'keep.txt'), 'k');
  let r = await run('build-handoff.mjs', ['--site', siteDir, '--out', home], { env: { HOME: home, USERPROFILE: home } }); assert.equal(r.status, 1); assert.match(r.out, /家目錄/);
  const cwd = path.join(tmp, 'work'); fs.mkdirSync(cwd); fs.writeFileSync(path.join(cwd, 'draft.md'), 'd');
  r = await run('build-handoff.mjs', ['--site', siteDir, '--out', '.'], { cwd }); assert.equal(r.status, 1); assert.match(r.out, /工作目錄/);
  r = await run('build-handoff.mjs', ['--site', siteDir, '--out', path.parse(tmp).root]); assert.equal(r.status, 1); assert.match(r.out, /根目錄/);
  assert.ok(fs.existsSync(path.join(home, 'keep.txt')) && fs.existsSync(path.join(cwd, 'draft.md')));
});

test('regenerating keeps the user\'s DECISIONS.md and any extra files; only generated files are refreshed', async (t) => {
  if (skip(t)) return;
  const out = path.join(tmp, 'handoff');
  assert.equal((await run('build-handoff.mjs', ['--site', siteDir, '--out', out])).status, 0);
  fs.appendFileSync(path.join(out, 'DECISIONS.md'), '\n### 2026-10-10　改用 Inter\n- 決策：標題改用 Inter\n');
  fs.writeFileSync(path.join(out, 'my-notes.txt'), 'client call notes'); fs.writeFileSync(path.join(out, 'SPEC.md'), 'STALE');
  assert.equal((await run('build-handoff.mjs', ['--site', siteDir, '--out', out])).status, 0);
  const d = fs.readFileSync(path.join(out, 'DECISIONS.md'), 'utf8');
  assert.match(d, /改用 Inter/); assert.match(d, /重新產生交接包/); assert.equal(fs.readFileSync(path.join(out, 'my-notes.txt'), 'utf8'), 'client call notes');
  assert.notEqual(fs.readFileSync(path.join(out, 'SPEC.md'), 'utf8'), 'STALE', 'generated files are refreshed');
  assert.equal(d.match(/## 已做決策/g).length, 1, 'the log is appended to, not duplicated');
});

test('single-file outputs must look like what they are (no clobbering ~/.zshrc by typo)', async (t) => {
  if (skip(t)) return;
  const f = path.join(tmp, '.zshrc'); fs.writeFileSync(f, 'export PATH=1');
  for (const script of ['build-report.mjs']) { const r = await run(script, ['--site', siteDir, '--out', f]); assert.equal(r.status, 1); assert.match(r.out, /\*\.html/); }
  assert.equal(fs.readFileSync(f, 'utf8'), 'export PATH=1');
});
