// Regression tests for the round-7 audit (credentials on redirects, cookie domains, scenario origin, stale visual results, security grading, HAR export, ...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCookieFile, applyCredentialRoutes, CRED_ENV } from '../scripts/auth-state.mjs';
import { parseScenarios } from '../scripts/scenarios.mjs';
import { gradeHeaders } from '../scripts/security-grade.mjs';
import { checkHtml } from '../scripts/html-validity.mjs';
import { renderVisualReviewHtml, removeVisualBaseline } from '../scripts/visual-regression.mjs';
import { detectTech } from '../scripts/techstack.mjs';
import { renderPerfMd, medians } from '../scripts/perf-budget.mjs';
import { redactUrl, redactHeaders, buildHar } from '../scripts/har.mjs';
import { computeVerdicts } from '../scripts/verdicts.mjs';

const hasBrowser = async () => { try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); return true; } catch { return false; } };

test('a cookie exported with a leading-dot domain keeps it (so it is sent to sub-domains too)', () => {
  assert.equal(parseCookieFile('.example.test\tTRUE\t/\tFALSE\t0\tsid\tv\n', 'www.example.test')[0].domain, '.example.test');
  assert.equal(parseCookieFile('sid=1', 'www.example.test')[0].domain, 'www.example.test');
});

test('custom headers are stripped again when a response redirects to another origin', async (t) => {
  if (!(await hasBrowser())) return t.skip('no browser');
  const seenB = [];
  const b = http.createServer((q, r) => { seenB.push(q.headers); r.end('b'); }); await new Promise((r) => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((q, r) => { if (q.url === '/r') { r.statusCode = 302; r.setHeader('location', `http://localhost:${b.address().port}/landed`); return r.end(); } r.end('a'); }); await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const { launchBrowser } = await import('../scripts/launch.mjs'); const br = await launchBrowser();
  try {
    const ctx = await br.newContext(); const env = { [CRED_ENV.headers]: JSON.stringify({ 'X-Api-Key': 'SECRETKEY' }) };
    await applyCredentialRoutes(ctx, `http://127.0.0.1:${a.address().port}/`, env);
    const pg = await ctx.newPage(); await pg.goto(`http://127.0.0.1:${a.address().port}/r`).catch(() => {});
    assert.ok(seenB.length >= 1, 'the redirect target was requested');
    for (const h of seenB) assert.ok(!('x-api-key' in h), 'secret header reached the other origin: ' + JSON.stringify(h));
    const own = []; a.on('request', (q) => own.push(q.headers)); await pg.goto(`http://127.0.0.1:${a.address().port}/`);
    assert.equal(own.at(-1)['x-api-key'], 'SECRETKEY', 'the start origin still receives it');
  } finally { await br.close(); a.close(); b.close(); }
});

test('scenario paths cannot leave the origin (backslash, control characters) and hide selectors cannot comment out CSS', () => {
  for (const p of ['/\\localhost:1/x', '/\t/evil.test', '//evil.test/x', '/a\nb']) assert.throws(() => parseScenarios(JSON.stringify([{ name: 'x', path: p }])), undefined, p);
  assert.throws(() => parseScenarios(JSON.stringify([{ name: 'x', hide: ['.a /* b'] }])));
  assert.equal(parseScenarios(JSON.stringify([{ name: 'x', path: '/ok/page?q=1' }]))[0].path, '/ok/page?q=1');
});

test('security grade: extra credit cannot hide a missing CSP / HSTS; frame-ancestors * is not protection', () => {
  const h = { 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
  const r = gradeHeaders(h, { https: true, scripts: [{ src: 'https://cdn.test/a.js', integrity: 'sha384-x' }], host: 'site.test' });
  assert.ok(r.score <= 79 && !/^A/.test(r.grade), `no CSP must not be an A: ${r.grade} ${r.score}`);
  const f = gradeHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors *", 'strict-transport-security': 'max-age=63072000' }, { https: true });
  assert.ok(f.tests.find((x) => x.id === 'framing').points < 0, 'frame-ancestors * is unprotected');
  const ok = gradeHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'", 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }, { https: true });
  assert.ok(ok.score > 79);
});

test('verdict: a good grade with missing basics is "warn", not green', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-v7-'));
  try {
    fs.writeFileSync(path.join(dir, 'security.json'), JSON.stringify({ headers: { grade: 'A', tests: [{ name: 'Content-Security-Policy', points: -25 }] }, tls: null }));
    assert.equal(computeVerdicts(dir).find((v) => v.id === 'security').status, 'warn');
    fs.writeFileSync(path.join(dir, 'security.json'), JSON.stringify({ headers: null, tls: { grade: 'A' } }));
    assert.equal(computeVerdicts(dir).find((v) => v.id === 'security').status, 'ok');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('html validity: <a name> is a valid fragment target and text fragments (#:~:) are not broken links', () => {
  const ids = (html) => checkHtml(html).filter((x) => x.id === 'broken-fragment');
  const page = (b) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${b}</body></html>`;
  assert.equal(ids(page('<a href="#old">x</a><a name="old"></a>')).length, 0);
  assert.equal(ids(page('<a href="#:~:text=hello">x</a>')).length, 0);
  assert.equal(ids(page('<a href="#nope">x</a>')).length, 1);
});

test('visual review: the copy-paste approve command quotes every argument for the shell', () => {
  const vr = { rows: [{ slug: 'a', viewport: 'desktop', status: 'changed', changedPct: 2 }] };
  const html = renderVisualReviewHtml(vr, { baseDir: '/nope', siteDir: '/nope', outDir: '/nope', url: 'https://x.test/?a=1&b=2', baselineFile: '/tmp/$(touch pwned)/b`id`.json' });
  const cmds = [...html.matchAll(/data-cmd="([^"]*)"/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
  assert.ok(cmds.length >= 1);
  if (process.platform === 'win32') for (const c of cmds) { assert.match(c, /explore "https:\/\/x\.test\/\?a=1&b=2" --approve-visual /); assert.match(c, /--baseline "\/tmp\/\$\(touch pwned\)\/b`id`\.json"/); } // cmd.exe / PowerShell: double quotes
  else for (const c of cmds) { assert.match(c, /explore 'https:\/\/x\.test\/\?a=1&b=2' --approve-visual /); assert.match(c, /--baseline '\/tmp\/\$\(touch pwned\)\/b`id`\.json'/); }
});

test('removeVisualBaseline in dry mode only checks; a foreign folder is still refused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-vb-'));
  try {
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify({ schema: 1 })); removeVisualBaseline(d, true); assert.ok(fs.existsSync(d));
    fs.rmSync(path.join(d, 'index.json')); fs.writeFileSync(path.join(d, 'mine.txt'), 'x'); assert.throws(() => removeVisualBaseline(d, true));
  } finally { fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('tech rules: 100 custom rules over 20 pages stay fast (one shared sandbox)', () => {
  const rules = Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i, name: 'R' + i, category: 'cms', url: `nothing-matches-${i}\\.js` }));
  const pages = Array.from({ length: 20 }, (_, i) => ({ status: 200, url: 'https://s.test/' + i, editing: { scripts: Array.from({ length: 30 }, (_, k) => `https://cdn.test/${i}/${k}.js`) } }));
  const t0 = Date.now(); const r = detectTech(pages, { extraRules: rules }); assert.ok(Date.now() - t0 < 4000, 'took ' + (Date.now() - t0) + ' ms'); assert.equal(r.items.filter((x) => x.id.startsWith('r')).length, 0);
  const hit = detectTech(pages, { extraRules: [{ id: 'cdn', name: 'Cdn', category: 'cms', url: 'cdn\\.test/(\\d+)/' }] }); assert.ok(hit.items.some((x) => x.id === 'cdn'));
});

test('performance: median of an even count is the lower middle; the report names how the numbers were taken', () => {
  const rows = [10, 20, 30, 40].map((v) => ({ url: 'u' + v, metrics: { lcpMs: v } }));
  assert.equal(medians(rows).lcpMs, 20);
  const md = (mode) => renderPerfMd({ rows: [{ url: 'u', metrics: { lcpMs: 1000 } }], budget: null, result: { violations: [], failed: false }, history: [{ at: 'x', medians: { lcpMs: 1000 } }], mode });
  assert.match(md({ runs: 3, throttled: true }), /4x slower CPU|4 倍慢/); assert.match(md({ runs: 3 }), /median of 3|中位數/); assert.match(md({ throttleFailed: true, runs: 1 }), /unthrottled|沒有節流的數值/);
});

test('HAR: secrets and secret-looking URL parameters are redacted; the file has the HAR 1.2 shape', () => {
  assert.equal(redactUrl('https://u:p@x.test/a?token=abc&q=1#h'), 'https://x.test/a?token=[redacted]&q=1');
  const hs = redactHeaders({ Authorization: 'Bearer abc', Cookie: 'a=b', 'X-Custom': 'mine', Accept: 'x', 'X-Session-Id': 's' }, new Set(['x-custom']));
  assert.deepEqual(Object.fromEntries(hs.map((h) => [h.name, h.value])), { Authorization: '[redacted]', Cookie: '[redacted]', 'X-Custom': '[redacted]', Accept: 'x', 'X-Session-Id': '[redacted]' });
  const har = buildHar([{ startedDateTime: '2026-01-01T00:00:00.000Z', time: 5, request: {}, response: {}, cache: {}, timings: {} }], { url: 'https://x.test/', title: 'T', loadMs: 10 });
  assert.equal(har.log.version, '1.2'); assert.equal(har.log.entries[0].pageref, 'page_1'); assert.equal(har.log.pages[0].pageTimings.onLoad, 10);
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('explore --har writes pages/<slug>/network.har with real entries and no secrets; stale visual results from an earlier run are removed', async (t) => {
  if (!(await hasBrowser())) return t.skip('no browser');
  const site = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    if (q.url.startsWith('/a.css')) { r.setHeader('content-type', 'text/css'); r.setHeader('set-cookie', 'sid=SECRETSESSION; HttpOnly'); return r.end('body{margin:0}'); }
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HAR page</title><meta name="description" content="A page used to test HAR export."><link rel="stylesheet" href="/a.css?token=SECRETTOKEN&v=2"></head><body><h1>Hello</h1><p>${'Some readable words. '.repeat(15)}</p></body></html>`);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-har-'));
  try {
    const go = (extra) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, ...extra, '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', dir], { env: process.env }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => resolve({ status, out })); });
    const res = await go(['--har']); assert.equal(res.status, 0, res.out);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(dir).filter((f) => f.endsWith('network.har')); assert.equal(files.length, 1, 'one HAR file');
    const txt = fs.readFileSync(files[0], 'utf8'); const har = JSON.parse(txt);
    assert.ok(har.log.entries.length >= 2); assert.ok(har.log.entries.some((e) => /a\.css/.test(e.request.url) && e.response.status === 200));
    assert.ok(!/SECRETTOKEN|SECRETSESSION/.test(txt), 'a secret is in the HAR');
    fs.mkdirSync(path.join(dir, 'visual-diff'), { recursive: true }); for (const f of ['visual.json', 'visual.md', 'visual-review.html']) fs.writeFileSync(path.join(dir, f), 'stale');
    const again = await go([]); assert.equal(again.status, 0, again.out);
    for (const f of ['visual.json', 'visual.md', 'visual-review.html', 'visual-diff']) assert.ok(!fs.existsSync(path.join(dir, f)), 'stale ' + f + ' was left');
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

// ---- round 8
test('credential route: no cookie jar for other origins, the page keeps its own Authorization, other origins never get the basic-auth header', async (t) => {
  if (!(await hasBrowser())) return t.skip('no browser');
  const seenB = [], seenA = [];
  const b = http.createServer((q, r) => { seenB.push({ cookie: q.headers.cookie, auth: q.headers.authorization, key: q.headers['x-api-key'] }); r.setHeader('access-control-allow-origin', '*'); r.setHeader('access-control-allow-headers', '*'); r.end('b'); }); await new Promise((r) => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((q, r) => { seenA.push({ url: q.url, auth: q.headers.authorization }); if (q.url === '/auth') return r.end('x'); r.setHeader('content-type', 'text/html'); r.end(`<html><body><script>Promise.all([fetch('http://localhost:${b.address().port}/x',{credentials:'omit'}),fetch('/auth',{headers:{Authorization:'Bearer mine'}})]).then(()=>document.title='done')</script></body></html>`); }); await new Promise((r) => a.listen(0, '127.0.0.1', r));
  const { launchBrowser } = await import('../scripts/launch.mjs'); const br = await launchBrowser(); const url = `http://127.0.0.1:${a.address().port}/`;
  try {
    const env = { [CRED_ENV.headers]: JSON.stringify({ 'X-Api-Key': 'SECRETKEY' }), [CRED_ENV.basic]: 'u:p' };
    const ctx = await br.newContext(); await ctx.addCookies([{ name: 'bsess', value: 'BSECRET', domain: 'localhost', path: '/' }]);
    await applyCredentialRoutes(ctx, url, env); const pg = await ctx.newPage(); await pg.goto(url); await pg.waitForFunction(() => document.title === 'done', null, { timeout: 8000 });
    for (const h of seenB) { assert.ok(!/BSECRET/.test(h.cookie || ''), 'cookie jar went to another origin'); assert.ok(!h.auth && !h.key, 'a secret went to another origin: ' + JSON.stringify(h)); }
    assert.equal(seenA.find((x) => x.url === '/auth').auth, 'Bearer mine', "the page's own Authorization header was replaced");
    assert.match(seenA.find((x) => x.url === '/').auth || '', /^Basic /, 'the start page still gets basic auth');
  } finally { await br.close(); a.close(); b.close(); }
});

test('HAR: Referer / Location / nested URLs and more secret parameter names are redacted', () => {
  assert.match(redactUrl('https://x.test/a?next=https%3A%2F%2Fy.test%2F%3Ftoken%3DNESTED&q=1'), /\[redacted\]/); assert.ok(!/NESTED/.test(redactUrl('https://x.test/a?next=https%3A%2F%2Fy.test%2F%3Ftoken%3DNESTED&q=1')));
  for (const k of ['sid', 'phpsessid', 'X-Amz-Credential', 'pwd', 'otp', 'ticket', 'state', 'access_token', 'signature']) assert.match(redactUrl(`https://x.test/?${k}=VAL123`), /redacted/, k);
  const hs = Object.fromEntries(redactHeaders({ Referer: 'http://a.test/?token=REF&q=1#f', Location: '/img?code=LOC&x=1', Accept: 'x' }).map((h) => [h.name, h.value]));
  assert.ok(!/REF|#f/.test(hs.Referer) && /redacted/.test(hs.Referer)); assert.equal(hs.Accept, 'x');
  assert.ok(!/LOC/.test(hs.Location));
});

test('html validity: a text fragment after an id is not a broken link', () => {
  const page = (b) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${b}</body></html>`;
  assert.equal(checkHtml(page('<h2 id="intro">x</h2><a href="#intro:~:text=hi">x</a>')).filter((x) => x.id === 'broken-fragment').length, 0);
});

test('security grade: several CSP policies grade the best; frame-ancestors https://* is not protection; a small gap alone does not turn the card yellow', () => {
  const base = { 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
  const two = gradeHeaders({ ...base, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'self', script-src 'unsafe-inline' https://a.test" }, { https: true });
  assert.ok(two.tests.find((x) => x.id === 'csp').points > 0, 'the strict policy decides');
  const fa = gradeHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors https://*", 'strict-transport-security': 'max-age=63072000' }, { https: true });
  assert.ok(fa.tests.find((x) => x.id === 'framing').points < 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-v8-'));
  try { fs.writeFileSync(path.join(dir, 'security.json'), JSON.stringify({ headers: { grade: 'A', tests: [{ name: 'nosniff', points: -5 }] }, tls: null })); assert.equal(computeVerdicts(dir).find((v) => v.id === 'security').status, 'ok'); } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('--approve-visual keeps the review files so the other changes can still be approved; custom tech rules see late URLs', async (t) => {
  const urls = Array.from({ length: 450 }, (_, i) => `https://cdn.test/${i}.js`).concat(['https://late.test/target.js']);
  assert.ok(detectTech([{ status: 200, url: 'https://s.test/', editing: { scripts: urls } }], { extraRules: [{ id: 'late', name: 'Late', category: 'cms', url: 'late\\.test/target' }] }).items.some((x) => x.id === 'late'));
  if (!(await hasBrowser())) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title><meta name="description" content="A page for the approve test."></head><body><h1>Hello</h1><p>${'Some words. '.repeat(20)}</p></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-av-'));
  const go = (extra) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, ...extra, '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', dir], { env: process.env }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => resolve({ status, out })); });
  try {
    assert.equal((await go(['--approve'])).status, 0);
    for (const f of ['visual.json', 'visual.md', 'visual-review.html']) fs.writeFileSync(path.join(dir, f), 'keep'); fs.mkdirSync(path.join(dir, 'visual-diff'), { recursive: true });
    await go(['--approve-visual', 'nonexistent:mobile']);
    for (const f of ['visual.json', 'visual.md', 'visual-review.html', 'visual-diff']) assert.ok(fs.existsSync(path.join(dir, f)), f + ' was deleted by --approve-visual');
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
