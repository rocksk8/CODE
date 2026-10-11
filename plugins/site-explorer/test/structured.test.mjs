// Structured data: required properties per type, @context, and markup that only exists after JavaScript runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { validateNodes, hasContextOk } from '../scripts/structured.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
const body = '<p>' + 'A calm, well written paragraph about the shop and what it sells to its neighbours. '.repeat(14) + '</p>';
const shell = (title, head, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} — a description long enough to be real and useful to searchers."><meta name="viewport" content="width=device-width,initial-scale=1">${head}</head><body><h1>${title}</h1>${body}${extra}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const PAGES = {
  '/': shell('Shop home', ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'Shop' }, { '@type': 'Product', name: 'Teapot', image: 'x.png' }] }), '<a href="/nocontext">a</a> <a href="/jsonly">b</a> <a href="/untyped">c</a>'),
  '/untyped': shell('Untyped items', ld([{ name: 'First', description: 'a thing' }, { name: 'Second', description: 'another thing' }])),
  '/nocontext': shell('No context page', ld({ '@type': 'Article', headline: 'Hi', datePublished: '2026-01-01', author: { name: 'A' } })),
  '/jsonly': shell('Script made markup', '', `<script>document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Late', url: 'https://x.test/' })).replace(/<\//g, '<\\/')})</script>`),
};
let server, tmp, haveBrowser = true, H;
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; return; }
  server = http.createServer((q, r) => { if (PAGES[q.url]) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(PAGES[q.url]); } r.writeHead(404); r.end(); });
  const port = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se struct-'));
  let r = await run('crawl.mjs', [`http://127.0.0.1:${port}/`, '--max-pages', '5', '--no-screenshots', '--out', tmp]); assert.equal(r.status, 0, r.out);
  const dir = path.join(tmp, `127.0.0.1_${port}`);
  r = await run('health-check.mjs', ['--site', dir, '--no-link-check']); assert.equal(r.status, 0, r.out);
  H = JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8'));
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const ids = () => new Map(H.issues.map((i) => [i.id, i]));

test('validateNodes: required vs recommended per type, anyOf groups, unknown types are left alone', () => {
  const r = validateNodes([{ types: ['Product'], props: ['name', 'image'] }, { types: ['Restaurant'], props: ['name', 'address', 'telephone'] }, { types: ['Thing'], props: [] }, { types: ['Article'], props: ['headline', 'datePublished', 'author', 'image'] }, { types: [], props: ['a', 'b'] }]);
  assert.deepEqual(r.find((x) => x.type === 'Product').missing, ['offers 或 review 或 aggregateRating']);
  assert.deepEqual(r.find((x) => x.type === 'Restaurant').missing, [], 'Restaurant is checked as a LocalBusiness');
  assert.ok(r.find((x) => x.type === 'Restaurant').recommended.includes('openingHoursSpecification'));
  assert.ok(!r.find((x) => x.type === 'Thing') && r.find((x) => x.untyped));
  assert.equal(r.find((x) => x.type === 'Article').missing.length, 0);
  assert.ok(hasContextOk('https://schema.org') && hasContextOk('http://schema.org/') && !hasContextOk(null) && !hasContextOk('https://example.com/ctx'));
});

test('health reports missing required fields, missing @context and JS-only markup', (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const m = ids();
  const req = m.get('jsonld-missing-required'); assert.ok(req && req.severity === 'high', [...m.keys()].join());
  assert.ok(req.examples.some((e) => /Product 缺少 offers/.test(e)), req.examples.join('|'));
  assert.ok(!req.examples.some((e) => /Organization/.test(e)), 'Organization with a name has everything required');
  const noCtx = m.get('jsonld-no-context'); assert.ok(noCtx && noCtx.examples.some((e) => /nocontext/.test(e)));
  const js = m.get('jsonld-js-only'); assert.ok(js, 'no js-only issue; have: ' + [...m.keys()].join());
  assert.ok(js.examples.length === 1 && /jsonly/.test(js.examples[0]), js.examples.join('|'));
  const nt = m.get('jsonld-no-type'); assert.ok(nt, 'untyped items are reported'); assert.equal(nt.affected, 1, 'one page with two untyped items is one page'); assert.equal(nt.examples.length, 1);
  assert.ok(!m.has('jsonld-none'));
});
