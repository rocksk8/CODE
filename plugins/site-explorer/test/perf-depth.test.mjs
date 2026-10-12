// More performance depth: browser cache policy of static files, images without width/height, eager off-screen images, a lazy-loaded LCP image, HTTP/1.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cacheVerdict } from '../scripts/health-check.mjs';

test('cacheVerdict: long-lived and immutable are fine; none, no-cache, short are not', () => {
  assert.equal(cacheVerdict({ 'cache-control': 'public, max-age=31536000, immutable' }), null);
  assert.equal(cacheVerdict({ 'cache-control': 'max-age=604800' }), null);
  assert.deepEqual(cacheVerdict({ 'cache-control': 'no-store' }), { reason: 'no-cache', seconds: 0 });
  assert.deepEqual(cacheVerdict({ 'cache-control': 'public, max-age=60' }), { reason: 'short', seconds: 60 });
  assert.deepEqual(cacheVerdict({}), { reason: 'none', seconds: 0 });
  assert.deepEqual(cacheVerdict({ etag: '"x"' }), { reason: 'no-lifetime', seconds: 0 });
  assert.equal(cacheVerdict({ expires: new Date(Date.now() + 40 * 86400000).toUTCString(), date: new Date().toUTCString() }), null);
  assert.equal(cacheVerdict({ 'cache-control': 'public, immutable' }), null);
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('health: the new performance findings appear for a page that earns them, and not for a well-built page', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const makePng = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]); };
  const png = makePng(600, 400);
  const big = 'body{margin:0}' + '.a{color:red}'.repeat(2000);
  const bad = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slow page title for the performance depth test</title><meta name="description" content="A page that has several performance problems for the depth test, described in enough words."><link rel="stylesheet" href="/s.css"></head><body><h1>Slow</h1><img src="/i.png?1" loading="lazy" style="display:block;width:600px;height:400px" alt=""><img src="/s.png?2"><img src="/s.png?3"><div style="height:4000px">spacer</div><img src="/i.png?4" width="200" height="100" alt=""><img src="/i.png?5" width="200" height="100" alt=""><img src="/i.png?6" width="200" height="100" alt=""><p>${'Words fill the page so that it is real content. '.repeat(20)}</p></body></html>`;
  const good = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fast page title for the performance depth test</title><meta name="description" content="A page that is built well for the performance depth test, described in enough words."><link rel="stylesheet" href="/g.css"></head><body><h1>Fast</h1><img src="/i.png?9" width="600" height="400" alt="Hero"><p>${'Words fill the page so that it is real content. '.repeat(20)}</p></body></html>`;
  const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; if (p === '/robots.txt' || p === '/favicon.ico') { r.statusCode = 404; return r.end(); }
    if (p === '/s.css') { r.writeHead(200, { 'content-type': 'text/css' }); return r.end(big); }
    if (p === '/g.css') { r.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'public, max-age=31536000, immutable' }); return r.end(big); }
    if (p === '/s.png') { r.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }); return r.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')); }
    if (p === '/i.png') { r.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }); return r.end(png); }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(p === '/good' ? good : bad); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-pd-'));
  const go = (u, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'check', u, '--no-open', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', path.join(dir, out)], { env: { ...process.env, SITE_EXPLORER_LOCAL_HEADER_CHECKS: '1' } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o })); });
  const issues = (out) => { const sd = path.join(dir, out, 'site', fs.readdirSync(path.join(dir, out, 'site'))[0]); return JSON.parse(fs.readFileSync(path.join(sd, 'health.json'), 'utf8')).issues.map((i) => i.id); };
  try {
    const a = await go(base + '/bad', 'a'); assert.equal(a.status, 0, a.o); const ia = issues('a');
    for (const want of ['cache-policy', 'img-no-dimensions', 'img-offscreen-eager', 'lcp-lazy']) assert.ok(ia.includes(want), want + ' in ' + ia.join(','));
    const b = await go(base + '/good', 'b'); assert.equal(b.status, 0, b.o); const ib = issues('b');
    for (const no of ['cache-policy', 'img-no-dimensions', 'img-offscreen-eager', 'lcp-lazy', 'http1']) assert.ok(!ib.includes(no), no + ' should not be reported: ' + ib.join(','));
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
