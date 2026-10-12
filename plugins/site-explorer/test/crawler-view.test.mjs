// Crawler view: raw HTML vs rendered page, different crawler identities, JSON-LD vs visible text, canonical / hreflang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { tokens, similarity, jsOnly, extractJsonLd, jsonLdFacts, factsMissing, runCrawlerView } from '../scripts/crawler-view.mjs';

test('text helpers: words, CJK pairs, similarity, script-only share', () => {
  assert.deepEqual(tokens('Hello, World 42 a'), ['hello', 'world', '42']);
  assert.deepEqual(tokens('網站健檢'), ['網站', '站健', '健檢']);
  assert.equal(similarity('red green blue', 'blue green red'), 1); assert.equal(similarity('red green', 'cat dog'), 0);
  const raw = 'Shop Static intro text that every visitor sees in the first response';
  const rendered = raw + '. Client rendered content arrives here: Blue Mug costs twenty dollars today only, loaded by script after the page starts.';
  const j = jsOnly(raw, rendered); assert.ok(j.share > 0.4, JSON.stringify(j)); assert.ok(j.examples.length >= 1);
  assert.equal(jsOnly(raw, raw).share, 0);
});

test('JSON-LD facts: found, compared with the visible text as numbers and words', () => {
  const html = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Blue Mug","offers":{"@type":"Offer","price":"1299.00","priceCurrency":"USD"},"aggregateRating":{"ratingValue":4.5,"reviewCount":"1,204"}}</script><script type="application/ld+json">{bad json</script>';
  const facts = jsonLdFacts(extractJsonLd(html)); assert.deepEqual(facts.map((f) => f.prop).sort(), ['name', 'price', 'ratingValue', 'reviewCount']);
  assert.deepEqual(factsMissing(facts, 'Blue Mug — now USD 1,299 (4.5 stars, 1,204 reviews)'), [], '1,299 matches 1299.00');
  const bad = factsMissing(facts, 'Blue Mug — only 24.50 today, 4.5 stars, 1,204 reviews'); assert.deepEqual(bad.map((f) => f.prop), ['price']);
  assert.deepEqual(factsMissing(jsonLdFacts(extractJsonLd(html)), 'Red Cup 1299 4.5 1204').map((f) => f.prop), ['name']);
});

