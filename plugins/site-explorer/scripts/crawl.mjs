#!/usr/bin/env node
// Crawl a site with a real browser and capture design, content, layout and editing signals.
import { launchBrowser } from './launch.mjs';
import { findUrl, intOpt, sameSite, loadRobots, CRAWLER_UA_TOKEN } from './args.mjs';
import { isAllowed, groupFor } from './robots.mjs';
import { extractDesignerInPage } from './designer-extract.mjs';
import { extractSeoInPage, extractMobileInPage } from './seo-extract.mjs';
import { BANNER, sanitizeDoc } from './untrusted.mjs';
import { readCapped, readCappedBuffer, mayFetch, guardInternal } from './util.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const args = process.argv.slice(2);
const startUrl = findUrl(args);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!startUrl) {
  console.error('Usage: crawl.mjs <url> [--max-pages 10] [--depth 2] [--out ./site-report] [--no-screenshots]');
  process.exit(1);
}
const maxPages = intOpt(args, 'max-pages', 10, { min: 1, max: 500 });
const maxDepth = intOpt(args, 'depth', 2, { min: 0, max: 6 });
const shots = !args.includes('--no-screenshots');
let origin = new URL(startUrl).origin; // follows the first redirect (example.com -> www.example.com)
const host = new URL(startUrl).host.replace(/[^a-z0-9.-]/gi, '_');
const outDir = path.join(opt('out', './site-report'), host);
fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });

const VIEWPORTS = { desktop: [1440, 900], tablet: [768, 1024], mobile: [390, 844] };
// Directory names derived from URLs: lowercase (macOS/Windows are case-insensitive), no Windows reserved names,
// bounded length, and unique per URL (a short hash is appended on collision or truncation).
const slugCache = new Map(), slugOwner = new Map();
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const shortHash = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 6);
const slugOf = (u) => {
  if (slugCache.has(u)) return slugCache.get(u);
  const x = new URL(u);
  let base = (x.pathname + x.search).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home';
  if (base.length > 60) base = base.slice(0, 60).replace(/-$/, '') + '-' + shortHash(u);
  if (RESERVED.test(base)) base = '_' + base;
  if (slugOwner.has(base) && slugOwner.get(base) !== u) base = base.slice(0, 60) + '-' + shortHash(u);
  slugOwner.set(base, u); slugCache.set(u, base);
  return base;
};
const norm = (u) => { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); };

