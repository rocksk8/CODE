// Time limits, quiet heartbeat, low-memory stop and CPU notice for long runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageLimitMs, runLimitMs, isLowMemory, watchChild } from '../scripts/guard.mjs';

test('limits: sensible defaults, overridable, memory rule', () => {
  assert.equal(stageLimitMs('crawl.mjs', {}), 30 * 60000); assert.equal(stageLimitMs('health-check.mjs', {}), 15 * 60000); assert.equal(stageLimitMs('export-design.mjs', {}), 10 * 60000);
  assert.equal(stageLimitMs('crawl.mjs', { SITE_EXPLORER_STAGE_LIMIT_MS: '1500' }), 1500); assert.equal(stageLimitMs('crawl.mjs', { SITE_EXPLORER_STAGE_MINUTES: '20' }), 60 * 60000);
  assert.equal(runLimitMs({}), 120 * 60000); assert.equal(runLimitMs({ SITE_EXPLORER_MAX_MINUTES: '5' }), 5 * 60000);
  const GB = 1024 ** 3; assert.equal(isLowMemory(0.1 * GB, 16 * GB), true); assert.equal(isLowMemory(0.3 * GB, 16 * GB), true, '4 % of 16 GB is 655 MB'); assert.equal(isLowMemory(4 * GB, 16 * GB), false); assert.equal(isLowMemory(200 * 1048576, 1 * GB), true); assert.equal(isLowMemory(500 * 1048576, 8 * GB), false);
});

const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
const closed = (c) => new Promise((r) => c.on('close', r));
test('watchChild: a stage over its time limit is stopped and reported; one that is merely quiet gets a heartbeat; low memory stops it; high load only warns', async () => {
  const notes = []; const c1 = sleeper(); const stop1 = watchChild(c1, { limitMs: 300, tickMs: 50, notify: (k, t) => notes.push([k, t]), memoryReader: () => ({ avail: 8e9, total: 16e9 }), loadReader: () => 0 });
  await closed(c1); stop1(); assert.equal(notes.at(-1)[0], 'timeout'); assert.match(notes.at(-1)[1], /超時通知/);
  const n2 = []; const c2 = sleeper(); const s2 = watchChild(c2, { limitMs: 60000, tickMs: 40, quietMs: 120, lang: 'en', notify: (k, t) => n2.push([k, t]), memoryReader: () => ({ avail: 8e9, total: 16e9 }), loadReader: () => 0 });
  await new Promise((r) => setTimeout(r, 450)); s2(); c2.kill(); assert.ok(n2.some(([k, t]) => k === 'quiet' && /Still running/.test(t)), JSON.stringify(n2));
  const n3 = []; const c3 = sleeper(); const s3 = watchChild(c3, { limitMs: 60000, tickMs: 30, lang: 'en', notify: (k, t) => n3.push([k, t]), memoryReader: () => ({ avail: 50e6, total: 16e9 }), loadReader: () => 0 });
  await closed(c3); s3(); assert.equal(n3.at(-1)[0], 'memory'); assert.match(n3.at(-1)[1], /Low-memory notice/);
  const n4 = []; const c4 = sleeper(); const s4 = watchChild(c4, { limitMs: 60000, tickMs: 20, lang: 'en', notify: (k, t) => n4.push([k, t]), memoryReader: () => ({ avail: 8e9, total: 16e9 }), loadReader: () => 99, cores: 2 });
  await new Promise((r) => setTimeout(r, 400)); s4(); c4.kill(); assert.ok(n4.some(([k]) => k === 'cpu'), 'a saturated CPU is announced'); assert.ok(!n4.some(([k]) => k === 'timeout' || k === 'memory'), 'and does not stop anything');
});

test('explore: a stage past its limit is stopped with a notice, the run does not hang and says so at the end', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } setTimeout(() => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>slow</title><h1>slow</h1>'); }, 20000); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-grd-'));
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
  try {
    const res = await new Promise((resolve) => { const t0 = Date.now(); const p = spawn(process.execPath, [bin, 'explore', url, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', path.join(dir, 'o')], { env: { ...process.env, SITE_EXPLORER_STAGE_LIMIT_MS: '4000' } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o, ms: Date.now() - t0 })); });
    assert.match(res.o, /Timeout notice/, res.o.slice(-1500)); assert.match(res.o, /Timeout \/ resource notices of this run/); assert.ok(res.ms < 90000, 'finished in ' + res.ms + ' ms');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
