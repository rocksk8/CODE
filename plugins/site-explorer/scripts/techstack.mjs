#!/usr/bin/env node
// What is this site built with? CMS, framework, libraries, hosting/CDN, commerce — from evidence the crawl already has
// (scripts and stylesheets it loads, response headers, cookie names, generator tag, a few page globals and DOM markers).
// Every finding lists its evidence and a confidence; nothing is guessed from visual style. Rules are plain data below: add a line to teach it a new tool.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

/** Browser-side: collects the few things that cannot be seen from files and headers. Strings and booleans only. */
export function extractTechInPage() {
  const w = window, out = { globals: {}, markers: [], generator: null, ngVersion: null, urls: [] };
  const val = (f) => { try { const v = f(); return v === undefined || v === null || v === false ? null : typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 30) : true; } catch { return null; } };
  const G = {
    jQuery: () => w.jQuery && (w.jQuery.fn?.jquery || true), React: () => w.React && (w.React.version || true), ReactDOM: () => w.ReactDOM && (w.ReactDOM.version || true),
    Vue: () => w.Vue && (w.Vue.version || true), angular: () => w.angular && (w.angular.version?.full || true), Backbone: () => !!w.Backbone, Ember: () => w.Ember && (w.Ember.VERSION || true),
    __NEXT_DATA__: () => !!w.__NEXT_DATA__, __NUXT__: () => !!w.__NUXT__, __remixContext: () => !!w.__remixContext, ___gatsby: () => !!w.___gatsby, Shopify: () => !!w.Shopify,
    wp: () => !!(w.wp && (w.wp.hooks || w.wp.i18n)), Drupal: () => !!w.Drupal, Webflow: () => !!w.Webflow, Wix: () => !!w.wixBiSession || !!w.wixPerformanceMeasurements, Squarespace: () => !!w.Squarespace,
    gsap: () => w.gsap && (w.gsap.version || true), THREE: () => w.THREE && (w.THREE.REVISION || true), bootstrap: () => w.bootstrap && (w.bootstrap.Tooltip?.VERSION || true),
    htmx: () => !!w.htmx, Alpine: () => !!w.Alpine, Livewire: () => !!w.Livewire, Turbo: () => !!w.Turbo, Stimulus: () => !!w.Stimulus, Ghost: () => !!w.ghost,
  };
  for (const [k, f] of Object.entries(G)) { const v = val(f); if (v !== null) out.globals[k] = v; }
  const MARK = { '#__next': 'next-root', '#__nuxt': 'nuxt-root', '#___gatsby': 'gatsby-root', '[data-reactroot]': 'react-root', '[data-v-app]': 'vue3-root', 'astro-island': 'astro-island', '[data-sveltekit-preload-data]': 'sveltekit', '[ng-version]': 'angular', '[data-wf-page]': 'webflow', '[data-framer-name]': 'framer', '.wp-block-group,[class*="wp-block-"]': 'wp-blocks', 'body.woocommerce': 'woocommerce', '[data-turbo]': 'turbo', '[x-data]': 'alpine', 'wire\\:id,[wire\\:id]': 'livewire', '[data-hx-get],[hx-get]': 'htmx' };
  for (const [sel, name] of Object.entries(MARK)) { try { if (document.querySelector(sel)) out.markers.push(name); } catch {} }
  out.ngVersion = document.querySelector('[ng-version]')?.getAttribute('ng-version')?.slice(0, 20) || null;
  out.generator = document.querySelector('meta[name=generator]')?.content?.slice(0, 100) || null;
  out.urls = [...new Set([...document.querySelectorAll('script[src],link[href],img[src],iframe[src]')].map((e) => e.src || e.href).filter((u) => /^https?:/.test(u)))].slice(0, 300);
  return out;
}

