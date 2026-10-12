// Firefox and WebKit (experimental): the core exploration must work on them. Runs only where those engines are installed (the "engines" workflow installs them);
// elsewhere it is skipped, so a normal `npm test` is unaffected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args, env = {}) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '2', '--lang', 'en'], { env: { ...process.env, ...env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
const available = async (engine) => { try { const pw = await import('playwright-core'); const b = await pw[engine].launch(); await b.close(); return true; } catch { return false; } };
const page = (n) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Engine test ${n}</title><meta name="description" content="A page used to test that the exploration works on more than one browser engine."><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Georgia,serif;margin:0}header{background:#123;color:#fff;padding:20px}.btn{background:#e4572e;color:#fff;border:0;border-radius:8px;padding:12px 24px}section{padding:40px 20px}</style></head><body><header><a href="/">Home</a> <a href="/about">About</a></header><section><h1>Engine test ${n}</h1><p>${'Words so that the page has real content for the checks. '.repeat(8)}</p><button class="btn">Go</button></section></body></html>`;

for (const engine of ['firefox', 'webkit']) {
  test(`explore --browser ${engine}: pages, design tokens, health, screenshots, dashboard`, async (t) => {
    if (!(await available(engine))) return t.skip(`${engine} is not installed`);
    const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(page(q.url)); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-eng-'));
    try {
      const r = await run([url, '--browser', engine, '--out', path.join(dir, 'o')]); assert.equal(r.status, 0, r.out);
      const site = path.join(dir, 'o', 'site', fs.readdirSync(path.join(dir, 'o', 'site'))[0]);
      const sj = JSON.parse(fs.readFileSync(path.join(site, 'site.json'), 'utf8')); assert.ok(sj.pages.length >= 1);
      assert.ok(fs.existsSync(path.join(site, 'pages', 'home', 'desktop.png')) && fs.statSync(path.join(site, 'pages', 'home', 'desktop.png')).size > 1000, 'screenshot');
      const tokens = JSON.parse(fs.readFileSync(path.join(site, 'design-bundle', 'tokens.json'), 'utf8')); assert.ok(tokens.color && Object.keys(tokens.color).length > 0);
      assert.ok(fs.existsSync(path.join(site, 'health.json')) && fs.existsSync(path.join(dir, 'o', 'dashboard.html')));
      const pj = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'home', 'page.json'), 'utf8')); assert.ok(pj.content.headings.length >= 1 && pj.layout.docHeight > 100);
      const bad = await run([url, '--browser', engine, '--throttle', 'mobile', '--out', path.join(dir, 'x')]); assert.equal(bad.status, 1);
    } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('--browser with a bad value is rejected before anything runs', async () => {
  const r = await run(['http://127.0.0.1:1/', '--browser', 'netscape', '--out', path.join(os.tmpdir(), 'se-eng-bad')]); assert.equal(r.status, 1); assert.match(r.out, /--browser must be/);
});
