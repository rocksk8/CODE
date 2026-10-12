import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('dark mode: the colours the page really uses in dark mode are their own token set (background, text, surface, border, palette), and tokens.css carries them', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const css = (dark) => `body{margin:0;background:#ffffff;color:#16181d;font:16px Georgia}.card{background:#f3f5f8;border:1px solid #d0d5dd;padding:12px;margin:12px}${dark ? '@media (prefers-color-scheme: dark){body{background:#101418;color:#e6edf3}.card{background:#1a2128;border:1px solid #2b3540}}' : ''}`;
  const mk = (dark) => http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dark</title><meta name="description" content="A page for the dark mode test."><style>${css(dark)}</style></head><body><h1>Hello</h1><div class="card"><p>${'Some words. '.repeat(20)}</p></div></body></html>`); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-dark-'));
  const run = async (srv, out) => { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`;
    const res = await new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', path.join(dir, out)], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
    assert.equal(res.status, 0, res.out); const sd = path.join(dir, out, 'site', fs.readdirSync(path.join(dir, out, 'site'))[0], 'design-bundle'); srv.close();
    return { tokens: JSON.parse(fs.readFileSync(path.join(sd, 'tokens.json'), 'utf8')), css: fs.readFileSync(path.join(sd, 'tokens.css'), 'utf8') }; };
  try {
    const a = await run(mk(true), 'dark'); const dm = a.tokens.darkMode;
    assert.equal(dm.supported, true); assert.equal(dm.colors.background, '#101418'); assert.equal(dm.colors.text, '#e6edf3'); assert.equal(dm.colors.surface, '#1a2128'); assert.equal(dm.colors.border, '#2b3540'); assert.ok(dm.contrast >= 4.5); assert.ok(dm.palette.length >= 3);
    assert.equal(a.tokens.color.background, '#ffffff', 'the light tokens are unchanged'); assert.match(a.css, /prefers-color-scheme: dark[\s\S]*--color-surface: #1a2128/);
    const b = await run(mk(false), 'light'); assert.equal(b.tokens.darkMode.supported, false); assert.equal(b.tokens.darkMode.colors, undefined); assert.doesNotMatch(b.css, /prefers-color-scheme: dark/);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
