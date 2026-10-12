// Whole-page visual regression: --approve stores screenshots, --compare flags pixel changes with a difference image and exit code 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });

test('approve stores screenshots; same page passes; a visual change fails with a diff image; --no-visual ignores it; a tiny threshold change still passes with a high limit', async (t) => {
  let haveBrowser = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); const b = await launchBrowser(); await b.close(); } catch { haveBrowser = false; }
  if (!haveBrowser) return t.skip('no browser');
  let extra = '';
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual regression test page</title><meta name="description" content="A page used to test whole-page visual comparison against an approved baseline."><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Georgia,serif;margin:0;color:#202124}section{padding:60px 20px}.box{height:120px;background:#eee}</style></head><body><section><h1>Headline for the visual test</h1><p>${'A paragraph with enough words to look like real content. '.repeat(8)}</p>${extra}</section></body></html>`); });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-vis-')); const out = path.join(dir, 'o'); const bf = path.join(dir, 'base.json');
  try {
    const a = await run([url, '--approve', '--baseline', bf, '--out', out]); assert.equal(a.status, 0, a.out); assert.match(a.out, /full-page screenshots/);
    const vd = path.join(dir, 'base-visual'); assert.ok(fs.existsSync(path.join(vd, 'index.json')) && fs.readdirSync(vd).length >= 2, fs.readdirSync(dir).join());
    const same = await run([url, '--compare', '--baseline', bf, '--out', out]); assert.equal(same.status, 0, same.out); assert.match(same.out, /within the allowed range/i);
    extra = '<p>' + 'More text that moves everything below it and changes the page height. '.repeat(40) + '</p>';
    const bad = await run([url, '--compare', '--baseline', bf, '--out', out]); assert.equal(bad.status, 4, bad.out); assert.match(bad.out, /pixels differ/);
    assert.match(fs.readFileSync(path.join(out, 'visual.md'), 'utf8'), /✖ changed/); assert.ok(fs.readdirSync(path.join(out, 'visual-diff')).some((f) => /\.png$/.test(f)));
    const skip = await run([url, '--compare', '--baseline', bf, '--no-visual', '--out', out]); assert.equal(skip.status, 0, skip.out);
    const loose = await run([url, '--compare', '--baseline', bf, '--visual-threshold', '100', '--out', out]); assert.equal(loose.status, 0, loose.out);
    const badv = await run([url, '--compare', '--baseline', bf, '--visual-threshold', 'abc', '--out', out]); assert.equal(badv.status, 1);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
