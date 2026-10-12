// The graphical front end: validates everything the browser sends, is reachable only from this computer with the secret address, serves run files safely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { buildArgs, startUi, progressOf, runSummary, previousSummary } from '../scripts/ui-server.mjs';

test('buildArgs: only known, checked options reach the command line', () => {
  const ok = buildArgs({ url: 'example.com', mode: 'check' }, '/o'); assert.deepEqual(ok.args, ['check', 'https://example.com/', '--no-open', '--max-pages', '8', '--out', '/o']);
  const full = buildArgs({ url: 'https://example.com/a', mode: 'full', maxPages: 20, lang: 'en', motion: false, a11y: true }, '/o'); assert.deepEqual(full.args, ['explore', 'https://example.com/a', '--no-open', '--max-pages', '20', '--out', '/o', '--lang', 'en', '--no-motion', '--a11y']);
  for (const bad of [{ url: '' }, { url: '--out=/etc' }, { url: 'ftp://x.com' }, { url: 'index.html' }, { url: 'example.com', maxPages: 0 }, { url: 'example.com', maxPages: 99 }, { url: 'example.com', maxPages: '5; rm -rf /' }, { url: 'example.com', mode: 'check', maxPages: 1.5 }]) assert.ok(buildArgs(bad, '/o').error, JSON.stringify(bad));
  assert.equal(buildArgs({ url: 'example.com', mode: '--evil' }, '/o').mode, 'check', 'unknown mode falls back');
  assert.ok(!buildArgs({ url: 'example.com', lang: 'x --out /tmp' }, '/o').args.includes('--lang'), 'unknown language is dropped');
});

test('progress and summary are read from what the explorer wrote', () => {
  assert.deepEqual(progressOf('hello\n[1/9] Crawl\nmore\n[3/9] Health check (robots)\n   3D [1/2]: x'), { step: 3, total: 9, label: 'Health check (robots)' });
  assert.equal(progressOf('nothing yet'), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-sum-')); try {
    const sd = path.join(d, 'out', 'site', 'example.com'); fs.mkdirSync(sd, { recursive: true }); fs.writeFileSync(path.join(sd, 'site.json'), '{}'); fs.writeFileSync(path.join(sd, 'health.json'), JSON.stringify({ score: 77, grade: 'C', pagesAnalyzed: 3 }));
    fs.writeFileSync(path.join(sd, 'top-fixes.json'), JSON.stringify([1, 2, 3, 4].map((i) => ({ title: 'Fix ' + i, why: 'because', severity: 'high', effort: 1, prompt: 'Please fix ' + i }))));
    const s = runSummary(d); assert.equal(s.score, 77); assert.equal(s.grade, 'C'); assert.equal(s.fixes.length, 3); assert.equal(s.fixes[0].prompt, 'Please fix 1'); assert.equal(s.dashboard, false);
    assert.equal(runSummary(path.join(d, 'nope')), null);
  } finally { fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('previousSummary: the latest earlier finished run of the same address', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'se-prev-')); try {
    const mk = (id, url, exit, score) => { const d = path.join(base, id); const sd = path.join(d, 'out', 'site', 'x'); fs.mkdirSync(sd, { recursive: true }); fs.writeFileSync(path.join(d, 'ui-run.json'), JSON.stringify({ url, exit, at: '2026-01-01T00:00:00Z' })); fs.writeFileSync(path.join(sd, 'site.json'), '{}'); fs.writeFileSync(path.join(sd, 'health.json'), JSON.stringify({ score })); };
    mk('r20260101-000001-aaaa', 'https://a.com/', 0, 60); mk('r20260101-000002-bbbb', 'https://b.com/', 0, 99); mk('r20260101-000003-cccc', 'https://a.com/', 1, 10); mk('r20260101-000004-dddd', 'https://a.com/', 0, 70); mk('r20260101-000005-eeee', 'https://a.com/', 0, 75);
    assert.equal(previousSummary(base, 'r20260101-000005-eeee', 'https://a.com/').score, 70, 'skips other sites and failed runs');
    assert.equal(previousSummary(base, 'r20260101-000001-aaaa', 'https://a.com/'), null);
  } finally { fs.rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

const get = (port, p, { headers = {}, method = 'GET', body } = {}) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }); r.on('error', reject); if (body) r.write(body); r.end(); });

