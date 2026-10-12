// The dashboard's enterprise shell: company logo in the top bar, grouped sidebar with icons, a title + description for every page, no horizontal scrolling on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
test('brand assets ship with the plugin and are transparent PNGs', () => {
  for (const f of ['logo-on-dark.png', 'mark.png']) { const b = fs.readFileSync(path.join(root, 'scripts', 'report', 'brand', f)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); assert.ok(b.length < 60000, f + ' stays small'); assert.equal(b[25], 6, f + ' has an alpha channel (colour type 6)'); }
});

test('dashboard: logo, grouped sidebar with icons, page title and description per tab, no script errors, no horizontal scroll on a phone', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shell test</title><meta name="description" content="A page for the dashboard shell test."></head><body><h1>Hello</h1><p>${'Some words. '.repeat(30)}</p></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-shell-'));
  try {
    const res = await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(root, 'bin', 'site-explorer.mjs'), 'explore', url, '--no-open', '--no-motion', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', dir], { env: process.env }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => resolve({ status, out })); });
    assert.equal(res.status, 0, res.out);
    const dash = path.join(dir, 'dashboard.html'); const html = fs.readFileSync(dash, 'utf8');
    assert.match(html, /class="logo" src="data:image\/png;base64,/); assert.match(html, /<link rel="icon" href="data:image\/png/);
    const { launchBrowser } = await import('../scripts/launch.mjs'); const br = await launchBrowser();
    try {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto('file://' + dash);
      assert.ok(await pg.locator('header img.logo').isVisible(), 'the logo is in the top bar');
      const n = await pg.locator('#tabs button').count(); assert.ok(n >= 5, 'tabs: ' + n); assert.equal(await pg.locator('#tabs button svg.ic').count(), n, 'every tab has an icon'); assert.ok((await pg.locator('#tabs .grp').count()) >= 3, 'tabs are grouped');
      for (const b of await pg.locator('#tabs button').all()) { if (!(await b.isVisible())) continue; await b.click(); assert.ok((await pg.locator('#ptitle').textContent()).length > 1, 'page title'); assert.ok((await pg.locator('#pdesc').textContent()).length > 5, 'page description'); assert.doesNotMatch(await pg.locator('#pdesc').textContent(), /[一-鿿]/, 'English description in an English dashboard'); }
      const side = await pg.locator('nav').boundingBox(); assert.ok(side.x < 5 && side.width > 200, 'sidebar on a wide screen');
      await ctx.close();
      // accessibility: no WCAG A/AA violations on any tab, in light or dark colours
      const { createRequire } = await import('node:module'); const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
      for (const scheme of ['light', 'dark']) {
        const c = await br.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme }); const ap = await c.newPage(); await ap.goto('file://' + dash); await ap.evaluate(axeSrc); const bad = [];
        const count = await ap.locator('#tabs button').count();
        for (let i = 0; i < count; i++) { const b = ap.locator('#tabs button').nth(i); if (!(await b.isVisible())) continue; await b.click(); await ap.waitForTimeout(400); const r = await ap.evaluate(async () => await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })); for (const v of r.violations) bad.push(`${scheme} tab${i} ${v.id}: ${v.nodes[0].html.slice(0, 100)}`); }
        await c.close(); assert.deepEqual(bad, [], 'accessibility violations');
      }
      const m = await br.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage(); await mp.goto('file://' + dash);
      assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scrolling on a phone');
      assert.deepEqual(errs, []);
    } finally { await br.close(); }
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('dashboard: history tab draws a health-score trend once the database holds two runs of the same site', async (t) => {
  try { await import('node:sqlite'); } catch { return t.skip('node:sqlite needs Node >= 22.13'); }
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trend test</title></head><body><h1>Hello</h1><p>Words.</p></body></html>'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-trend-'));
  const run = (out) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(root, 'bin', 'site-explorer.mjs'), 'explore', url, '--no-open', '--no-motion', '--no-link-check', '--max-pages', '1', '--lang', 'en', '--out', out], { env: { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 'x.db') } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o })); });
  try {
    const a = await run(path.join(tmp, 'a')); assert.equal(a.status, 0, a.o); const b = await run(path.join(tmp, 'b')); assert.equal(b.status, 0, b.o);
    const dash = path.join(tmp, 'b', 'dashboard.html');
    const { launchBrowser } = await import('../scripts/launch.mjs'); const br = await launchBrowser();
    try {
      const pg = await (await br.newContext()).newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto('file://' + dash);
      await pg.locator('#tabs button', { hasText: /History/i }).first().click();
      assert.ok(await pg.locator('#s-history .trend svg path.tl').count() >= 1, 'trend line drawn');
      assert.match(await pg.locator('#s-history .trend .tn').textContent(), /Compared with the previous run/);
      assert.deepEqual(errs, []);
    } finally { await br.close(); }
  } finally { site.close(); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
