// Technology detection: evidence-based, versions when the evidence carries them, nothing from visual style, hostile values stay inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTech, renderTechMd, extractTechInPage, parseTechRules } from '../scripts/techstack.mjs';

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

test('false positives: image paths are not Magento, preact is not React, XSRF-TOKEN alone is not Laravel, third-party *.vercel.app files do not mean the site is hosted there, version text is not markup', () => {
  const r = detectTech([page({ editing: { scripts: ['https://x.test/assets/image/logo.js', 'https://x.test/preact.min.js', 'https://widgets.vercel.app/a.js', 'https://someone.github.io/b.js'], stylesheets: [] }, privacy: { cookies: [{ name: 'XSRF-TOKEN' }] }, tech: { generator: 'WordPress [x](//evil.example/)', globals: {}, markers: [], urls: [] } })]);
  for (const id of ['magento', 'react', 'laravel', 'vercel', 'github-pages']) assert.ok(!ids(r).includes(id), id);
  const wp = r.items.find((i) => i.id === 'wordpress'); assert.ok(!wp || !wp.version || /^[0-9A-Za-z._+-]+$/.test(wp.version));
  assert.ok(ids(detectTech([page({ editing: { scripts: ['https://x.test/static/version1700/frontend/Magento/luma/en_US/mage/requirejs/mixins.js'], stylesheets: [] } })])).includes('magento'));
});

test('more built-in rules: payments, captcha, maps, CDNs, hosting, Taiwanese shop platforms', () => {
  const r = detectTech([page({
    editing: { scripts: ['https://js.stripe.com/v3/', 'https://www.google.com/recaptcha/api.js', 'https://maps.googleapis.com/maps/api/js?key=x', 'https://cdn.shoplineapp.com/s/x.js', 'https://x.pages.dev/a.js'], stylesheets: [] },
    seo: { http: { headers: { 'x-served-by': 'cache-tyo123', via: '1.1 varnish', 'x-azure-ref': 'abc', server: 'AmazonS3' } } },
  })]);
  for (const id of ['stripe', 'recaptcha', 'google-maps', 'shopline', 'fastly', 'varnish', 'azure-fd', 's3']) assert.ok(ids(r).includes(id), id + ' in ' + ids(r));
  assert.ok(r.items.length >= 8 && r.items.find((i) => i.id === 'stripe').category === 'service');
});

test('custom technology rules: strict parsing; they detect; a catastrophic pattern is cut off, not fatal', () => {
  const rules = parseTechRules(JSON.stringify([{ id: 'acme-cms', name: 'Acme CMS', category: 'cms', url: 'acme-cdn\\.com/v([\\d.]+)/', header: ['x-acme', '.'], cookie: '^acme_' }, { id: 'evil', name: 'Evil', category: 'library', url: '(a|a)*b' }]));
  const t0 = Date.now();
  const r = detectTech([page({ editing: { scripts: ['https://acme-cdn.com/v2.3/app.js', 'https://x.test/' + 'a'.repeat(300)], stylesheets: [] }, seo: { http: { headers: { 'x-acme': '1' } } } })], { extraRules: rules });
  assert.ok(Date.now() - t0 < 3000); const acme = r.items.find((i) => i.id === 'acme-cms'); assert.ok(acme && acme.version === '2.3' && acme.confidence !== 'low'); assert.ok(!ids(r).includes('evil'));
  for (const bad of ['x', '[]', '[1]', '[{"id":"A","name":"n","category":"cms","url":"x"}]', '[{"id":"a","name":"n","category":"nope","url":"x"}]', '[{"id":"a","name":"n","category":"cms"}]', '[{"id":"a","name":"n","category":"cms","url":"("}]', '[{"id":"a","name":"n","category":"cms","header":["x y","."]}]']) assert.throws(() => parseTechRules(bad), undefined, bad);
});