// ---- runs inside the page ----
function extractInPage() {
  // SVG elements have no innerText: without this one inline <svg><a>/<g role=button> makes the whole extraction throw
  if (typeof SVGElement !== 'undefined' && !('innerText' in SVGElement.prototype)) Object.defineProperty(SVGElement.prototype, 'innerText', { get() { return this.textContent || ''; }, configurable: true });
  // Modern CSS returns oklch()/lab()/color(...) verbatim from getComputedStyle. Normalise to sRGB via a canvas so
  // contrast, palette and token logic (which parse rgb()) see the real colours instead of falling back to black/white.
  const _cv = document.createElement('canvas'); _cv.width = 1; _cv.height = 1;
  const _cx = _cv.getContext('2d', { willReadFrequently: true }), _cache = new Map();
  const rgbOf = (v) => {
    if (!v || /^rgba?\(/.test(v)) return v;
    if (v === 'transparent') return 'rgba(0, 0, 0, 0)';
    if (_cache.has(v)) return _cache.get(v);
    let out = v;
    try { // paint one pixel and read the bytes back: works for oklch(), lab(), color-mix(), display-p3, named colours…
      _cx.clearRect(0, 0, 1, 1); _cx.fillStyle = '#000'; _cx.fillStyle = v; _cx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = _cx.getImageData(0, 0, 1, 1).data;
      out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
    } catch {}
    _cache.set(v, out); return out;
  };
  const COLOR_PROPS = new Set(['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'caretColor', 'textDecorationColor', 'accentColor']);
  const cs = (el) => { const s = getComputedStyle(el); return new Proxy(s, { get(t, k) { const v = t[k]; return typeof v === 'function' ? v.bind(t) : COLOR_PROPS.has(k) ? rgbOf(v) : v; } }); };
  const count = (map, k) => { if (k) map[k] = (map[k] || 0) + 1; };
  const top = (map, n = 12) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  const colors = {}, bgs = {}, borders = {}, fonts = {}, sizes = {}, weights = {}, radii = {}, shadows = {}, gaps = {};
  const all = [...document.querySelectorAll('body *')].slice(0, 4000);
  for (const el of all) {
    const s = cs(el);
    if (s.display === 'none') continue;
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      count(colors, s.color); count(fonts, s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      count(sizes, s.fontSize); count(weights, s.fontWeight);
    }
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') count(bgs, s.backgroundColor);
    if (parseFloat(s.borderTopWidth) > 0) count(borders, s.borderTopColor);
    if (s.borderRadius !== '0px') count(radii, s.borderRadius);
    if (s.boxShadow !== 'none') count(shadows, s.boxShadow);
    for (const p of ['paddingTop', 'paddingLeft', 'marginTop', 'rowGap', 'columnGap']) {
      const v = s[p]; if (v && v !== '0px' && v !== 'normal') count(gaps, v);
    }
  }
  // CSS custom properties (same-origin stylesheets only)
  const cssVars = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules || []) {
      if (r.selectorText && /^(:root|html|body)$/.test(r.selectorText.trim()))
        for (const p of r.style) if (p.startsWith('--')) cssVars[p] = r.style.getPropertyValue(p).trim();
    }
  }
  const typo = {};
  for (const sel of ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'li', 'small']) {
    const el = document.querySelector(sel); if (!el) continue;
    const s = cs(el);
    typo[sel] = { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color: s.color, textTransform: s.textTransform };
  }
  const buttons = [...document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button]')].slice(0, 5).map((el) => {
    const s = cs(el); return { text: el.innerText.trim().slice(0, 40), background: s.backgroundColor, color: s.color, radius: s.borderRadius, padding: s.padding, font: s.fontSize + ' ' + s.fontWeight };
  });

  // layout tree: landmarks and sections, depth-limited
  const interesting = (el) => /^(HEADER|NAV|MAIN|FOOTER|SECTION|ARTICLE|ASIDE|FORM|UL|OL)$/.test(el.tagName) || el.id || (el.className && typeof el.className === 'string' && /section|container|wrapper|hero|grid|row|col|card|banner|footer|header|nav/i.test(el.className));
  const node = (el, depth) => {
    const s = cs(el), r = el.getBoundingClientRect();
    const n = {
      tag: el.tagName.toLowerCase(), id: el.id || undefined,
      class: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || undefined : undefined,
      display: s.display, position: s.position !== 'static' ? s.position : undefined,
      box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      maxWidth: s.maxWidth !== 'none' ? s.maxWidth : undefined,
      background: s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? s.backgroundColor : undefined,
    };
    if (s.display.includes('flex')) n.flex = { direction: s.flexDirection, wrap: s.flexWrap, justify: s.justifyContent, align: s.alignItems, gap: s.gap };
    if (s.display.includes('grid')) n.grid = { columns: s.gridTemplateColumns, gap: s.gap };
    const text = el.children.length === 0 ? el.innerText?.trim().slice(0, 60) : undefined;
    if (text) n.text = text;
    if (depth < 5) {
      const kids = [...el.children].filter((c) => cs(c).display !== 'none' && c.getBoundingClientRect().height > 0 && (interesting(c) || depth < 2)).slice(0, 25);
      if (kids.length) n.children = kids.map((c) => node(c, depth + 1));
    }
    return n;
  };

  const text = (el) => el.innerText.replace(/\s+/g, ' ').trim();
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const meta = (n) => document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.content;


  // breakpoints from @media rules
  const bp = {};
  const walk = (rules) => { for (const r of rules || []) {
    if (r.media) { for (const m of r.media.mediaText.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) { const px = Math.round(parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16)); bp[px] = (bp[px] || 0) + 1; } }
    if (r.cssRules && !r.selectorText) walk(r.cssRules);
  } };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
  const breakpoints = Object.entries(bp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([px, uses]) => ({ px: Number(px), uses }));

  // component inventory
  const sty = (el, props) => { const s = cs(el); return Object.fromEntries(props.map((p) => [p, s[p]])); };
  const BOX = ['backgroundColor', 'color', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'boxShadow', 'padding', 'fontSize', 'fontWeight', 'fontFamily'];
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && cs(el).display !== 'none'; };
  const nav = document.querySelector('nav, header');
  const logoEl = document.querySelector('header img, [class*=logo] img, a[href="/"] img, img[class*=logo], img[alt*=logo i]');
  const components = {
    buttons: [...document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button], input[type=submit]')].filter(vis).slice(0, 8).map((el, i) => ({ text: (el.innerText || el.value || '').trim().slice(0, 40), selector: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''), index: i, ...sty(el, BOX) })),
    inputs: [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]), textarea, select')].filter(vis).slice(0, 3).map((el) => ({ type: el.type || el.tagName.toLowerCase(), placeholder: el.placeholder, ...sty(el, BOX), height: cs(el).height })),
    cards: [...document.querySelectorAll('[class*=card], article, li')].filter((el) => vis(el) && (cs(el).boxShadow !== 'none' || parseFloat(cs(el).borderTopWidth) > 0) && el.getBoundingClientRect().width > 120).slice(0, 3).map((el) => sty(el, BOX)),
    navigation: nav ? { tag: nav.tagName.toLowerCase(), height: Math.round(nav.getBoundingClientRect().height), position: cs(nav).position, ...sty(nav, ['backgroundColor', 'color', 'padding', 'boxShadow']), links: [...nav.querySelectorAll('a')].filter(vis).slice(0, 8).map((a) => text(a).slice(0, 30)), linkStyle: nav.querySelector('a') ? sty(nav.querySelector('a'), ['color', 'fontSize', 'fontWeight', 'textTransform']) : null } : null,
    logo: logoEl ? { src: logoEl.currentSrc || logoEl.src, alt: logoEl.alt, w: logoEl.naturalWidth, h: logoEl.naturalHeight } : null,
    favicon: [...document.querySelectorAll('link[rel~=icon],link[rel=apple-touch-icon]')].map((l) => abs(l.getAttribute('href'))),
  };
  return {
    url: location.href, title: document.title, lang: document.documentElement.lang,
    meta: { description: meta('description'), generator: meta('generator'), ogTitle: meta('og:title'), ogImage: meta('og:image'), themeColor: meta('theme-color'), viewport: meta('viewport'), canonical: document.querySelector('link[rel=canonical]')?.href },
    content: {
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 200) })).filter((h) => h.text),
      paragraphs: [...document.querySelectorAll('main p, article p, body p')].map(text).filter((t) => t.length > 20).slice(0, 60),
      links: [...document.querySelectorAll('a[href]')].map((a) => ({ text: text(a).slice(0, 80), href: abs(a.getAttribute('href')), area: a.closest('nav') ? 'nav' : a.closest('footer') ? 'footer' : a.closest('header') ? 'header' : 'body' })).slice(0, 300),
      images: [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight })).slice(0, 100),
      forms: [...document.forms].map((f) => ({ action: abs(f.getAttribute('action') || ''), method: f.method, fields: [...f.elements].filter((e) => e.name).map((e) => ({ name: e.name, type: e.type, required: e.required })) })),
      media: { video: document.querySelectorAll('video').length, iframe: [...document.querySelectorAll('iframe')].map((i) => i.src).slice(0, 10), svg: document.querySelectorAll('svg').length },
    },
    design: {
      cssVars, typography: typo, buttons,
      textColors: top(colors), backgrounds: top(bgs), borderColors: top(borders), fontFamilies: top(fonts, 6), fontSizes: top(sizes, 10), fontWeights: top(weights, 6), radii: top(radii, 6), shadows: top(shadows, 5), spacing: top(gaps, 12),
      webFonts: [...document.fonts].map((f) => f.family.replace(/["']/g, '')).filter((v, i, a) => a.indexOf(v) === i),
    },
    layout: {
      docHeight: document.documentElement.scrollHeight, docWidth: document.documentElement.scrollWidth,
      landmarks: ['header', 'nav', 'main', 'aside', 'footer'].reduce((o, t) => ({ ...o, [t]: document.querySelectorAll(t).length }), {}),
      sections: [...document.querySelectorAll('main > *, body > section, body > div > section')].slice(0, 30).map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || undefined, class: String(el.className).slice(0, 80), height: Math.round(el.getBoundingClientRect().height), heading: el.querySelector('h1,h2,h3')?.innerText.trim().slice(0, 80) })),
      tree: node(document.body, 0),
    },
    breakpoints, components,
    editing: {
      contenteditable: document.querySelectorAll('[contenteditable=true]').length,
      editLinks: [...document.querySelectorAll('a[href]')].filter((a) => /edit|admin|login|wp-admin|dashboard|sign.?in/i.test(a.href + a.innerText)).map((a) => ({ text: a.innerText.trim().slice(0, 40), href: a.href })).slice(0, 10),
      dataAttrs: [...new Set([...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name)).filter((n) => /^data-(wf|wix|sqs|framer|elementor|et-|vc-|block|sanity|contentful|builder|ghost|shopify)/.test(n)))].slice(0, 20),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 80),
      stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).slice(0, 40),
      bodyClasses: document.body.className,
    },
  };
}

