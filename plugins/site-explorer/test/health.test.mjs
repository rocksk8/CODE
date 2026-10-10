// SEO / indexability health check against a deliberately unhealthy site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { sickSite } from './fixtures/sick-site.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let hard, soft, noindexAll, tmp, haveBrowser = true, H, siteDir;
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
const dirOf = (name, port) => path.join(tmp, name, `127.0.0.1_${port}`);
const ids = () => new Set(H.issues.map((i) => i.id));

before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  if (!haveBrowser) return;
  let ph, ps, pn;
  hard = http.createServer((q, r) => sickSite({ origin: () => `http://127.0.0.1:${ph}` })(q, r));
  soft = http.createServer((q, r) => sickSite({ soft404: true, origin: () => `http://127.0.0.1:${ps}` })(q, r));
  noindexAll = http.createServer((q, r) => { r.writeHead(q.url === '/robots.txt' ? 404 : 200, { 'content-type': 'text/html' }); r.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Staging site left on noindex</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width"></head><body><h1>Staging</h1><p>' + 'word '.repeat(200) + '</p></body></html>'); });
  [ph, ps, pn] = [await listen(hard), await listen(soft), await listen(noindexAll)];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se health-'));
  let r = await run('crawl.mjs', [`http://127.0.0.1:${ph}/`, '--max-pages', '12', '--out', path.join(tmp, 'a')]); assert.equal(r.status, 0, r.out);
  siteDir = dirOf('a', ph);
  r = await run('health-check.mjs', ['--site', siteDir]); assert.equal(r.status, 0, r.out);
  H = JSON.parse(fs.readFileSync(path.join(siteDir, 'health.json'), 'utf8'));
  await run('crawl.mjs', [`http://127.0.0.1:${ps}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'b')]);
  await run('health-check.mjs', ['--site', dirOf('b', ps), '--no-link-check']);
  await run('crawl.mjs', [`http://127.0.0.1:${pn}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'c')]);
  await run('health-check.mjs', ['--site', dirOf('c', pn), '--no-link-check']);
  globalThis.__paths = { soft: dirOf('b', ps), noindex: dirOf('c', pn) };
});
after(() => { hard?.close(); soft?.close(); noindexAll?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const skip = (t) => (!haveBrowser ? (t.skip('no browser'), true) : false);

test('finds the planted indexability problems', (t) => {
  if (skip(t)) return;
  for (const id of ['robots-syntax', 'sitemap-bad-urls', 'sitemap-cross-host', 'sitemap-noindex', 'noindex', 'nofollow-page', 'js-dependent', 'redirect-chain', 'redirect-temporary', 'status-errors', 'canonical-missing', 'ai-bots-blocked', 'ai-js-only']) assert.ok(ids().has(id), 'missing ' + id + ' in ' + [...ids()]);
  assert.match(H.issues.find((i) => i.id === 'ai-bots-blocked').title, /GPTBot/);
  assert.ok(H.facts.robots.aiBots.find((b) => b.bot === 'GPTBot').allowed === false);
  assert.ok(H.facts.robots.aiBots.find((b) => b.bot === 'ClaudeBot').allowed === true);
});

test('finds the planted on-page, link and mobile problems', (t) => {
  if (skip(t)) return;
  for (const id of ['title-duplicate', 'title-short', 'description-missing', 'h1-multiple', 'heading-skips', 'img-alt', 'anchor-generic', 'anchor-empty', 'broken-internal', 'internal-redirect', 'viewport-missing', 'thin-content']) assert.ok(ids().has(id), 'missing ' + id);
  const broken = H.links.broken.map((b) => new URL(b.url).pathname).sort();
  assert.deepEqual(broken, ['/gone', '/icon-only']);
});

test('no false positives on the healthy page, and error pages are not scored as content', (t) => {
  if (skip(t)) return;
  const about = H.pages.find((p) => p.url.endsWith('/about'));
  assert.ok(about.indexable && about.titleLen >= 20 && about.descLen >= 70 && about.h1 === 1);
  assert.equal(H.pages.filter((p) => p.url.endsWith('/about')).length, 1, '/about reached via /redir and /chain1 is ONE page');
  const dup = H.issues.find((i) => i.id === 'title-duplicate'); assert.equal(dup.affected, 2, 'only dup1/dup2 share a title (404 pages and redirects do not count)');
  for (const id of ['lang-missing', 'soft-404', 'robots-blocks-all', 'no-https', 'host-variants', 'h1-missing']) assert.ok(!ids().has(id), 'false positive ' + id);
  assert.ok(H.passed.some((p) => /不存在的網址正確回應 404/.test(p.title)));
});

test('soft-404 is detected when a missing URL returns 200', (t) => {
  if (skip(t)) return;
  assert.ok(JSON.parse(fs.readFileSync(path.join(globalThis.__paths.soft, 'health.json'), 'utf8')).issues.some((i) => i.id === 'soft-404'));
});

test('scoring: diminishing returns and a hard cap when something critical is wrong', (t) => {
  if (skip(t)) return;
  assert.ok(H.score > 25 && H.score < 80, 'sick site lands in the middle, not 0: ' + H.score);
  assert.ok(Object.values(H.categories).every((c) => c.score >= 0 && c.score <= 100));
  const n = JSON.parse(fs.readFileSync(path.join(globalThis.__paths.noindex, 'health.json'), 'utf8'));
  assert.ok(n.issues.some((i) => i.id === 'noindex' && i.severity === 'critical'));
  assert.ok(n.score <= 55, 'a site that is entirely noindex cannot score above 55: ' + n.score); assert.ok(/[DF]/.test(n.grade));
});

test('health.md is AI-readable and the dashboard health tab works', async (t) => {
  if (skip(t)) return;
  const md = fs.readFileSync(path.join(siteDir, 'health.md'), 'utf8');
  assert.match(md, /## 總分：\d+ \/ 100/); assert.match(md, /最該先處理的事/); assert.match(md, /怎麼修：/); assert.match(md, /\| GPTBot \|/);
  const dash = path.join(tmp, 'dash.html'); assert.equal((await run('build-report.mjs', ['--site', siteDir, '--out', dash])).status, 0);
  const b = await launchBrowser(), p = await b.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + dash); await p.click('#tabs button[data-k=health]');
  assert.match(await p.locator('.ring').innerText(), new RegExp(String(H.score)));
  const all = await p.locator('details.is').count(); await p.click('[data-cat=indexability]');
  assert.ok(await p.locator('details.is').count() < all, 'category filter narrows the list');
  for (const v of ['pages', 'crawl', 'sitemap', 'perf', 'sec']) { await p.click(`[data-view=${v}]`); }
  assert.match(await p.locator('#hv').innerText(), /TLS|HTTPS|傳輸/); assert.deepEqual(errs, []); await b.close();
});
