// Trackers, cookies and the consent banner: recognised by name only, seen as a new visitor sees them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { classifyUrls, analyzeCookies, summarizePrivacy } from '../scripts/trackers.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
const words = '<p>' + 'Honest plumbing for the whole neighbourhood since nineteen ninety. '.repeat(14) + '</p>';
// vendor scripts are type=text/plain: the address is in the page (what a tracker audit reads) but nothing is fetched from the internet
const page = (banner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plumbing for the neighbourhood</title><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
<script type="text/plain">!function(){var s='https://connect.facebook.net/en_US/fbevents.js';}()</script>
<script type="text/plain" src="https://www.youtube.com/iframe_api"></script></head>
<body><h1>Plumbing</h1>${words}${banner ? '<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#222;color:#fff;padding:16px">We use cookies to improve your experience. <button>Accept</button> <button>Reject</button></div>' : ''}</body></html>`;
let withBanner, without, tmp, haveBrowser = true, A, B, HA, HB;
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const handler = (banner) => (q, r) => {
  if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['_ga=GA1.1.SECRETVALUE.1; Path=/; Max-Age=63072000', '_fbp=fb.1.SECRETVALUE; Path=/', 'sid=abc; Path=/; HttpOnly'] }); r.end(page(banner));
};
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; return; }
  withBanner = http.createServer(handler(true)); without = http.createServer(handler(false));
  const [pa, pb] = [await listen(withBanner), await listen(without)];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se priv-'));
  for (const [name, port] of [['a', pa], ['b', pb]]) {
    const r = await run('crawl.mjs', [`http://127.0.0.1:${port}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, name)]); assert.equal(r.status, 0, r.out);
    await run('health-check.mjs', ['--site', path.join(tmp, name, `127.0.0.1_${port}`), '--no-link-check']);
  }
  const J = (n, port, f) => JSON.parse(fs.readFileSync(path.join(tmp, n, `127.0.0.1_${port}`, f), 'utf8'));
  A = J('a', pa, 'site.json'); B = J('b', pb, 'site.json'); HA = J('a', pa, 'health.json'); HB = J('b', pb, 'health.json');
  globalThis.__privDirs = [path.join(tmp, 'a', `127.0.0.1_${pa}`)];
});
after(() => { withBanner?.close(); without?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const skip = (t) => (!haveBrowser ? (t.skip('no browser'), true) : false);

test('classifyUrls names the service, ignores a plain facebook link, and analyzeCookies keeps flags but never values', () => {
  const v = classifyUrls(['https://www.googletagmanager.com/gtag/js?id=G-1', 'https://connect.facebook.net/en_US/fbevents.js', 'https://www.facebook.com/mypage', 'https://cdn.example.com/app.js', 'https://static.hotjar.com/c/hotjar-1.js']);
  assert.deepEqual(v.map((x) => x.name).sort(), ['Google Tag Manager', 'Hotjar', 'Meta (Facebook) Pixel']);
  const c = analyzeCookies([{ name: '_ga', domain: '.shop.example.com', value: 'SECRET', secure: false, httpOnly: false, sameSite: 'Lax', expires: Date.now() / 1000 + 86400 * 400 }, { name: 'IDE', domain: '.doubleclick.net', value: 'x', secure: true, expires: -1 }], 'www.shop.example.com');
  assert.ok(c[0].tracking && c[0].weak && !c[0].thirdParty && c[0].owner === 'Google Analytics' && c[0].days >= 399);
  assert.ok(c[1].thirdParty && c[1].tracking && c[1].days === null && !c[1].weak);
  assert.ok(!JSON.stringify(c).includes('SECRET'), 'cookie values are never kept');
  assert.equal(summarizePrivacy([{ stage: 'before', vendors: v, cookies: c, consent: { detected: false } }]).consentChecked, true);
});

test('crawl records trackers and cookies as a new visitor sees them, before the banner is touched', (t) => {
  if (skip(t)) return;
  const names = A.privacy.vendors.map((v) => v.name);
  for (const n of ['Google Tag Manager', 'Meta (Facebook) Pixel', 'YouTube']) assert.ok(names.includes(n), n + ' in ' + names.join());
  assert.equal(A.privacy.consentChecked, true); assert.equal(A.privacy.consentBanner, true, 'the banner was there when the page first loaded, even though the crawler then dismissed it');
  assert.equal(B.privacy.consentBanner, false);
  const ga = A.privacy.cookies.find((c) => c.name === '_ga'); assert.ok(ga && ga.tracking && ga.owner === 'Google Analytics' && ga.days >= 399, JSON.stringify(ga));
  assert.equal(A.privacy.cookies.find((c) => c.name === 'sid').httpOnly, true);
  assert.ok(!JSON.stringify(A).includes('SECRETVALUE'), 'no cookie value reaches site.json');
  assert.match(fs.readFileSync(path.join(globalThis.__privDirs[0], 'report.md'), 'utf8'), /追蹤碼與 Cookie[\s\S]*Meta \(Facebook\) Pixel/);
});

test('health: trackers without a banner are a finding; with a banner they are only noted', (t) => {
  if (skip(t)) return;
  assert.ok(HB.issues.some((i) => i.id === 'trackers-no-banner' && i.severity === 'medium'), HB.issues.map((i) => i.id).join());
  assert.ok(!HA.issues.some((i) => i.id === 'trackers-no-banner'));
  assert.ok(HA.issues.some((i) => i.id === 'trackers-present'));
});

test('dashboard shows the trackers card, the phone/tablet table and the verdict without script errors', async (t) => {
  if (skip(t)) return;
  const dir = globalThis.__privDirs[0], dash = path.join(tmp, 'dash.html');
  assert.equal((await run('build-report.mjs', ['--site', dir, '--out', dash])).status, 0);
  const b = await launchBrowser(); try {
  const p = await b.newPage(), errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + dash);
  const ov = await p.locator('#s-overview').innerText();
  assert.match(ov, /追蹤碼與 cookie/i); assert.match(ov, /Meta \(Facebook\) Pixel/); assert.match(ov, /_ga/); assert.match(ov, /手機／平板實測/);
  await p.click('#tabs button[data-k=health]'); assert.match(await p.locator('#s-health').innerText(), /通過/);
  assert.deepEqual(errs, []);
  } finally { await b.close(); }
});
