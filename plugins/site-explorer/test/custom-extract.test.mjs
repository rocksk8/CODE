// Custom extraction rules: strict rule parsing, CSS and regex extraction end to end, CSV safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRules, extractRegex, toCsv } from '../scripts/custom-extract.mjs';

test('rule file: strict parsing with readable errors', () => {
  assert.equal(parseRules('{"a":{"css":".x"},"b":{"css":"[itemprop=sku]","attr":"content"},"c":{"regex":"order-(\\\\d+)"}}').length, 3);
  for (const bad of ['nope', '[]', '{}', '{"a":1}', '{"a":{}}', '{"a":{"css":".x","regex":"y"}}', '{"bad name":{"css":"x"}}', '{"a":{"css":".x","wat":1}}', '{"a":{"regex":"(a+)+$"}}', '{"a":{"regex":"(?=a)b"}}', '{"a":{"regex":"(a)\\\\1"}}', '{"a":{"regex":"("}}', '{"a":{"css":"x","attr":"on click"}}', '{"a":{"regex":"x","in":"dom"}}', `{"a":{"css":"${'x'.repeat(201)}"}}`]) assert.throws(() => parseRules(bad), undefined, bad);
});

test('regex rules: first capture group, limits, no infinite loop on empty matches', () => {
  const r = parseRules('{"id":{"regex":"order-(\\\\d+)"},"empty":{"regex":"x*"},"one":{"regex":"a","all":false}}');
  const out = extractRegex(r, { text: 'order-12 and order-345 aaaa' });
  assert.deepEqual(out.id.values, ['12', '345']); assert.deepEqual(out.one.values, ['a']); assert.ok(Array.isArray(out.empty.values));
});

test('csv: formulas neutralised, quotes escaped, several values joined', () => {
  const rules = parseRules('{"p":{"css":".p"}}');
  const csv = toCsv(rules, [{ url: 'https://x.test/', extract: { p: { values: ['=HYPERLINK("http://evil")', 'a,b'] } } }, { url: 'https://x.test/2', extract: { p: { values: [], error: 'selector' } } }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"") | a,b"`) || csv.includes("'=HYPERLINK"), csv); assert.ok(csv.includes('#selector-error'));
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '2', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });

test('explore --extract writes extractions.csv/json with one row per page; a bad rules file stops before crawling', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Extraction test page</title><meta name="description" content="A page used to test custom extraction rules."></head><body><h1>Shop</h1><span class="price">€ ${q.url === '/b' ? 20 : 10}.00</span><meta itemprop="sku" content="SKU-${q.url === '/b' ? 'B' : 'A'}"><p>order-${q.url === '/b' ? 222 : 111} placed. ${'Some content words. '.repeat(10)}</p><a href="/b">other page</a></body></html>`); });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-ext-')); const rules = path.join(dir, 'rules.json');
  fs.writeFileSync(rules, JSON.stringify({ price: { css: '.price' }, sku: { css: '[itemprop=sku]', attr: 'content' }, order: { regex: 'order-(\\d+)' }, broken: { css: '!!!' } }));
  try {
    const r = await run([url, '--extract', rules, '--out', path.join(dir, 'o')]); assert.equal(r.status, 0, r.out);
    const site = path.join(dir, 'o', 'site', fs.readdirSync(path.join(dir, 'o', 'site'))[0]);
    const csv = fs.readFileSync(path.join(site, 'extractions.csv'), 'utf8').split('\n').filter(Boolean);
    assert.equal(csv[0], 'url,price,sku,order,broken'); assert.equal(csv.length, 3, csv.join('\n'));
    assert.ok(csv.some((l) => l.includes('€ 10.00') && l.includes('SKU-A') && l.includes('111') && l.includes('#selector-error')), csv.join('\n'));
    assert.ok(csv.some((l) => l.includes('€ 20.00') && l.includes('SKU-B') && l.includes('222')));
    fs.writeFileSync(rules, '{"a":{"regex":"(a+)+$"}}');
    const bad = await run([url, '--extract', rules, '--out', path.join(dir, 'o2')]); assert.equal(bad.status, 1); assert.match(bad.out, /could hang/); assert.ok(!fs.existsSync(path.join(dir, 'o2', 'site')));
    const missing = await run([url, '--extract', path.join(dir, 'nope.json'), '--out', path.join(dir, 'o3')]); assert.equal(missing.status, 1); assert.match(missing.out, /file not found/);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regexes that slip past the screening are stopped by the time limit; __proto__ is not a rule name', () => {
  assert.throws(() => parseRules('{"__proto__":{"css":"x"}}'));
  const rules = parseRules('{"a":{"regex":"(a|aa)+$"},"b":{"regex":".*.*.*.*.*x"},"ok":{"regex":"n=(\\\\d+)"}}');
  const t0 = Date.now(); const out = extractRegex(rules, { text: 'a'.repeat(40) + '!' + ' '.repeat(100000) + 'n=5' });
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`); assert.equal(out.a.error, 'timeout'); assert.deepEqual(out.ok.values, ['5']);
  assert.ok(toCsv(rules, [{ url: 'u', extract: out }]).includes('#timeout-error'));
});