// ---- technology / editing-method detection ----
const SIGNATURES = [
  ['WordPress', /wp-content|wp-includes|wp-json|WordPress/i, ['/wp-admin/', '/wp-login.php'], 'WordPress 後台 /wp-admin，區塊編輯器(Gutenberg)或頁面建構器(Elementor/Divi)編輯'],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme|myshopify/i, ['/admin'], 'Shopify 後台 /admin；佈景主題編輯器 (Online Store > Themes > Customize)'],
  ['Wix', /wixstatic\.com|wix\.com|X-Wix/i, [], 'Wix Editor / Wix Studio 視覺化編輯器（需帳號登入）'],
  ['Webflow', /webflow\.(com|io)|data-wf-/i, [], 'Webflow Designer（視覺化設計）+ Editor（內容編輯）'],
  ['Squarespace', /squarespace|sqs-/i, ['/config'], 'Squarespace 後台（/config），網站內嵌式編輯'],
  ['Framer', /framer\.(com|app)|framerusercontent/i, [], 'Framer 設計畫布，發佈為靜態網站'],
  ['Ghost', /ghost\.io|content="Ghost|ghost-/i, ['/ghost/'], 'Ghost 後台 /ghost，Markdown/卡片編輯器'],
  ['Next.js', /_next\/static|__NEXT_DATA__/i, [], '程式碼專案（React/Next.js），內容多在原始碼或 Headless CMS'],
  ['Nuxt', /_nuxt\/|__NUXT__/i, [], '程式碼專案（Vue/Nuxt），內容多在原始碼或 Headless CMS'],
  ['Gatsby', /___gatsby|gatsby-/i, [], '靜態站（Gatsby），內容來自原始碼/Headless CMS'],
  ['Astro', /astro-island|content="Astro/i, [], '靜態站（Astro），內容在 Markdown/原始碼'],
  ['Hugo/Jekyll', /content="(Hugo|Jekyll)/i, [], '靜態站產生器，內容為 Markdown 檔，編輯後重新建置'],
  ['Drupal', /Drupal|\/sites\/default\//i, ['/user/login'], 'Drupal 後台 /user/login'],
  ['Joomla', /Joomla|\/media\/jui\//i, ['/administrator/'], 'Joomla 後台 /administrator'],
  ['Notion/Super', /notion\.so|super\.so|notion-/i, [], '以 Notion 頁面作為內容來源'],
  ['Sanity/Contentful', /sanity\.io|contentful\.com|ctfassets/i, [], 'Headless CMS（Sanity/Contentful）供應內容'],
];
async function detect(pages, headers, fetchStatus) {
  const blob = pages.flatMap((p) => [p.editing.scripts.join(' '), p.editing.stylesheets.join(' '), p.editing.bodyClasses, p.editing.dataAttrs.join(' '), p.meta.generator || '']).join(' ') + ' ' + JSON.stringify(headers);
  const found = [];
  for (const [name, re, probes, how] of SIGNATURES) {
    if (!re.test(blob)) continue;
    const adminProbes = {};
    for (const p of probes) adminProbes[p] = await fetchStatus(origin + p);
    found.push({ platform: name, howToEdit: how, adminProbes });
  }
  return found;
}

// ---- friction handling: cookie banners and bot walls ----
async function dismissConsent(page) {
  try {
    return await page.evaluate(() => {
      const box = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=onetrust i]')].find((e) => e.getBoundingClientRect().height > 40);
      if (!box) return null;
      const btns = [...box.querySelectorAll('button, a[role=button], [role=button]')];
      const pick = (re) => btns.find((b) => re.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
      const b = pick(/reject|decline|necessary only|refuse|deny|拒絕|僅必要|只接受必要/i) || pick(/accept|agree|got it|allow|ok\b|同意|接受|我知道/i);
      if (!b) return null;
      b.click();
      return (b.innerText || '').trim().slice(0, 30);
    });
  } catch { return null; }
}
async function detectBlock(page, status) {
  const text = await page.evaluate(() => (document.title + ' ' + (document.body?.innerText || '').slice(0, 800)).toLowerCase()).catch(() => '');
  if (/just a moment|attention required|captcha|verify you are human|are you a robot|access denied|unusual traffic|enable javascript and cookies/.test(text)) return '驗證／防機器人頁面';
  if ([401, 403, 429].includes(status)) return `HTTP ${status}`;
  if (status >= 500) return `伺服器錯誤 HTTP ${status}`;
  return null;
}

async function redirectHops(resp) {
  const hops = []; let rq = resp?.request();
  while (rq && rq.redirectedFrom()) { rq = rq.redirectedFrom(); const rs = await rq.response().catch(() => null); hops.unshift({ url: rq.url(), status: rs?.status() }); }
  return hops;
}
// Never wait for "networkidle" indefinitely: many sites keep analytics/websocket requests open forever.
async function openPage(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 12000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return resp;
}

// What a crawler that does NOT run JavaScript would receive for this URL.
async function fetchRaw(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!mayFetch(r.url, u)) return { status: null, error: 'redirected to an internal address' };
    const html = await readCapped(r, 3_000_000);
    const bi = html.search(/<body/i); const be = html.toLowerCase().lastIndexOf('</body>'); // linear scans, no backtracking
    const body = bi >= 0 ? html.slice(bi, be > bi ? be + 7 : undefined) : html;
    const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
    const latin = (text.match(/[A-Za-z0-9À-ɏ']+/g) || []).length, cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
    return {
      status: r.status, finalUrl: r.url, bytes: html.length, contentType: r.headers.get('content-type') || '',
      title: ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim(), h1Count: (html.match(/<h1[\s>]/gi) || []).length,
      words: latin + Math.round(cjk / 1.8), links: (html.match(/<a\s[^>]*href=/gi) || []).length, canonical: /<link[^>]+rel=["']?canonical/i.test(html), jsonld: (html.match(/application\/ld\+json/gi) || []).length,
      metaRobots: ((html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)/i) || [])[1] || null), csrShell: /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html),
    };
  } catch (e) { return { error: String(e.message).slice(0, 100) }; }
}
const pickHeaders = (h = {}) => Object.fromEntries(['content-type', 'x-robots-tag', 'cache-control', 'content-encoding', 'strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'server', 'x-powered-by', 'link', 'last-modified', 'etag', 'vary', 'age', 'cf-cache-status', 'x-cache'].filter((k) => h[k] !== undefined).map((k) => [k, k === 'content-security-policy' ? String(h[k]).slice(0, 200) : h[k]]));

// ---- main ----
let robotsInfo = await loadRobots(origin);
const robotsList = () => (groupFor(robotsInfo.parsed || { groups: [] }, CRAWLER_UA_TOKEN)?.rules || []).filter((r) => r.type === 'disallow' && r.path).map((r) => r.path);
const allowed = (u) => { const x = new URL(u); return isAllowed(robotsInfo.parsed, CRAWLER_UA_TOKEN, x.pathname + x.search).allowed; };
if (robotsInfo.serverError) {
  console.error(`\n沒有爬取任何頁面。\n原因：robots.txt 回應 HTTP ${robotsInfo.status}（伺服器錯誤）。依慣例無法確認是否允許，視為禁止抓取。請稍後再試，或確認網站 robots.txt 是否正常。`);
  process.exit(3);
}
if (!allowed(startUrl)) {
  console.error('\n沒有成功爬取任何頁面。\n原因：robots.txt 不允許爬取此網站（' + robotsList().join(', ') + '）。已依網站設定停止；若你擁有此網站，請調整 robots.txt，或改用 Playwright MCP 手動瀏覽。');
  process.exit(3);
}
const browser = await launchBrowser();
const UA = 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)';
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA });
await guardInternal(ctx, startUrl); // a public site (or a redirect from it) cannot make the browser read localhost / the LAN
const stripHash = (u) => { const x = new URL(u); x.hash = ''; return x.href; };
const queue = [[stripHash(startUrl), 0]], seen = new Set([norm(startUrl)]), pages = [], headers = {};
let consentAction = null;
const crawledFinal = new Set(), redirectLog = []; // dedupe by FINAL url: /old and /new that land on the same page are one page
const skippedByRobots = [], nonHtmlLog = [];
const t0 = Date.now();

while (queue.length && pages.length < maxPages) {
  const [url, depth] = queue.shift();
  if (!allowed(url)) { console.log('skip (robots):', url); skippedByRobots.push(url); continue; }
  const page = await ctx.newPage();
  const watchdog = setTimeout(() => { console.log('timeout (120s), giving up on:', url); page.close().catch(() => {}); }, 120000);
  try {
    const mixed = new Set(); page.on('request', (r) => { if (/^https:/.test(page.url()) && /^http:/.test(r.url())) mixed.add(r.url().slice(0, 140)); });
    const resp = await openPage(page, url);
    const contentType = (resp?.headers()['content-type'] || '').toLowerCase();
    if (resp && contentType && !/html/.test(contentType)) { // JSON/PDF/XML/images are not pages: do not score them as pages
      nonHtmlLog.push({ url, contentType: contentType.split(';')[0] }); console.log(`   (skipped, not an HTML page: ${contentType.split(';')[0]})`);
      clearTimeout(watchdog); await page.close().catch(() => {}); continue;
    }
    if (pages.length === 0 && new URL(page.url()).origin !== origin) {
      origin = new URL(page.url()).origin; robotsInfo = await loadRobots(origin);
      console.log('redirected to', origin);
    }
    if (!allowed(page.url())) { // a redirect can lead somewhere robots.txt forbids
      skippedByRobots.push(page.url()); console.log('skip (robots, after redirect):', page.url());
      clearTimeout(watchdog); await page.close().catch(() => {}); continue;
    }
    const finalKey = norm(page.url());
    if (crawledFinal.has(finalKey)) {
      redirectLog.push({ from: url, to: page.url(), hops: await redirectHops(resp), status: resp?.status() });
      console.log(`   (same page as ${page.url()} — counted once)`);
      clearTimeout(watchdog); await page.close().catch(() => {}); continue;
    }
    crawledFinal.add(finalKey); crawledFinal.add(norm(url));
    if (pages.length === 0 && resp) headers.main = resp.headers();
    if (pages.length === 0) { consentAction = await dismissConsent(page); if (consentAction) await page.waitForTimeout(600); }
    // trigger lazy content
    // bounded: infinite-scroll pages grow forever while you scroll
    await page.evaluate(async () => { const t0 = Date.now(); for (let y = 0, n = 0; y < document.body.scrollHeight && n < 40 && Date.now() - t0 < 4000; y += 600, n++) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const data = await page.evaluate(extractInPage);
    data.designer = await page.evaluate(extractDesignerInPage).catch((e) => { console.log('   (designer data skipped:', e.message.split('\n')[0] + ')'); return null; });
    data.status = resp?.status();
    // --- SEO / indexability signals ---
    data.seo = await page.evaluate(extractSeoInPage).catch((e) => { console.log('   (seo data skipped:', e.message.split('\n')[0] + ')'); return null; });
    if (data.seo) {
      const hops = await redirectHops(resp);
      const timing = resp?.request().timing();
      data.seo.http = { status: resp?.status(), requestedUrl: url, finalUrl: page.url(), redirects: hops, headers: pickHeaders(resp?.headers()), ttfbMs: timing && timing.responseStart >= 0 ? Math.round(timing.responseStart) : null, mixedContent: [...mixed].slice(0, 10), mixedContentCount: mixed.size };
      data.seo.raw = await fetchRaw(url);
      if (hops.length) redirectLog.push({ from: url, to: page.url(), hops, status: resp?.status() });
    }
    data.blocked = await detectBlock(page, data.status);
    if (pages.length === 0) {
      try {
        const sample = () => page.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); const rgb = (v) => { if (/^rgba?\(/.test(v)) return v; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = v; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`; }; const b = getComputedStyle(document.body); return { background: rgb(b.backgroundColor), color: rgb(b.color) }; });
        const light = await sample();
        await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(300);
        const dark = await sample();
        await page.emulateMedia({ colorScheme: 'light' });
        data.darkMode = { supported: dark.background !== light.background || dark.color !== light.color, light, dark };
        const btn = page.locator('button, a[class*=btn], a[class*=button]').first();
        if (await btn.count()) {
          const read = () => btn.evaluate((el) => { const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); const rgb = (v) => { if (/^rgba?\(/.test(v)) return v; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = v; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`; }; const s = getComputedStyle(el); return { backgroundColor: rgb(s.backgroundColor), color: rgb(s.color), boxShadow: s.boxShadow, transform: s.transform }; });
          const before = await read(); await btn.hover({ timeout: 2000 }); await page.waitForTimeout(350);
          data.buttonHover = { before, after: await read() };
        }
      } catch {}
    }
    const dir = path.join(outDir, 'pages', slugOf(url)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'page.html'), await page.content());
    if (shots) {
      for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        data.layout[`${name}Overflow`] = overflow;
        await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
        if (name === 'desktop') {
          // Per-section crops: a 1440x9000 full-page image gets downscaled until it is unreadable (for people and for AI)
          const secDir = path.join(dir, 'sections'); fs.mkdirSync(secDir, { recursive: true });
          for (const [i, b] of (data.designer?.blocks || []).slice(0, 30).entries()) {
            const file = `${String(i + 1).padStart(2, '0')}-${b.kind}.png`;
            try { await page.screenshot({ path: path.join(secDir, file), fullPage: true, clip: { x: 0, y: b.y, width: w, height: Math.min(b.h, 1800) } }); b.image = `sections/${file}`; } catch {}
          }
        }
        if (name === 'mobile' && data.seo) data.seo.mobile = await page.evaluate(extractMobileInPage).catch(() => null);
      }
    } else if (data.seo) {
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
      data.seo.mobile = await page.evaluate(extractMobileInPage).catch(() => null);
    }
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(data, null, 2));
    data.slug = slugOf(url);
    pages.push(data);
    console.log(`[${pages.length}/${maxPages}] ${url}`);
    if (depth < maxDepth) {
      for (const l of data.content.links) {
        try {
          if (!/^https?:/.test(l.href) || !sameSite(l.href, origin)) continue;
          if (/(wp-admin|wp-login|\/admin|\/login|\/ghost\/|\/administrator|logout|signin|sign-in)/i.test(new URL(l.href).pathname)) continue;
          if (/\.(pdf|zip|jpe?g|png|gif|svg|webp|mp4|css|js)(\?|$)/i.test(l.href)) continue;
          // dedupe on the normalised key, but FETCH the URL as the site wrote it (some hosts serve only /dir/, not /dir)
          const n = norm(l.href);
          if (!seen.has(n)) { seen.add(n); queue.push([stripHash(l.href), depth + 1]); }
        } catch {}
      }
    }
  } catch (e) { console.log('failed:', url, e.message.split('\n')[0]); }
  clearTimeout(watchdog);
  await page.close().catch(() => {});
}
await browser.close();


