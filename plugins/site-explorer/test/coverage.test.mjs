// Unused JavaScript / CSS: the arithmetic, and a real page that ships far more code than it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeCoverage } from '../scripts/coverage.mjs';

test('summarizeCoverage: used ranges are subtracted, inner unused blocks count as unused, other hosts are marked, junk is ignored', () => {
  const src = 'a'.repeat(1000);
  const js = [{ url: 'https://x.com/app.js?v=1', source: src, functions: [{ ranges: [{ startOffset: 0, endOffset: 1000, count: 1 }, { startOffset: 200, endOffset: 800, count: 0 }] }] }, { url: '', source: src, functions: [] }, { url: 'chrome-extension://x/a.js', source: src, functions: [] }];
  const css = [{ url: 'https://x.com/a.css', text: 'b'.repeat(400), ranges: [{ start: 0, end: 100 }] }];
  const r = summarizeCoverage(js, css, 'x.com'); assert.equal(r.js.files, 1); assert.equal(r.js.bytes, 1000); assert.equal(r.js.unused, 600); assert.equal(r.css.unused, 300); assert.equal(r.js.top[0].url, 'https://x.com/app.js');
  assert.equal(summarizeCoverage(null, null, 'x.com').js.bytes, 0);
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('health: a page that ships much more JS and CSS than it uses is told so; a lean page is not', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const fn = (i) => `function unused${i}(a,b){var s=0;for(var k=0;k<a;k++){s+=k*b+${i};}return s+Math.sqrt(a*b)+"padding padding padding padding"}`;
  const bigJs = Array.from({ length: 4000 }, (_, i) => fn(i)).join('\n') + '\nwindow.__used=1;';
  const bigCss = Array.from({ length: 3000 }, (_, i) => `.unused-class-${i}{color:#${(i * 77 % 4096).toString(16).padStart(3, '0')};margin:${i % 9}px;padding:4px 8px}`).join('\n') + '\nbody{margin:0;font:16px sans-serif}';
  const html = (js, css) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Coverage test page for the unused code audit</title><meta name="description" content="A page used to test the unused JavaScript and CSS audit with enough words to be a real description."><link rel="stylesheet" href="${css}"><script src="${js}" defer></script></head><body><h1>Coverage</h1><p>${'Some real text for the page. '.repeat(20)}</p></body></html>`;
  const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; if (p === '/robots.txt' || p === '/favicon.ico') { r.statusCode = 404; return r.end(); }
    if (p === '/big.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(bigJs); } if (p === '/big.css') { r.writeHead(200, { 'content-type': 'text/css' }); return r.end(bigCss); }
    if (p === '/lean.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end('window.__used=1;'); } if (p === '/lean.css') { r.writeHead(200, { 'content-type': 'text/css' }); return r.end('body{margin:0;font:16px sans-serif}h1{color:#222}'); }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(p === '/lean' ? html('/lean.js', '/lean.css') : html('/big.js', '/big.css')); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cov-'));
  const go = (u, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'check', u, '--no-open', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', path.join(dir, out)], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o })); });
  const ids = (out) => { const sd = path.join(dir, out, 'site', fs.readdirSync(path.join(dir, out, 'site'))[0]); return JSON.parse(fs.readFileSync(path.join(sd, 'health.json'), 'utf8')).issues.map((i) => i.id); };
  try {
    const a = await go(base + '/fat', 'a'); assert.equal(a.status, 0, a.o); const ia = ids('a'); assert.ok(ia.includes('unused-js'), ia.join(',')); assert.ok(ia.includes('unused-css'), ia.join(','));
    const b = await go(base + '/lean', 'b'); assert.equal(b.status, 0, b.o); const ib = ids('b'); assert.ok(!ib.includes('unused-js') && !ib.includes('unused-css'), ib.join(','));
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