const V = (m) => (m && m[1] ? m[1] : null);
// [id, name, category, rules]  rules: { url: RegExp, header: [name, RegExp], cookie: RegExp, generator: RegExp, global: name, marker: name, version: (evidenceText) => string|null }
const RULES = [
  ['wordpress', 'WordPress', 'cms', { url: /\/wp-(content|includes)\//i, generator: /wordpress ?([\d.]+)?/i, header: ['x-pingback', /xmlrpc\.php/i], global: 'wp', marker: 'wp-blocks' }],
  ['woocommerce', 'WooCommerce', 'commerce', { url: /\/plugins\/woocommerce\//i, marker: 'woocommerce', cookie: /^woocommerce_/ }],
  ['shopify', 'Shopify', 'commerce', { url: /cdn\.shopify\.com|myshopify\.com/i, global: 'Shopify', header: ['x-shopify-stage', /./], cookie: /^_shopify_/ }],
  ['wix', 'Wix', 'cms', { url: /static\.(wixstatic|parastorage)\.com|wixstatic\.com/i, generator: /wix\.com/i, header: ['x-wix-request-id', /./], global: 'Wix' }],
  ['squarespace', 'Squarespace', 'cms', { url: /static1\.squarespace\.com|squarespace-cdn\.com/i, generator: /squarespace/i, global: 'Squarespace' }],
  ['webflow', 'Webflow', 'cms', { url: /webflow\.(com|io)|assets-global\.website-files\.com|uploads-ssl\.webflow\.com/i, generator: /webflow/i, marker: 'webflow', global: 'Webflow' }],
  ['framer', 'Framer', 'cms', { url: /framerusercontent\.com|framer\.com\/m\//i, generator: /framer/i, marker: 'framer' }],
  ['drupal', 'Drupal', 'cms', { generator: /drupal ?([\d.]+)?/i, header: ['x-drupal-cache', /./], global: 'Drupal', url: /\/sites\/(default|all)\/(files|modules|themes)\//i }],
  ['joomla', 'Joomla', 'cms', { generator: /joomla!? ?([\d.]+)?/i, url: /\/media\/jui\/|\/components\/com_/i }],
  ['ghost', 'Ghost', 'cms', { generator: /ghost ?([\d.]+)?/i, header: ['x-ghost-cache-status', /./], global: 'Ghost' }],
  ['hubspot-cms', 'HubSpot CMS', 'cms', { url: /hs-scripts\.com|hubspotusercontent|hs-sites\.com/i, generator: /hubspot/i }],
  ['typo3', 'TYPO3', 'cms', { generator: /typo3/i, url: /\/typo3(conf|temp)\//i }],
  ['magento', 'Magento', 'commerce', { url: /\/static\/version\d+\/frontend\/|mage\/|\/media\/catalog\//i, cookie: /^(mage-|private_content_version)/ }],
  ['bigcommerce', 'BigCommerce', 'commerce', { url: /bigcommerce\.com|cdn11\.bigcommerce/i }],
  ['next', 'Next.js', 'framework', { global: '__NEXT_DATA__', marker: 'next-root', url: /\/_next\/static\//i, header: ['x-powered-by', /next\.js ?([\d.]+)?/i] }],
  ['nuxt', 'Nuxt', 'framework', { global: '__NUXT__', marker: 'nuxt-root', url: /\/_nuxt\//i }],
  ['gatsby', 'Gatsby', 'framework', { global: '___gatsby', marker: 'gatsby-root', generator: /gatsby ?([\d.]+)?/i }],
  ['remix', 'Remix', 'framework', { global: '__remixContext', url: /\/build\/_assets\//i }],
  ['astro', 'Astro', 'framework', { generator: /astro v?([\d.]+)?/i, marker: 'astro-island', url: /\/_astro\//i }],
  ['sveltekit', 'SvelteKit', 'framework', { marker: 'sveltekit', url: /\/_app\/immutable\//i }],
  ['angular', 'Angular', 'framework', { marker: 'angular', global: 'angular' }],
  ['vue', 'Vue.js', 'framework', { global: 'Vue', marker: 'vue3-root', url: /vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js|\/vue@/i }],
  ['react', 'React', 'framework', { global: 'React', marker: 'react-root', url: /react(-dom)?(\.production)?(\.min)?\.js|\/react@|\/react-dom@/i }],
  ['jquery', 'jQuery', 'library', { global: 'jQuery', url: /jquery([.-]\d[\d.]*)?(\.min)?\.js/i }],
  ['bootstrap', 'Bootstrap', 'library', { url: /bootstrap(\.bundle)?([.-]\d[\d.]*)?(\.min)?\.(js|css)|\/bootstrap@/i, global: 'bootstrap' }],
  ['tailwind', 'Tailwind CSS', 'library', { url: /tailwind(css)?(\.min)?\.css|cdn\.tailwindcss\.com/i }],
  ['alpine', 'Alpine.js', 'library', { global: 'Alpine', marker: 'alpine', url: /alpinejs/i }],
  ['htmx', 'htmx', 'library', { global: 'htmx', marker: 'htmx', url: /htmx(\.min)?\.js/i }],
  ['livewire', 'Laravel Livewire', 'framework', { global: 'Livewire', marker: 'livewire' }],
  ['turbo', 'Hotwire Turbo', 'library', { global: 'Turbo', marker: 'turbo' }],
  ['gsap', 'GSAP', 'animation', { global: 'gsap', url: /gsap(\.min)?\.js|\/gsap@|greensock/i }],
  ['three', 'three.js', 'animation', { global: 'THREE', url: /three(\.module)?(\.min)?\.js|\/three@/i }],
  ['lottie', 'Lottie', 'animation', { url: /lottie(\.min)?\.js|lottie-web|dotlottie/i }],
  ['swiper', 'Swiper', 'library', { url: /swiper(-bundle)?(\.min)?\.(js|css)|\/swiper@/i }],
  ['fontawesome', 'Font Awesome', 'library', { url: /font-?awesome|fontawesome|kit\.fontawesome\.com/i }],
  ['google-fonts', 'Google Fonts', 'fonts', { url: /fonts\.(googleapis|gstatic)\.com/i }],
  ['adobe-fonts', 'Adobe Fonts', 'fonts', { url: /use\.typekit\.net|fonts\.adobe\.com/i }],
  ['nginx', 'nginx', 'server', { header: ['server', /nginx\/?([\d.]+)?/i] }],
  ['apache', 'Apache', 'server', { header: ['server', /apache\/?([\d.]+)?/i] }],
  ['iis', 'Microsoft IIS', 'server', { header: ['server', /microsoft-iis\/?([\d.]+)?/i] }],
  ['litespeed', 'LiteSpeed', 'server', { header: ['server', /litespeed/i] }],
  ['caddy', 'Caddy', 'server', { header: ['server', /caddy/i] }],
  ['php', 'PHP', 'language', { header: ['x-powered-by', /php\/?([\d.]+)?/i], cookie: /^PHPSESSID$/ }],
  ['aspnet', 'ASP.NET', 'language', { header: ['x-powered-by', /asp\.net/i], cookie: /^(ASP\.NET_SessionId|\.AspNetCore)/ }],
  ['express', 'Express', 'framework', { header: ['x-powered-by', /express/i] }],
  ['laravel', 'Laravel', 'framework', { cookie: /^(laravel_session|XSRF-TOKEN)$/ }],
  ['rails', 'Ruby on Rails', 'framework', { cookie: /^_[a-z0-9_]+_session$/, header: ['x-powered-by', /phusion passenger/i] }],
  ['cloudflare', 'Cloudflare', 'cdn', { header: ['cf-ray', /./], cookie: /^__cf(_bm|uid)$/ }],
  ['cloudfront', 'Amazon CloudFront', 'cdn', { header: ['x-amz-cf-id', /./], url: /\.cloudfront\.net/i }],
  ['fastly', 'Fastly', 'cdn', { header: ['x-served-by', /cache-/i] }],
  ['akamai', 'Akamai', 'cdn', { header: ['x-akamai-transformed', /./] }],
  ['vercel', 'Vercel', 'hosting', { header: ['x-vercel-id', /./], url: /\.vercel\.app/i }],
  ['netlify', 'Netlify', 'hosting', { header: ['x-nf-request-id', /./], url: /\.netlify\.(app|com)/i }],
  ['github-pages', 'GitHub Pages', 'hosting', { header: ['x-github-request-id', /./], url: /\.github\.io/i }],
  ['wpengine', 'WP Engine', 'hosting', { header: ['x-powered-by', /wp engine/i] }],
];

const CATEGORY = () => ({ cms: _t('內容管理系統／建站平台'), commerce: _t('電商'), framework: _t('前端／後端框架'), library: _t('函式庫'), animation: _t('動畫／3D'), fonts: _t('字型服務'), server: _t('網頁伺服器'), language: _t('程式語言'), cdn: _t('CDN'), hosting: _t('主機／部署平台') });
const ORDER = ['cms', 'commerce', 'framework', 'library', 'animation', 'fonts', 'language', 'server', 'cdn', 'hosting'];

/** pages = page.json objects. `tech` = result of extractTechInPage per page may be stored as page.tech. Pure and offline. */
export function detectTech(pages) {
  const live = (pages || []).filter((p) => p && (!p.status || p.status < 400));
  const found = new Map();
  const add = (rule, how, evidence, version) => {
    const [id, name, category] = rule; const f = found.get(id) || { id, name, category, evidence: [], versions: new Set(), hits: 0, strong: 0 };
    f.hits++; if (how !== 'url') f.strong++; if (evidence && f.evidence.length < 3 && !f.evidence.includes(evidence)) f.evidence.push(evidence); if (version) f.versions.add(version); found.set(id, f);
  };
  for (const p of live) {
    const t = p.tech || {}; const urls = [...(p.editing?.scripts || []), ...(p.editing?.stylesheets || []), ...(t.urls || [])].map(String);
    const headers = p.seo?.http?.headers || {}; const cookies = (p.privacy?.cookies || []).map((c) => String(c.name || c));
    const generator = String(t.generator || p.meta?.generator || '');
    for (const rule of RULES) {
      const r = rule[3];
      if (r.url) { const u = urls.find((x) => r.url.test(x)); if (u) add(rule, 'url', u.replace(/^https?:\/\//, '').slice(0, 90), null); }
      if (r.generator) { const m = generator.match(r.generator); if (m) add(rule, 'generator', `generator: ${generator.slice(0, 60)}`, V(m)); }
      if (r.header) { const v = headers[r.header[0]]; if (v !== undefined) { const m = String(v).match(r.header[1]); if (m) add(rule, 'header', `${r.header[0]}: ${String(v).slice(0, 60)}`, V(m)); } }
      if (r.cookie) { const c = cookies.find((n) => r.cookie.test(n)); if (c) add(rule, 'cookie', `cookie: ${c.slice(0, 40)}`, null); }
      if (r.global && t.globals && t.globals[r.global] !== undefined) add(rule, 'global', `window.${r.global}`, typeof t.globals[r.global] === 'string' ? t.globals[r.global] : null);
      if (r.marker && (t.markers || []).includes(r.marker)) add(rule, 'marker', `DOM: ${r.marker}`, rule[0] === 'angular' ? t.ngVersion : null);
    }
    // a library version in a file name: jquery-3.7.1.min.js, bootstrap@5.3.2
    for (const u of urls) { const m = u.match(/(jquery|bootstrap|vue|react|react-dom|three|gsap|swiper)[-@.](\d+\.\d+(?:\.\d+)?)/i); if (m) { const f = found.get(m[1].toLowerCase() === 'react-dom' ? 'react' : m[1].toLowerCase()); if (f) f.versions.add(m[2]); } }
  }
  const items = [...found.values()].map((f) => ({ id: f.id, name: f.name, category: f.category, version: [...f.versions][0] || null, confidence: f.strong >= 1 && f.hits >= 2 ? 'high' : f.strong >= 1 || f.hits >= 2 ? 'medium' : 'low', evidence: f.evidence.map((e) => clean(e, 100)) }))
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  return { pagesChecked: live.length, items };
}

export function renderTechMd(r) {
  const C = CATEGORY(); const L = [BANNER, '', _t('# 這個網站用了什麼技術'), '', _t`依據：爬到的腳本與樣式表、回應標頭、Cookie 名稱、generator 標籤，以及頁面上的少數全域變數與 DOM 標記（共檢查 ${r.pagesChecked} 頁）。每一項都附證據；沒有證據的不會列。`, ''];
  if (!r.items.length) L.push(_t('（沒有辨識出已知的技術——可能是手寫的網站，或是這份規則還不認得它用的工具。）'), '');
  for (const cat of ORDER) {
    const list = r.items.filter((i) => i.category === cat); if (!list.length) continue;
    L.push(`## ${C[cat]}`, '', _t('| 技術 | 版本 | 把握度 | 證據 |'), '|---|---|---|---|');
    for (const i of list) L.push(`| ${clean(i.name, 40)} | ${i.version ? clean(i.version, 20) : ''} | ${i.confidence === 'high' ? _t('高') : i.confidence === 'medium' ? _t('中') : _t('低')} | ${i.evidence.map((e) => '`' + e.replace(/[`|]/g, '') + '`').join('<br>')} |`);
    L.push('');
  }
  L.push(_t('> 把握度「低」代表只在檔案網址裡看到一個線索；網站可以隱藏標頭、改名檔案，所以沒列出來不代表沒用。'), '');
  return L.join('\n').replace(/<br>/g, '; ');
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：techstack.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const pages = (site.pages || []).map((p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const r = detectTech(pages);
  fs.writeFileSync(path.join(dir, 'techstack.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(dir, 'techstack.md'), renderTechMd(r) + '\n');
  console.log(_t`技術堆疊：${r.items.map((x) => x.name + (x.version ? ' ' + x.version : '')).slice(0, 12).join(_t('、')) || _t('（沒有辨識出）')} → ${path.join(dir, 'techstack.md')}`);
}
