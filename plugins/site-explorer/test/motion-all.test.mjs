// Regression: with several animated pages, 3D / animation capture must cover every crawled page (it used to stop after a handful).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('default run captures motion for every crawled page (7 animated pages > the old cap of 5), in crawl order, and --motion-pages still caps it', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const N = 6, anim = '<style>@keyframes spin{to{transform:rotate(360deg)}}.s{width:80px;height:80px;background:#e33;animation:spin 2s linear infinite}</style>';
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } const n = (q.url.match(/^\/p(\d+)/) || [])[1]; r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${n ? 'Page ' + n : 'Home'}</title><meta name="description" content="Animated page ${n || 0} for the motion test.">${anim}</head><body><nav>${Array.from({ length: N }, (_, i) => `<a href="/p${i + 1}">P${i + 1}</a>`).join(' ')}</nav><h1>${n ? 'Page ' + n : 'Home'}</h1><div class="s"></div><p>${'Words here. '.repeat(40)}</p></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-mall-'));
  const go = (extra, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, ...extra, '--no-open', '--no-handoff', '--no-link-check', '--no-db', '--wait', '1000', '--lang', 'en', '--out', path.join(dir, out)], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); const kill = setTimeout(() => p.kill(), 600000); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out: o }); }); });
  const pagesOf = (out) => { const m = path.join(dir, out, 'motion'); const host = fs.readdirSync(m).find((x) => fs.existsSync(path.join(m, x, 'pages.json'))); return JSON.parse(fs.readFileSync(path.join(m, host, 'pages.json'), 'utf8')).pages; };
  try {
    const a = await go([], 'all'); assert.equal(a.status, 0, a.out);
    const pg = pagesOf('all'); assert.equal(pg.length, N + 1, 'start page + every linked page: ' + pg.map((p) => p.slug).join(',')); assert.equal(pg[0].slug, '(start)'); assert.equal(new Set(pg.map((p) => p.slug)).size, pg.length);
    assert.ok(pg.every((p) => p.targets > 0), 'each captured page found its animation'); assert.match(a.out, /3D \/ animation \[\d+\/\d+\]/);
    const b = await go(['--motion-pages', '3'], 'capped'); assert.equal(b.status, 0, b.out); assert.equal(pagesOf('capped').length, 3);
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
