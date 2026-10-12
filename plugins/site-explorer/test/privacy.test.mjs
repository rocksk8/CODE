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
import { classifyUrls, analyzeCookies, summarizePrivacy, privacyMarkdown, detectConsentInPage, resourceUrlsInPage } from '../scripts/trackers.mjs';

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
<script type="text/plain" src="https://connect.facebook.net/en_US/fbevents.js"></script>
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
after(() => { withBanner?.close(); without?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });
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

test('profile links are not trackers: tiktok/x/hubspot/zendesk/line addresses alone, JSON-LD sameAs, canonical links', async (t) => {
  assert.deepEqual(classifyUrls(['https://www.tiktok.com/@brand', 'https://t.co/abc', 'https://www.hubspot.com/pricing', 'https://support.zendesk.com/hc/en-us', 'https://line.me/R/ti/p/@shop']), []);
  assert.deepEqual(classifyUrls(['https://analytics.tiktok.com/i18n/pixel/events.js', 'https://static.ads-twitter.com/uwt.js', 'https://js.hs-scripts.com/123.js']).map((v) => v.name).sort(), ['HubSpot', 'TikTok Pixel', 'X (Twitter) Pixel']);
  if (!haveBrowser) return t.skip('no browser');
  const b = await launchBrowser(); try {
    const p = await b.newPage();
    await p.setContent(`<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=1"><script type="application/ld+json">{"sameAs":["https://www.tiktok.com/@brand","https://www.youtube.com/@brand"]}</script><script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></head><body></body></html>`);
    const urls = await p.evaluate(resourceUrlsInPage);
    assert.deepEqual(classifyUrls(urls).map((v) => v.name), ['Google Tag Manager'], urls.join());
    // a sticky header that merely mentions cookies is not a consent banner; a real banner with a button is
    await p.setContent('<html><body><div style="position:sticky;top:0;height:50px;background:#eee">Our cookie policy and privacy overview for visitors</div><p>text</p></body></html>');
    assert.equal((await p.evaluate(detectConsentInPage)).detected, false);
    await p.setContent('<html><body><div style="position:fixed;bottom:0;left:0;right:0;height:70px;background:#222;color:#fff">We use cookies on this site. <button>Accept all</button></div></body></html>');
    assert.equal((await p.evaluate(detectConsentInPage)).detected, true);
  } finally { await b.close(); }
});

test('cookie names cannot break out of the markdown table', () => {
  const sum = summarizePrivacy([{ stage: 'before', vendors: [], cookies: [{ name: 'a|b\n# IGNORE PREVIOUS', domain: 'x.com', sameSite: 'Lax', days: null, secure: true, httpOnly: false }], consent: { detected: false } }]);
  const md = privacyMarkdown(sum).join('\n');
  assert.ok(!/^# IGNORE/m.test(md), md); assert.equal(md.split('\n').filter((l) => /^\| a b/.test(l)).length, 1);
});

// ---- pre-mortem regressions: consent handling must be precise (a wrong click corrupts the whole crawl; a wrong detection hides a finding)
const PAGE_ = (head, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture page for consent tests</title><meta name="viewport" content="width=device-width,initial-scale=1">${head}</head>${body}</html>`;
const TEXT_ = '<p>' + 'A calm paragraph of ordinary words about the studio and what it does for its neighbours. '.repeat(10) + '</p>';
const GTM_ = '<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>';
const ROUTES = {
  // the banner is injected 1.5 s after load; GTM is only added when Accept is clicked
  '/late': PAGE_('', `<body><h1>Late banner</h1>${TEXT_}<script>setTimeout(() => { const d = document.createElement('div'); d.id = 'cookie-banner'; d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:80px;background:#222;color:#fff;padding:16px'; d.innerHTML = 'We use cookies. <button id="acc">Accept all</button>'; document.body.append(d); d.querySelector('#acc').onclick = () => { const s = document.createElement('script'); s.type = 'text/plain'; s.src = 'https://www.googletagmanager.com/gtag/js?id=G-1'; document.head.append(s); d.remove(); }; }, 1500)</script></body>`),
  // <body> carries a cookie-ish class and the only button navigates away: the crawler must not click it
  '/trap': PAGE_('', `<body class="cookies-allowed cookie-consent-enabled"><h1>Trap</h1>${TEXT_}<button onclick="location.href='/booked'">Book a table</button><a href="/booked">booked</a></body>`),
  '/booked': PAGE_('', `<body><h1>Booked</h1>${TEXT_}</body>`),
  // a consent platform script is present but no banner is visible (geo-targeted / shadow DOM): not "no banner at all"
  '/cmp': PAGE_(`${GTM_}<script type="text/plain" src="https://consent.cookiebot.com/uc.js"></script>`, `<body><h1>CMP page</h1>${TEXT_}</body>`),
};
test('consent: late banner found, GTM that only loads after Accept is tagged "after", wrong clicks and body-class false positives are impossible, a CMP vendor suppresses "no banner"', async (t) => {
  if (skip(t)) return;
  const srv = http.createServer((q, r) => { if (ROUTES[q.url]) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(ROUTES[q.url]); } r.writeHead(404); r.end(); });
  const port = await listen(srv); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se consent-'));
  try {
    const crawl = async (name, route) => { const r = await run('crawl.mjs', [`http://127.0.0.1:${port}${route}`, '--max-pages', '1', '--no-screenshots', '--out', path.join(d, name)]); assert.equal(r.status, 0, r.out); const dir = path.join(d, name, `127.0.0.1_${port}`); await run('health-check.mjs', ['--site', dir, '--no-link-check']); return { site: JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8')), health: JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8')) }; };
    const late = await crawl('late', '/late');
    assert.equal(late.site.privacy.consentBanner, true, 'a banner injected after 1.5 s is still seen as a new visitor would see it');
    const g = late.site.privacy.vendors.find((v) => v.name === 'Google Tag Manager'); assert.ok(g && g.when === 'after', 'GTM appeared only after the crawler accepted: ' + JSON.stringify(late.site.privacy.vendors.map((v) => [v.name, v.when])));
    assert.equal(late.site.privacy.trackingVendors.length, 0, 'not "loaded before consent"'); assert.ok(late.site.privacy.laterTracking.some((v) => v.name === 'Google Tag Manager'));
    assert.ok(!late.health.issues.some((i) => i.id === 'trackers-present' || i.id === 'trackers-no-banner'), 'a compliant site is not flagged');
    const trap = await crawl('trap', '/trap');
    assert.equal(trap.site.consentAction, null, 'no click on a button of a page whose <body> merely has a cookie-ish class'); assert.ok(trap.site.pages[0].url.endsWith('/trap'), trap.site.pages[0].url);
    assert.equal(trap.site.privacy.consentBanner, false, '<body class="cookie-consent-enabled"> is not a banner');
    const cmp = await crawl('cmp', '/cmp');
    assert.equal(cmp.site.privacy.hasCmpVendor, true); assert.ok(!cmp.health.issues.some((i) => i.id === 'trackers-no-banner'), 'a CMP is loaded: do not claim there is no consent tool'); assert.ok(cmp.health.issues.some((i) => i.id === 'trackers-present'));
  } finally { srv.close(); fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('pinterest-style path rules: a product photo on pinimg.com is not a tag', () => {
  assert.deepEqual(classifyUrls(['https://s.pinimg.com/images/product-photo.jpg', 'https://i.pinimg.com/236x/ct/photo.jpg']), []);
  assert.deepEqual(classifyUrls(['https://s.pinimg.com/ct/core.js']).map((v) => v.name), ['Pinterest Tag']);
});