if (pages.length === 0) {
  console.error('\n沒有成功爬取任何頁面。');
  if (skippedByRobots.length) console.error(`原因：robots.txt 不允許爬取此網站（${robotsList().join(', ')}）。已依網站設定停止；若你擁有此網站，請調整 robots.txt，或改用 Playwright MCP 手動瀏覽。`);
  else console.error('原因：頁面無法載入（網址錯誤、逾時或被擋住）。請先執行 doctor.mjs <網址> 確認連線。');
  process.exit(3);
}

// download key brand assets (logo, favicon, og image)
fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
const assets = [];
const wanted = new Map();
if (pages[0]?.components.logo?.src) wanted.set('logo', pages[0].components.logo.src);
(pages[0]?.components.favicon || []).slice(0, 2).forEach((u, i) => wanted.set('favicon' + i, u));
if (pages[0]?.meta.ogImage) wanted.set('og-image', new URL(pages[0].meta.ogImage, startUrl).href);
for (const [name, u] of wanted) {
  try {
    if (!mayFetch(u, startUrl)) continue; // a public site must not make us read the user's LAN
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); if (!r.ok || !/^(image\/|text\/xml|application\/xml)/i.test(r.headers.get('content-type') || '')) continue;
    const buf = await readCappedBuffer(r, 5_000_000); if (!buf) continue;
    const ext = (new URL(u).pathname.match(/\.(svg|png|jpe?g|webp|ico|gif)$/i) || [, 'bin'])[1].toLowerCase();
    fs.writeFileSync(path.join(outDir, 'assets', `${name}.${ext}`), buf);
    assets.push({ name, file: `assets/${name}.${ext}`, source: u });
  } catch {}
}

