// Phone / tablet behaviour is measured at 1440, 768 and 390 — and the findings differ between a responsive and a broken page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { responsiveFindings, responsiveLine } from '../scripts/responsive.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
const text = '<p>' + 'Friendly words about what we make and why it matters to the people who use it every day. '.repeat(12) + '</p>';
const items = '<div class="grid"><div><h3>One</h3><p>First column with enough words to take space.</p></div><div><h3>Two</h3><p>Second column with enough words to take space.</p></div><div><h3>Three</h3><p>Third column with enough words to take space.</p></div></div>';
const nav = '<nav><a href="/a">Home</a> <a href="/b">Shop</a> <a href="/c">About</a> <a href="/d">Contact</a></nav>';
const page = (css, navHtml, extra) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive test page for measuring</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif} nav a{display:inline-block;padding:10px;margin:4px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}${css}</style></head><body><header>${navHtml}</header><h1>Measured page</h1>${text}${items}${extra}</body></html>`;
const BAD = page('.wide{width:900px;height:20px;background:#ccc} @media (max-width:800px){nav a{display:none}}', nav, '<div class="wide"></div>');
const GOOD = page('.menu{display:none} @media (max-width:800px){nav a{display:none} .menu{display:inline-block;padding:10px} .grid{grid-template-columns:1fr}}', nav + '<button class="menu" aria-label="Menu" aria-expanded="false">Menu</button>', '');
let bad, good, tmp, haveBrowser = true, B, G, HB, HG;
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; return; }
  bad = http.createServer((q, r) => { r.writeHead(q.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); r.end(BAD); });
  good = http.createServer((q, r) => { r.writeHead(q.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); r.end(GOOD); });
  const [pb, pg] = [await listen(bad), await listen(good)];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se resp-'));
  const J = (n, port, f) => JSON.parse(fs.readFileSync(path.join(tmp, n, `127.0.0.1_${port}`, f), 'utf8'));
  // the broken page is crawled WITH screenshots, the good one without: both code paths must measure
  let r = await run('crawl.mjs', [`http://127.0.0.1:${pb}/`, '--max-pages', '1', '--out', path.join(tmp, 'b')]); assert.equal(r.status, 0, r.out);
  r = await run('crawl.mjs', [`http://127.0.0.1:${pg}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'g')]); assert.equal(r.status, 0, r.out);
  for (const [n, port] of [['b', pb], ['g', pg]]) await run('health-check.mjs', ['--site', path.join(tmp, n, `127.0.0.1_${port}`), '--no-link-check']);
  B = J('b', pb, 'pages/home/page.json'); G = J('g', pg, 'pages/home/page.json'); HB = J('b', pb, 'health.json'); HG = J('g', pg, 'health.json');
});
after(() => { bad?.close(); good?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const skip = (t) => (!haveBrowser ? (t.skip('no browser'), true) : false);

test('responsiveFindings is quiet for a sane page and loud for a broken one (pure function)', () => {
  const ok = { desktop: { width: 1440, navLinks: 4, nav: 'links', maxColumns: 3, textChars: 900 }, tablet: { width: 768, overflowX: false, nav: 'toggle', maxColumns: 2, textChars: 900 }, mobile: { width: 390, nav: 'toggle', maxColumns: 1, wideImages: 0, textChars: 880 } };
  assert.deepEqual(responsiveFindings(ok), []);
  const ids = responsiveFindings({ ...ok, tablet: { ...ok.tablet, overflowX: true, overflowPx: 130 }, mobile: { ...ok.mobile, nav: 'hidden', maxColumns: 3, wideImages: 2, textChars: 200 } }).map((f) => f.id).sort();
  assert.deepEqual(ids, ['mobile-columns', 'mobile-content-hidden', 'mobile-nav-missing', 'mobile-wide-images', 'tablet-overflow']);
  assert.match(responsiveLine(ok), /3 欄 → 2 欄 → 單欄/);
});

test('crawl measures all three widths (with and without screenshots)', (t) => {
  if (skip(t)) return;
  for (const P of [B, G]) { assert.deepEqual(Object.keys(P.responsive).sort(), ['desktop', 'mobile', 'tablet']); assert.equal(P.responsive.tablet.width, 768); assert.equal(P.responsive.mobile.width, 390); }
  assert.equal(G.responsive.desktop.nav, 'links'); assert.equal(G.responsive.mobile.nav, 'toggle', 'a menu button counts as navigation'); assert.equal(G.responsive.desktop.maxColumns, 3); assert.equal(G.responsive.mobile.maxColumns, 0, 'the grid collapses to one column on a phone (0 = no side-by-side blocks)');
  assert.equal(B.responsive.mobile.nav, 'hidden'); assert.equal(B.responsive.tablet.overflowX, true); assert.ok(B.responsive.tablet.overflowPx > 100);
});

test('health flags the broken page and leaves the responsive page alone', (t) => {
  if (skip(t)) return;
  const bad = new Set(HB.issues.map((i) => i.id)), good = new Set(HG.issues.map((i) => i.id));
  for (const id of ['tablet-overflow', 'mobile-nav-missing', 'mobile-columns']) assert.ok(bad.has(id), id + ' in ' + [...bad].join());
  for (const id of ['tablet-overflow', 'mobile-nav-missing', 'mobile-columns', 'mobile-content-hidden']) assert.ok(!good.has(id), id + ' wrongly reported for the responsive page');
});
