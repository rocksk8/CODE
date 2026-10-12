// Technology detection: evidence-based, versions when the evidence carries them, nothing from visual style, hostile values stay inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTech, renderTechMd, extractTechInPage } from '../scripts/techstack.mjs';

const page = (o = {}) => ({ url: 'https://x.test/', status: 200, meta: {}, editing: { scripts: [], stylesheets: [] }, seo: { http: { headers: {} } }, privacy: { cookies: [] }, tech: { globals: {}, markers: [], urls: [] }, ...o });
const ids = (r) => r.items.map((i) => i.id);

test('WordPress + WooCommerce + jQuery + nginx + Cloudflare from files, headers, cookies, generator and globals', () => {
  const r = detectTech([page({
    editing: { scripts: ['https://x.test/wp-content/plugins/woocommerce/assets/js/frontend.js', 'https://x.test/wp-includes/js/jquery/jquery-3.7.1.min.js'], stylesheets: ['https://fonts.googleapis.com/css2?family=Inter'] },
    seo: { http: { headers: { server: 'nginx/1.25.3', 'cf-ray': '8abc-TPE', 'x-powered-by': 'PHP/8.2.12' } } }, privacy: { cookies: [{ name: 'woocommerce_items_in_cart' }, { name: '__cf_bm' }] },
    tech: { generator: 'WordPress 6.4.2', globals: { jQuery: '3.7.1', wp: true }, markers: ['wp-blocks'], urls: [] },
  })]);
  for (const id of ['wordpress', 'woocommerce', 'jquery', 'nginx', 'cloudflare', 'php', 'google-fonts']) assert.ok(ids(r).includes(id), id + ' in ' + ids(r));
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(by.wordpress.version, '6.4.2'); assert.equal(by.wordpress.confidence, 'high'); assert.equal(by.nginx.version, '1.25.3'); assert.equal(by.jquery.version, '3.7.1'); assert.equal(by.php.version, '8.2.12');
  assert.ok(by.wordpress.evidence.length >= 2 && by.wordpress.evidence.every((e) => e.length < 120));
});

test('modern front-end stacks: Next.js on Vercel, Angular with its version, Astro; a bare page shows nothing', () => {
  const next = detectTech([page({ editing: { scripts: ['https://x.test/_next/static/chunks/main.js'], stylesheets: [] }, seo: { http: { headers: { 'x-vercel-id': 'hnd1::abc' } } }, tech: { globals: { __NEXT_DATA__: true, React: '18.2.0' }, markers: ['next-root'], urls: [] } })]);
  assert.ok(['next', 'react', 'vercel'].every((i) => ids(next).includes(i)), ids(next).join());
  const ng = detectTech([page({ tech: { globals: {}, markers: ['angular'], ngVersion: '17.1.0', urls: [] } })]);
  assert.equal(ng.items.find((i) => i.id === 'angular').version, '17.1.0');
  assert.ok(ids(detectTech([page({ tech: { generator: 'Astro v4.2.1', globals: {}, markers: ['astro-island'], urls: [] } })])).includes('astro'));
  assert.deepEqual(detectTech([page()]).items, []);
});

test('error pages are not examined; low confidence is labelled; the report lists evidence and never raw markup', () => {
  const r = detectTech([page({ status: 500, tech: { globals: { jQuery: '1' }, markers: [], urls: [] } }), page({ editing: { scripts: ['https://cdn.example/jquery.min.js<img src=x onerror=alert(1)>'], stylesheets: [] } })]);
  assert.equal(r.pagesChecked, 1); const j = r.items.find((i) => i.id === 'jquery'); assert.equal(j.confidence, 'low');
  const md = renderTechMd(r); assert.ok(!/<img/.test(md.replace(/<br>/g, '')), md); assert.match(md, /jQuery/); assert.match(md, /把握度|confidence/i);
});

test('extractTechInPage returns only strings, numbers-as-strings and booleans (no objects from the page)', () => {
  // runs in node here with a minimal fake window: it must not throw and must only build plain data
  global.window = { jQuery: { fn: { jquery: '3.6.0' } }, React: { version: '18.0.0' }, __NEXT_DATA__: { big: { nested: 1 } } };
  global.document = { querySelector: () => null, querySelectorAll: () => [] };
  try { const r = extractTechInPage(); assert.equal(r.globals.jQuery, '3.6.0'); assert.equal(r.globals.React, '18.0.0'); assert.equal(r.globals.__NEXT_DATA__, true); assert.ok(Object.values(r.globals).every((v) => v === true || typeof v === 'string')); } finally { delete global.window; delete global.document; }
});