const fetchStatus = async (u) => { try { return (await fetch(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) })).status; } catch { return null; } };
const platforms = await detect(pages, headers, fetchStatus);

// aggregate design tokens across pages
const merge = (key, n = 10) => {
  const m = {};
  for (const p of pages) for (const { value, count } of p.design[key]) m[value] = (m[value] || 0) + count;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
};

// designer-oriented aggregates across pages
const sumBy = (key, getList, n) => { const m = new Map(); for (const p of pages) for (const it of getList(p.designer) || []) { const k = key(it); const e = m.get(k) || { ...it, count: 0 }; e.count += it.count || 1; m.set(k, e); } return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n); };
const designer = {
  fonts: { faces: pages.flatMap((p) => p.designer?.fonts.faces || []).filter((f, i, a) => a.findIndex((g) => g.family === f.family && g.weight === f.weight && g.style === f.style) === i).slice(0, 80), links: [...new Set(pages.flatMap((p) => p.designer?.fonts.links || []))], googleFamilies: [...new Set(pages.flatMap((p) => p.designer?.fonts.googleFamilies || []))] },
  motion: { transitions: sumBy((x) => x.token, (d) => d?.motion.transitions, 8), animations: sumBy((x) => x.token, (d) => d?.motion.animations, 6) },
  grid: { containerWidths: sumBy((x) => x.px, (d) => d?.grid.containerWidths, 4), columns: sumBy((x) => x.columns, (d) => d?.grid.columns, 5), gaps: sumBy((x) => x.value, (d) => d?.grid.gaps, 5) },
  contrast: { checked: pages.reduce((n, p) => n + (p.designer?.contrast.checked || 0), 0), failing: sumBy((x) => x.fg + x.bg + x.large, (d) => d?.contrast.failing, 20) },
  icons: [...new Map(pages.flatMap((p) => p.designer?.icons || []).map((i) => [i.svg, i])).values()].slice(0, 60),
  copy: { ctas: sumBy((x) => x.text, (d) => d?.copy.ctas, 12), nav: [...new Set(pages.flatMap((p) => p.designer?.copy.nav || []))].slice(0, 20) },
  patterns: pages.map((p) => ({ slug: p.slug, kinds: (p.designer?.blocks || []).map((b) => b.kind) })),
};
const toolVersion = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return null; } })();
const site = {
  schemaVersion: 3, tool: { name: 'site-explorer', version: toolVersion }, userAgent: UA, requestedUrl: startUrl, finalOrigin: origin,
  startUrl, crawledAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), robotsDisallow: robotsList(), robotsTxt: { status: robotsInfo.status, text: (robotsInfo.text || '').slice(0, 20000) }, consentAction, redirects: redirectLog, nonHtmlSkipped: nonHtmlLog, blockedPages: pages.filter((p) => p.blocked).map((p) => ({ url: p.url, reason: p.blocked })), skippedByRobots,
  server: { server: headers.main?.server, poweredBy: headers.main?.['x-powered-by'], generator: pages[0]?.meta.generator },
  editing: { platforms, contenteditablePages: pages.filter((p) => p.editing.contenteditable).map((p) => p.url), loginOrAdminLinks: [...new Map(pages.flatMap((p) => p.editing.editLinks).map((l) => [l.href, l])).values()].slice(0, 15) },
  design: { textColors: merge('textColors'), backgrounds: merge('backgrounds'), fontFamilies: merge('fontFamilies', 6), fontSizes: merge('fontSizes'), radii: merge('radii', 6), shadows: merge('shadows', 5), spacing: merge('spacing'), cssVars: pages[0]?.design.cssVars || {}, webFonts: [...new Set(pages.flatMap((p) => p.design.webFonts))], typography: pages[0]?.design.typography, breakpoints: (() => { const m = {}; for (const p of pages) for (const b of p.breakpoints) m[b.px] = (m[b.px] || 0) + b.uses; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([px, uses]) => ({ px: Number(px), uses })); })(), darkMode: pages[0]?.darkMode, buttonHover: pages[0]?.buttonHover },
  components: pages[0]?.components, assets, designer,
  pages: pages.map((p) => ({ slug: p.slug, url: p.url, title: p.title, status: p.status, blocked: p.blocked, h1: p.content.headings.filter((h) => h.level === 1).map((h) => h.text), docHeight: p.layout.docHeight, mobileOverflow: p.layout.mobileOverflow })),
};
fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(site, null, 2));