test('end to end: script-only text, a blocked AI bot, a different answer for Googlebot, a wrong price, broken canonical / hreflang are all found; a plain page is clean', async () => {
  let port; const pages = {
    '/': (ua) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop home</title><link rel="canonical" href="http://127.0.0.1:${port}/gone"><link rel="alternate" hreflang="de" href="http://127.0.0.1:${port}/de"><script type="application/ld+json">{"@type":"Product","name":"Blue Mug","offers":{"price":"19.99"}}</script></head><body><h1>Shop</h1><div id="app"></div></body></html>`,
    '/plain': () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plain page</title></head><body><h1>Plain</h1><p>This page has the very same words for every visitor, with enough text to compare properly across identities today.</p></body></html>',
    '/cloak': (ua) => /Googlebot/.test(ua) ? '<!doctype html><html><head><title>Cloak</title></head><body><p>cheap pills casino bonus lottery winner free money click here now totally different vocabulary entirely</p></body></html>' : '<!doctype html><html><head><title>Cloak</title></head><body><p>Welcome to our gardening journal about tomatoes and roses planted this spring beside the old stone wall</p></body></html>',
    '/de': () => '<!doctype html><html lang="de"><head><title>Shop DE</title></head><body>no link back here</body></html>'
  };
  const srv = http.createServer((q, r) => { const ua = q.headers['user-agent'] || ''; const p = q.url.split('?')[0]; if (/GPTBot/.test(ua) && p === '/plain') { r.writeHead(403); return r.end('blocked'); } const f = pages[p]; if (!f) { r.writeHead(404); return r.end('no'); } r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(f(ua)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cv-'));
  try {
    const sl = [['home', '/'], ['plain', '/plain'], ['cloak', '/cloak']];
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ pages: sl.map(([slug, p]) => ({ slug, url: `http://127.0.0.1:${port}${p}`, status: 200 })) }));
    const rendered = {
      home: `<html><head><title>Shop home</title></head><body><h1>Shop</h1><div id="app"><h2>Client rendered</h2><p>Blue Mug costs 24.50 dollars today only, loaded by script after the page starts, together with many more distinct words about this wonderful ceramic product range: glaze, handle, dishwasher, microwave, capacity, shipping, returns, warranty, colours, sizes, gifts, reviews, questions.</p></div></body></html>`,
      plain: pages['/plain'](''), cloak: pages['/cloak']('')
    };
    for (const [slug] of sl) { fs.mkdirSync(path.join(dir, 'pages', slug), { recursive: true }); fs.writeFileSync(path.join(dir, 'pages', slug, 'page.html'), rendered[slug]); }
    const res = await runCrawlerView(dir, { delayMs: 0 });
    const ids = res.issues.map((i) => i.id);
    for (const want of ['crawler-js-only', 'crawler-blocked-gptbot', 'crawler-different-content', 'crawler-data-mismatch', 'crawler-canonical-broken', 'crawler-hreflang']) assert.ok(ids.includes(want), want + ' in ' + ids.join(','));
    assert.ok(!ids.includes('crawler-blocked-googlebot'), 'googlebot got 200 everywhere');
    const plain = res.pages.find((p) => p.url.endsWith('/plain')); assert.equal(plain.profiles.googlebot.similarity, 1); assert.equal(plain.js.share, 0);
    const md = fs.readFileSync(path.join(dir, 'crawler-view.md'), 'utf8'); assert.match(md, /cheap pills|crawler-view|HIGH/); assert.ok(fs.existsSync(path.join(dir, 'crawler-view.json')));
    // a site that is fine reports nothing
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ pages: [{ slug: 'x', url: `http://127.0.0.1:${port}/de`, status: 200 }] })); fs.mkdirSync(path.join(dir, 'pages', 'x'), { recursive: true }); fs.writeFileSync(path.join(dir, 'pages', 'x', 'page.html'), pages['/de']());
    const clean = await runCrawlerView(dir, { delayMs: 0 }); assert.deepEqual(clean.issues, []);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explore runs the crawler view by default (and --no-crawler-view skips it); a script-built page is reported', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const { spawn } = await import('node:child_process'); const { fileURLToPath } = await import('node:url');
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
  const words = Array.from({ length: 60 }, (_, i) => 'alpha' + i).join(' ');
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Script built</title><meta name="description" content="A page whose text is built by a script."></head><body><h1>Shell</h1><div id="a"></div><script>document.getElementById('a').innerHTML='<p>${words}</p>'</script></body></html>`); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cv2-'));
  const go = (extra, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'check', url, '--no-open', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', ...extra, '--out', path.join(dir, out)], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o })); });
  try {
    const a = await go([], 'a'); assert.equal(a.status, 0, a.o);
    const siteDir = path.join(dir, 'a', 'site', fs.readdirSync(path.join(dir, 'a', 'site'))[0]);
    const j = JSON.parse(fs.readFileSync(path.join(siteDir, 'crawler-view.json'), 'utf8')); assert.ok(j.issues.some((i) => i.id === 'crawler-js-only'), JSON.stringify(j.issues.map((i) => i.id)));
    assert.match(fs.readFileSync(path.join(dir, 'a', 'dashboard.html'), 'utf8'), /What crawlers see/, 'the overview has a card for it');
    const b = await go(['--no-crawler-view'], 'b'); assert.equal(b.status, 0, b.o);
    const sb = path.join(dir, 'b', 'site', fs.readdirSync(path.join(dir, 'b', 'site'))[0]); assert.ok(!fs.existsSync(path.join(sb, 'crawler-view.json')));
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
