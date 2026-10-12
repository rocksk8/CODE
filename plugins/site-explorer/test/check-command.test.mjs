import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('help lists the one-step "check" command in both languages', () => {
  const zh = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }).stdout, en = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', env: { ...process.env, SITE_EXPLORER_LANG: 'en' } }).stdout;
  assert.match(zh, /site-explorer check <網址>/); assert.match(en, /site-explorer check <url>/); assert.doesNotMatch(en, /[一-鿿]{3}/, 'English help has no Chinese');
});

test('check <url>: one command, quick (no 3D capture, no handoff), prints what to fix first, and --max-pages still wins', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><nav>${[1, 2, 3, 4].map((i) => `<a href="/p${i}">p${i}</a>`).join(' ')}</nav><h1>Hello</h1><p>${'Some words. '.repeat(30)}</p></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-chk-'));
  try {
    const res = await new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'check', url, '--max-pages', '2', '--no-open', '--no-db', '--lang', 'en', '--out', dir], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
    assert.equal(res.status, 0, res.out); assert.match(res.out, /Fix these first/); assert.ok(!fs.existsSync(path.join(dir, 'motion')), 'no 3D capture'); assert.ok(!fs.existsSync(path.join(dir, 'handoff')), 'no handoff'); assert.ok(fs.existsSync(path.join(dir, 'dashboard.html')));
    const sd = path.join(dir, 'site', fs.readdirSync(path.join(dir, 'site'))[0]); assert.equal(JSON.parse(fs.readFileSync(path.join(sd, 'site.json'), 'utf8')).pages.length, 2); assert.ok(fs.existsSync(path.join(sd, 'top-fixes.md')));
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