// markdown report
const list = (a) => a.map((x) => `\`${x.value}\` (${x.count})`).join(', ') || '—';
const md = [
  `# 網站探索報告：${startUrl}`, `爬取 ${pages.length} 頁，耗時 ${site.seconds}s，時間 ${site.crawledAt}`, '',
  ...(site.blockedPages.length ? ['> ⚠️ **部分頁面被擋住**（' + site.blockedPages.map((b) => b.reason).join('、') + '）。結果可能不完整；可降低頻率、改用 Playwright MCP 互動，或確認你有權存取。', ''] : []),
  ...(site.consentAction ? ['- 已自動處理 Cookie 橫幅：「' + site.consentAction + '」', ''] : []),
  '## 編輯方式',
  platforms.length ? platforms.map((p) => `- **${p.platform}**：${p.howToEdit}${Object.keys(p.adminProbes).length ? `（後台探測：${Object.entries(p.adminProbes).map(([k, v]) => `${k}→${v}`).join(', ')}）` : ''}`).join('\n') : '- 未偵測到已知平台特徵（可能為自訂程式碼或靜態站）',
  `- Server: ${site.server.server || '?'}；X-Powered-By: ${site.server.poweredBy || '?'}；Generator: ${site.server.generator || '?'}`,
  `- 登入/後台相關連結：${site.editing.loginOrAdminLinks.map((l) => l.href).join(', ') || '無'}`,
  `- 可直接編輯 (contenteditable) 頁面：${site.editing.contenteditablePages.length}`, '',
  '## 設計', `- 字型：${list(site.design.fontFamilies)}`, `- Web fonts：${site.design.webFonts.join(', ') || '—'}`, `- 字級：${list(site.design.fontSizes)}`,
  `- 文字色：${list(site.design.textColors)}`, `- 背景色：${list(site.design.backgrounds)}`, `- 圓角：${list(site.design.radii)}`, `- 陰影：${list(site.design.shadows)}`, `- 間距：${list(site.design.spacing)}`,
  `- CSS 變數：${Object.keys(site.design.cssVars).length} 個（見 site.json）`, '',
  '## 頁面', ...site.pages.map((p) => `- [${p.status}] ${p.title || '(無標題)'} — ${p.url}（高 ${p.docHeight}px${p.mobileOverflow ? '，手機版橫向溢出' : ''}；${p.slug}/）`), '',
  '## 排版', ...pages.slice(0, 3).flatMap((p) => [`### ${p.url}`, `- landmarks: ${JSON.stringify(p.layout.landmarks)}`, ...p.layout.sections.slice(0, 15).map((s) => `- <${s.tag}${s.id ? '#' + s.id : ''}> ${s.height}px ${s.heading ? '— ' + s.heading : ''}`)]),
].join('\n');
fs.writeFileSync(path.join(outDir, 'report.md'), BANNER + '\n\n' + sanitizeDoc(md) + '\n');
console.log(`\nDone. Report: ${path.join(outDir, 'report.md')}`);