test('ui server: secret address, host check, JSON-only POST, safe file serving', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'se-ui-')); const ui = await startUi({ baseDir: base });
  try {
    assert.equal((await get(ui.port, '/')).status, 403, 'no secret, no page');
    assert.equal((await get(ui.port, '/?k=wrong')).status, 403);
    const page = await get(ui.port, '/?k=' + ui.token); assert.equal(page.status, 200); assert.match(page.headers['content-security-policy'], /default-src 'none'/); assert.match(page.body, /id="url"/);
    assert.equal((await get(ui.port, '/?k=' + ui.token, { headers: { host: 'evil.example:80' } })).status, 403, 'another host name (DNS rebinding) is refused');
    assert.equal((await get(ui.port, '/api/run?k=' + ui.token, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"url":"example.com"}' })).status, 415, 'form posts from other sites cannot start a run');
    assert.equal((await get(ui.port, '/api/run?k=' + ui.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"--out=/x"}' })).status, 400);
    // files: a fake finished run
    const id = 'r20260101-000000-abcd'; fs.mkdirSync(path.join(base, id, 'out'), { recursive: true }); fs.writeFileSync(path.join(base, id, 'out', 'dashboard.html'), '<h1>ok</h1>'); fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret');
    const f = await get(ui.port, `/runs/${id}/dashboard.html?k=${ui.token}`); assert.equal(f.status, 200); assert.match(f.headers['content-security-policy'], /sandbox/); assert.equal(f.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get(ui.port, `/runs/${id}/dashboard.html`)).status, 403, 'run files need the secret too');
    for (const evil of [`/runs/${id}/..%2Fsecret.txt`, `/runs/${id}/../secret.txt`, `/runs/${id}/%2e%2e/secret.txt`, `/runs/..%2f${id}/x`, `/runs/notarun/dashboard.html`]) { const r = await get(ui.port, evil + '?k=' + ui.token); assert.ok([403, 404].includes(r.status) && !/top secret/.test(r.body), evil + ' -> ' + r.status); }
    const raw = await new Promise((resolve) => { const s = net.connect(ui.port, '127.0.0.1', () => s.write(`GET /runs/${id}/../secret.txt?k=${ui.token} HTTP/1.1\r\nHost: 127.0.0.1:${ui.port}\r\nConnection: close\r\n\r\n`)); let d = ''; s.on('data', (x) => (d += x)); s.on('close', () => resolve(d)); });
    assert.doesNotMatch(raw, /top secret/);
    const list = JSON.parse((await get(ui.port, '/api/runs?k=' + ui.token)).body); assert.equal(list.runs[0].id, id); assert.equal(list.runs[0].dashboard, true);
  } finally { ui.stop(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});

test('ui server: a real quick check runs from the form, one at a time, and the report opens from the page without script errors', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>UI test</title><meta name="description" content="A page for the graphical interface test."></head><body><h1>Hello</h1><p>Some words here.</p></body></html>'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const target = `http://127.0.0.1:${site.address().port}/`;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'se-ui2-')); const ui = await startUi({ baseDir: base });
  const { launchBrowser } = await import('../scripts/launch.mjs'); const br = await launchBrowser();
  try {
    const ctx = await br.newContext(); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(ui.url); await pg.fill('#url', target); await pg.fill('#pages', '1'); await pg.selectOption('#lang', 'en');
    await pg.click('#go'); await pg.waitForSelector('#cur:not([hidden])');
    const second = await get(ui.port, '/api/run?k=' + ui.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) }); assert.equal(second.status, 409, 'one run at a time');
    await pg.waitForSelector('.run a', { timeout: 150000 });
    assert.match(await pg.locator('#runs .st.ok').first().textContent(), /./);
    const [dash] = await Promise.all([ctx.waitForEvent('page'), pg.click('.run a')]); const derrs = []; dash.on('pageerror', (e) => derrs.push(e.message)); await dash.waitForLoadState('load');
    assert.ok((await dash.locator('#tabs button').count()) >= 5, 'the report renders inside the sandbox');
    assert.deepEqual(errs, []); assert.deepEqual(derrs, []);
    await pg.bringToFront(); assert.ok(await pg.locator('#sum').isVisible(), 'a finished run shows its result on the same page'); assert.match(await pg.locator('#sum .score').textContent(), /\d/); assert.ok((await pg.locator('#sum .fix').count()) >= 1, 'top fixes with a copy button'); assert.ok(await pg.locator('#envbar').isHidden(), 'a working browser shows no warning');
    await pg.reload(); assert.equal(await pg.inputValue('#url'), target, 'the last address is remembered');
    await pg.setViewportSize({ width: 390, height: 800 }); assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling on a phone');
  } finally { await br.close(); ui.stop(); site.close(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
