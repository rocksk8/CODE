// Webhook notifications after a run, and the schedule helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldNotify, buildPayload, postWebhook, scheduleText } from '../scripts/notify.mjs';

test('shouldNotify: always, issues, and drop (score fell enough, or more urgent problems than before)', () => {
  assert.equal(shouldNotify('always', {}), true);
  assert.equal(shouldNotify('issues', { urgent: 0 }), false); assert.equal(shouldNotify('issues', { urgent: 2 }), true);
  assert.equal(shouldNotify('drop', { score: 80, prevScore: 90, maxDrop: 5 }), true); assert.equal(shouldNotify('drop', { score: 88, prevScore: 90, maxDrop: 5 }), false);
  assert.equal(shouldNotify('drop', { score: 90, prevScore: 90, urgent: 3, prevUrgent: 1 }), true); assert.equal(shouldNotify('drop', { score: 90, prevScore: null, urgent: 3, prevUrgent: null }), false, 'a first run has nothing to compare with');
});
test('buildPayload: a readable text line plus the numbers; hostile text is cleaned and bounded', () => {
  const p = buildPayload({ url: 'https://a.com/', score: 71, grade: 'C', prevScore: 80, urgent: 2, fixes: [{ title: 'Fix `x` <b>' + 'y'.repeat(500), severity: 'high' }], lang: 'en' });
  assert.match(p.text, /health 71 \(C\), -9 since last run, 2 high\/critical/); assert.equal(p.delta, -9); assert.ok(p.topFixes[0].title.length <= 160); assert.doesNotMatch(p.text, /[`<>]/);
  assert.match(buildPayload({ url: 'https://a.com/', score: 71, grade: 'C', prevScore: 80, urgent: 0 }).text, /健檢 71 分（C）/);
});
test('postWebhook: posts JSON, reports the status, refuses non-http addresses and never throws', async () => {
  let got = null; const srv = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = { ct: q.headers['content-type'], body: JSON.parse(b) }; r.writeHead(204); r.end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { const ok = await postWebhook(`http://127.0.0.1:${srv.address().port}/h`, { text: 'hi' }); assert.equal(ok.ok, true); assert.equal(got.ct, 'application/json'); assert.equal(got.body.text, 'hi'); }
  finally { srv.close(); }
  assert.equal((await postWebhook('file:///etc/passwd', {})).ok, false); assert.equal((await postWebhook('nonsense', {})).ok, false); assert.equal((await postWebhook('http://127.0.0.1:1/x', {})).ok, false);
});
test('scheduleText: a schtasks line on Windows, a cron line elsewhere, a GitHub Actions snippet; bad input is refused', () => {
  const w = scheduleText({ url: 'example.com', every: 'day', at: '07:05', platform: 'win32', node: 'C:\\n\\node.exe', bin: 'C:\\s\\bin.mjs', webhook: 'https://hooks.example/x', lang: 'en' });
  assert.match(w, /schtasks \/Create \/TN "site-explorer example.com" \/SC DAILY \/ST 07:05/); assert.match(w, /--webhook/); assert.match(w, /cron: "5 23 \* \* \*"/, '07:05 at UTC+8 is 23:05 UTC the day before');
  const l = scheduleText({ url: 'https://example.com', every: 'week', at: '08:30', platform: 'linux', node: '/usr/bin/node', bin: '/x/bin.mjs', lang: 'en' }); assert.match(l, /^macOS \/ Linux/); assert.match(l, /30 8 \* \* 1 "\/usr\/bin\/node"/);
  assert.throws(() => scheduleText({ url: 'example.com', at: '25:00' })); assert.throws(() => scheduleText({ url: 'example.com', every: 'hour' })); assert.throws(() => scheduleText({ url: '--out' }));
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('check --webhook: sends the summary with --notify-on always, stays quiet with drop on a first run, and refuses a bad address up front', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notify test page</title></head><body><h1>Hi</h1><p>Words here.</p></body></html>'); });
  const posts = []; const hook = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { posts.push(JSON.parse(b)); r.writeHead(200); r.end('ok'); }); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${site.address().port}/`, wh = `http://127.0.0.1:${hook.address().port}/h`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-ntf-'));
  const go = (extra, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'check', url, '--no-open', '--no-link-check', '--max-pages', '1', '--lang', 'en', ...extra, '--out', path.join(dir, out)], { env: { ...process.env, SITE_EXPLORER_DB: path.join(dir, 'n.db') } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o })); });
  try {
    const a = await go(['--webhook', wh, '--notify-on', 'always'], 'a'); assert.equal(a.status, 0, a.o); assert.match(a.o, /Notification sent/); assert.equal(posts.length, 1); assert.match(posts[0].text, /site-explorer: /); assert.ok(Number.isFinite(posts[0].score));
    const b = await go(['--webhook', wh], 'b'); assert.equal(b.status, 0, b.o); assert.equal(posts.length, 1, 'same score as last time: nothing sent'); assert.match(b.o, /No change worth a notification/);
    const c = await go(['--webhook', 'ftp://x'], 'c'); assert.equal(c.status, 1); assert.match(c.o, /--webhook/);
  } finally { site.close(); hook.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
