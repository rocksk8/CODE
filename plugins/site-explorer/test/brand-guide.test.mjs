import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderBrandGuideHtml, contrastOf } from '../scripts/brand-guide.mjs';

test('brand guide: contrast maths, sections, merged colours; hostile site values cannot inject markup or CSS', () => {
  assert.equal(contrastOf('#000000', '#ffffff'), 21); assert.equal(contrastOf('#ffffff', '#ffffff'), 1);
  const tokens = {
    color: { brand: '#e2794d', 'evil"><script>alert(1)</script>': '#43b4e0', bad: 'red;}</style><script>x</script>' },
    palette: [{ hex: '#f6d85a', uses: 9, merged: ['#f6d85b', 'nope'] }, { hex: 'url(javascript:alert(1))', uses: 1 }],
    typography: { fontStack: { heading: "Georgia';}</style><script>1</script>", body: 'Inter' }, scale: { h1: { size: '32px', weight: '700', family: 'Inter' }, p: { size: '1;}</style>', weight: '400' } } },
    spacing: { observed: [4, 8, 16, 9999, -1] }, radius: ['8px', 'expression(alert(1))', '50%'], shadow: ['0 1px 2px rgba(0,0,0,.2)', '0 0 0 red;}</style><script>1</script>'],
    contrastAudit: [{ name: '<img src=x onerror=1>', fg: '#000000', bg: '#ffffff', ratio: 21, pass: true }, { name: 'x', fg: 'bad', bg: '#fff', ratio: 1, pass: false }],
  };
  const html = renderBrandGuideHtml(tokens, { url: 'https://x.test/<b>', when: '2026-10-12' });
  for (const must of ['#e2794d', '#f6d85a', '#f6d85b', '32px', 'Inter', 'border-radius:8px', 'box-shadow:0 1px 2px rgba(0,0,0,.2)', 'Content-Security-Policy']) assert.ok(html.includes(must), must);
  for (const bad of ['<script', 'onerror=1>', 'javascript:', 'expression(', '};</style', 'url(javascript']) assert.ok(!html.includes(bad), 'injected: ' + bad);
  assert.ok(!/<img src=x/.test(html)); assert.ok(!html.includes('9999px'));
  assert.match(renderBrandGuideHtml({}), /<h1>/);
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('explore --brand-guide writes design-bundle/brand-guide.html and a real PDF', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BG</title><meta name="description" content="A page for the brand guide test."><style>body{font:16px Georgia;color:#16181d;background:#fff}.b{background:#14b8a6;color:#fff;border-radius:10px;padding:8px}</style></head><body><h1>Hello</h1><p>${'Some words. '.repeat(20)}</p><a class="b" href="/x">Go</a></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-bg-'));
  try {
    const res = await new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, '--brand-guide', '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', dir], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
    assert.equal(res.status, 0, res.out);
    const sd = path.join(dir, 'site', fs.readdirSync(path.join(dir, 'site'))[0], 'design-bundle');
    const html = fs.readFileSync(path.join(sd, 'brand-guide.html'), 'utf8'); assert.match(html, /#14b8a6/i); assert.match(html, /Georgia/);
    const pdf = fs.readFileSync(path.join(sd, 'brand-guide.pdf')); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 3000);
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
