#!/usr/bin/env node
// Crawl a site with a real browser and capture design, content, layout and editing signals.
import { _t, whyText } from './i18n.mjs';
import { launchBrowser } from './launch.mjs';
import { findUrl, findUrls, intOpt, sameSite, loadRobots, CRAWLER_UA_TOKEN, normalizeFlags } from './args.mjs';
import { isAllowed, groupFor } from './robots.mjs';
import { extractDesignerInPage } from './designer-extract.mjs';
import { extractSeoInPage, extractMobileInPage } from './seo-extract.mjs';
import { parseRules, extractCssInPage, extractRegex, toCsv } from './custom-extract.mjs';
import { checkHtml } from './html-validity.mjs';
import { archiveInPage } from './page-archive.mjs';
import { extractMarkdownInPage, renderPageMarkdown } from './page-markdown.mjs';
import { extractTechInPage } from './techstack.mjs';
import { fingerprintHooks, collectBehaviors } from './tracking-behaviors.mjs';
import { BANNER, sanitizeDoc } from './untrusted.mjs';
import { readCapped, readCappedBuffer, mayFetch, guardInternal, gfetch, isInternalHost, resolvesInternal, stripMarkup, tagList, attrValue } from './util.mjs';
import { parseSitemap } from './health-check.mjs';
import { attachNetworkRecorder, deepContent, ariaTree } from './observe.mjs';
import { exploreStates } from './interact.mjs';
import { extractResponsiveInPage, responsiveMarkdown } from './responsive.mjs';
import { classifyUrls, analyzeCookies, detectConsentInPage, resourceUrlsInPage, summarizePrivacy, privacyMarkdown } from './trackers.mjs';
import { probe } from './diagnose.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { loadAuthState, skipLink } from './auth-state.mjs';

const __n = normalizeFlags(process.argv.slice(2)); if (__n.error) { console.error(__n.error); process.exit(1); }
const args = __n.args;
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
const interactMax = args.includes('--no-interact') ? 0 : intOpt(args, 'interact-pages', 3, { min: 0, max: 30 }); let interactedPages = 0, abProbes = 0; // pages we walk through click/scroll/key states on
const contentWaitMs = intOpt(args, 'wait', 12000, { min: 0, max: 120000 }); // how long to wait for a script-built page to put something on screen
const shots = !args.includes('--no-screenshots');
const perfRuns = intOpt(args, 'perf-runs', 1, { min: 1, max: 7 }); const throttle = opt('throttle', null) === 'mobile';
let extractRules = null; if (opt('extract', null)) { try { extractRules = parseRules(fs.readFileSync(opt('extract', null), 'utf8')); } catch (e) { console.error(String(e.message).split('\n')[0]); process.exit(1); } }
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
      // whole words only: "conseil-d-administration" (board of directors) and "credit" are not login/edit links
      editLinks: [...document.querySelectorAll('a[href]')].filter((a) => { let toks = []; try { toks = new URL(a.href).pathname.toLowerCase().split(/[\/\-_.]+/).filter(Boolean); } catch {} const words = new Set(['admin', 'administrator', 'login', 'signin', 'dashboard', 'edit', 'backend']); return toks.some((t) => words.has(t)) || (toks.includes('sign') && toks.includes('in')) || /^(log ?in|sign ?in|edit( page)?|admin|dashboard)$/i.test(a.innerText.trim()); }).map((a) => ({ text: a.innerText.trim().slice(0, 40), href: a.href })).slice(0, 10),
      dataAttrs: [...new Set([...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name)).filter((n) => /^data-(wf|wix|sqs|framer|elementor|et-|vc-|block|sanity|contentful|builder|ghost|shopify)/.test(n)))].slice(0, 20),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 80),
      stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).slice(0, 40),
      bodyClasses: document.body.className,
    },
  };
}

// ---- technology / editing-method detection ----
const SIGNATURES = [
  ['WordPress', /wp-content|wp-includes|wp-json|WordPress/i, ['/wp-admin/', '/wp-login.php'], _t('WordPress 後台 /wp-admin，區塊編輯器(Gutenberg)或頁面建構器(Elementor/Divi)編輯')],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme|myshopify/i, ['/admin'], _t('Shopify 後台 /admin；佈景主題編輯器 (Online Store > Themes > Customize)')],
  ['Wix', /wixstatic\.com|wix\.com|X-Wix/i, [], _t('Wix Editor / Wix Studio 視覺化編輯器（需帳號登入）')],
  ['Webflow', /webflow\.(com|io)|data-wf-/i, [], _t('Webflow Designer（視覺化設計）+ Editor（內容編輯）')],
  ['Squarespace', /squarespace|sqs-/i, ['/config'], _t('Squarespace 後台（/config），網站內嵌式編輯')],
  ['Framer', /framer\.(com|app)|framerusercontent/i, [], _t('Framer 設計畫布，發佈為靜態網站')],
  ['Ghost', /ghost\.io|content="Ghost|ghost-/i, ['/ghost/'], _t('Ghost 後台 /ghost，Markdown/卡片編輯器')],
  ['Next.js', /_next\/static|__NEXT_DATA__/i, [], _t('程式碼專案（React/Next.js），內容多在原始碼或 Headless CMS')],
  ['Nuxt', /_nuxt\/|__NUXT__/i, [], _t('程式碼專案（Vue/Nuxt），內容多在原始碼或 Headless CMS')],
  ['Gatsby', /___gatsby|gatsby-/i, [], _t('靜態站（Gatsby），內容來自原始碼/Headless CMS')],
  ['Astro', /astro-island|content="Astro/i, [], _t('靜態站（Astro），內容在 Markdown/原始碼')],
  ['Hugo/Jekyll', /content="(Hugo|Jekyll)/i, [], _t('靜態站產生器，內容為 Markdown 檔，編輯後重新建置')],
  ['Drupal', /Drupal|\/sites\/default\//i, ['/user/login'], _t('Drupal 後台 /user/login')],
  ['Joomla', /Joomla|\/media\/jui\//i, ['/administrator/'], _t('Joomla 後台 /administrator')],
  ['Notion/Super', /notion\.so|super\.so|notion-/i, [], _t('以 Notion 頁面作為內容來源')],
  ['Sanity/Contentful', /sanity\.io|contentful\.com|ctfassets/i, [], _t('Headless CMS（Sanity/Contentful）供應內容')],
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
// What the page loads and sets by itself. Run for the first page BEFORE the crawler touches a cookie banner (dismissConsent), so cookies and the banner are seen as a new visitor sees them.
async function snapshotPrivacy(page, ctx, net) {
  try {
    const dom = await page.evaluate(resourceUrlsInPage).catch(() => []); const n = net.summary(page.url());
    const urls = [...dom, ...(n.hostList || []).map((h) => `https://${h}/`), ...(n.failedUrls || [])];
    return { vendors: classifyUrls(urls), cookies: analyzeCookies((await ctx.cookies()).filter((c) => !auth || !auth.cookieKeys.has(`${c.name}|${String(c.domain || '').replace(/^\./, '')}`)), new URL(page.url()).hostname, { https: page.url().startsWith('https:') }), consent: await page.evaluate(detectConsentInPage).catch(() => ({ detected: false, kind: null })) };
  } catch { return null; }
}
async function dismissConsent(page) { // only ever clicks inside the box detectConsentInPage marked: never "any button on a page whose <body> mentions cookies"
  try {
    return await page.evaluate(() => {
      const box = document.querySelector('[data-se-consent="1"]');
      if (!box) return null;
      const btns = [...box.querySelectorAll('button, a[role=button], [role=button], input[type=button]')];
      const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      const pick = (re) => btns.find((b) => re.test(label(b)));
      const b = pick(/\b(reject|decline|refuse|deny)\b|necessary only|拒絕|僅必要|只接受必要/i) || pick(/\b(accept|agree|allow)\b|\bgot it\b|\bok\b|同意|接受|我知道/i);
      if (!b) return null;
      b.click();
      return label(b).slice(0, 30);
    });
  } catch { return null; }
}
async function detectBlock(page, status) {
  const text = await page.evaluate(() => (document.title + ' ' + (document.body?.innerText || '').slice(0, 800)).toLowerCase()).catch(() => '');
  if (/just a moment|attention required|captcha|verify you are human|are you a robot|access denied|unusual traffic|enable javascript and cookies/.test(text)) return _t('驗證／防機器人頁面');
  if ([401, 403, 429].includes(status)) return `HTTP ${status}`;
  if (status >= 500) return _t`伺服器錯誤 HTTP ${status}`;
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

// JS-built pages (SPA, WebGL experiences, intro screens) can be empty at "load": wait until real content appears, or give up after maxMs.
async function waitForContent(page, maxMs) {
  const t0 = Date.now();
  const mainHas = () => page.evaluate(() => !!document.body && (document.body.innerText.trim().length > 80 || document.querySelectorAll('h1,h2,h3,p,a[href],button,nav,main,header').length > 6)).catch(() => false);
  const has = async () => { if (await mainHas()) return true; const d = await deepContent(page).catch(() => null); return !!d && (d.textChars > 80 || d.interactive > 6); }; // text inside shadow roots / iframes counts too
  const someText = () => page.evaluate(() => (document.body?.innerText || '').trim().length >= 3).catch(() => false);
  while (Date.now() - t0 < maxMs) {
    if (await has()) return true;
    if (Date.now() - t0 > 3000 && await someText()) break; // a small page that already shows something is not "still loading": do not make it wait the full time
    await page.waitForTimeout(500);
  }
  return await has();
}

// What a crawler that does NOT run JavaScript would receive for this URL.
async function fetchRaw(u) {
  try {
    const r = await gfetch(u, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
    if (!mayFetch(r.url, u)) return { status: null, error: 'redirected to an internal address' };
    const html = await readCapped(r, 1_500_000);
    const bi = html.search(/<body/i); const be = html.toLowerCase().lastIndexOf('</body>'); // linear scans, no backtracking
    const body = bi >= 0 ? html.slice(bi, be > bi ? be + 7 : undefined) : html;
    const text = stripMarkup(body).replace(/&[a-z#0-9]+;/gi, ' ');
    const latin = (text.match(/[A-Za-z0-9À-ɏ']+/g) || []).length, cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
    const tags = tagList(html); const first = (n) => tags.find((t) => t.name === n);
    const ti = html.search(/<title[\s>]/i); let title = '';
    if (ti >= 0) { const o = html.indexOf('>', ti), c = html.toLowerCase().indexOf('</title', o); if (o >= 0 && c > o) title = html.slice(o + 1, c); }
    const metaRobots = tags.find((t) => t.name === 'meta' && /^robots$/i.test(attrValue(t.attrs, 'name') || ''));
    return {
      htmlTag: first('html') ? `<html${first('html').attrs}>`.slice(0, 200) : '', metaCount: tags.filter((t) => t.name === 'meta').length,
      status: r.status, finalUrl: r.url, bytes: html.length, contentType: r.headers.get('content-type') || '',
      title: title.replace(/\s+/g, ' ').trim(), h1Count: tags.filter((t) => t.name === 'h1').length,
      words: latin + Math.round(cjk / 1.8), links: tags.filter((t) => t.name === 'a' && attrValue(t.attrs, 'href') !== null).length,
      canonical: tags.some((t) => t.name === 'link' && /canonical/i.test(attrValue(t.attrs, 'rel') || '')),
      jsonld: tags.filter((t) => t.name === 'script' && /application\/ld\+json/i.test(attrValue(t.attrs, 'type') || '')).length,
      metaRobots: metaRobots ? (attrValue(metaRobots.attrs, 'content') || '') : null,
      validity: checkHtml(html).slice(0, 14).map((f) => ({ id: f.id, severity: f.severity, count: f.count, examples: f.examples })),
      csrShell: tags.some((t) => t.name === 'div' && /^(root|app|__next|__nuxt)$/i.test(attrValue(t.attrs, 'id') || '') && /^\s*<\/div>/i.test(html.slice(t.end, t.end + 40))),
    };
  } catch (e) { return { error: String(e.message).slice(0, 100) }; }
}
const pickHeaders = (h = {}) => Object.fromEntries(['content-type', 'x-robots-tag', 'cache-control', 'content-encoding', 'strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'server', 'x-powered-by', 'link', 'last-modified', 'etag', 'vary', 'age', 'cf-cache-status', 'x-cache', 'via', 'x-served-by', 'cf-ray', 'x-vercel-id', 'x-nf-request-id', 'x-amz-cf-id', 'x-github-request-id', 'x-shopify-stage', 'x-wix-request-id', 'x-drupal-cache', 'x-generator', 'x-pingback', 'x-aspnet-version', 'x-akamai-transformed', 'x-fastly-request-id', 'x-turbo-charged-by', 'x-litespeed-cache', 'platform', 'x-ghost-cache-status'].filter((k) => h[k] !== undefined).map((k) => [k, k === 'content-security-policy' ? String(h[k]).slice(0, 200) : h[k]]));

// Pages a script-built or 3D site hides from the live DOM: ask the places crawlers ask (raw HTML links, sitemap.xml, the home page).
async function discoverMore(fromUrl) {
  const found = new Map(); const add = (href, why) => { try { const u = new URL(href, fromUrl); if (!/^https?:$/.test(u.protocol) || !sameSite(u.href, origin)) return; u.hash = ''; if (!found.has(norm(u.href))) found.set(norm(u.href), { url: u.href, why }); } catch {} };
  const text = async (u, max = 2_000_000) => { try { if (!mayFetch(u, fromUrl)) return ''; const r = await gfetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) }); return r.ok ? await readCapped(r, max) : ''; } catch { return ''; } };
  const html = await text(fromUrl, 3_000_000); let n = 0;
  for (const t of tagList(html)) { if (t.name !== 'a') continue; const h = attrValue(t.attrs, 'href'); if (!h || h.startsWith('#')) continue; if (++n > 400) break; add(h.slice(0, 2000), _t('HTML 連結')); }
  const sitemapUrls = new Set([...(robotsInfo.parsed?.sitemaps || []), origin + '/sitemap.xml', origin + '/sitemap_index.xml']);
  let children = 0;
  for (const sm of [...sitemapUrls].slice(0, 6)) {
    const xml = await text(sm, 5_000_000); if (!/<(?:[\w-]+:)?(urlset|sitemapindex)/i.test(xml)) continue;
    const parsed = parseSitemap(xml); for (const u of parsed.urls.slice(0, 500)) add(u.loc, 'sitemap');
    for (const c of parsed.sitemaps.slice(0, 3)) { if (children++ >= 4) break; const cx = await text(c.loc, 5_000_000); for (const u of parseSitemap(cx).urls.slice(0, 500)) add(u.loc, 'sitemap'); }
  }
  add(origin + '/', _t('首頁'));
  const startPath = new URL(fromUrl).pathname.replace(/\/[^/]*$/, '/'); // same section as the page you gave first, then the rest
  const skip = (u) => skipLink(u, { authed: !!auth }) || /\.(xml|json|txt)(\?|$)/i.test(u);
  const list = [...found.values()].filter((f) => !skip(f.url) && !seen.has(norm(f.url))).sort((a, b) => (new URL(b.url).pathname.startsWith(startPath) ? 1 : 0) - (new URL(a.url).pathname.startsWith(startPath) ? 1 : 0));
  let added = 0; const bySource = {};
  for (const f of list) { if (added >= maxPages * 3) break; try { if (!allowed(f.url)) continue; } catch { continue; } seen.add(norm(f.url)); queue.push([stripHash(f.url), 1]); added++; bySource[f.why] = (bySource[f.why] || 0) + 1; }
  console.log(added ? _t`   在頁面上找不到可點的連結，改從 ${Object.entries(bySource).map(([k, v]) => _t`${k} ${v} 個`).join(_t('、'))} 找到 ${added} 個候選頁面` : _t('   找不到其他頁面（沒有 HTML 連結、sitemap，也沒有可用的首頁）'));
  return added;
}

// ---- main ----
let robotsInfo = await loadRobots(origin);
const robotsList = () => (groupFor(robotsInfo.parsed || { groups: [] }, CRAWLER_UA_TOKEN)?.rules || []).filter((r) => r.type === 'disallow' && r.path).map((r) => r.path);
// robots.txt is per ORIGIN: an extra URL queued for old.example must be judged by old.example's rules even after the first page redirected to new.example
const robotsByOrigin = new Map([[origin, robotsInfo]]);
const ensureRobots = async (u) => { const o = new URL(u).origin; if (!robotsByOrigin.has(o)) robotsByOrigin.set(o, await loadRobots(o)); };
const allowed = (u) => { const x = new URL(u); const ri = robotsByOrigin.get(x.origin) || robotsInfo; if (ri.serverError) return false; return isAllowed(ri.parsed, CRAWLER_UA_TOKEN, x.pathname + x.search).allowed; };
if (robotsInfo.serverError) {
  console.error(_t`\n沒有爬取任何頁面。\n原因：robots.txt 回應 HTTP ${robotsInfo.status}（伺服器錯誤）。依慣例無法確認是否允許，視為禁止抓取。請稍後再試，或確認網站 robots.txt 是否正常。`);
  process.exit(3);
}
if (!allowed(startUrl)) {
  console.error(_t('\n沒有成功爬取任何頁面。\n原因：robots.txt 不允許爬取此網站（') + robotsList().join(', ') + _t('）。已依網站設定停止；若你擁有此網站，請調整 robots.txt，或改用 Playwright MCP 手動瀏覽。'));
  process.exit(3);
}
const headed = args.includes('--headed'); // visible browser window: real GPU, and you can click an "enter" button yourself
const browser = await launchBrowser({ headless: !headed });
const UA = 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)';
const authFile = opt('storage-state', null);
let auth = null;
if (authFile) { try { auth = loadAuthState(authFile); } catch (e) { console.error(e.message); await browser.close(); process.exit(1); } for (const w of auth.warnings) console.error('⚠️  ' + w); console.error(_t('🔐 以登入狀態探索：輸出（截圖、文字、儀表板）可能含個人資料，請勿公開分享。已略過登出、刪除、取消等會改變資料的連結。')); }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, ...(auth ? { storageState: auth.file } : {}) });
await guardInternal(ctx, startUrl);
await ctx.addInitScript(fingerprintHooks).catch(() => {}); // passive recorders for tracking-behaviors.mjs (canvas / WebGL / audio / font probing) // a public site (or a redirect from it) cannot make the browser read localhost / the LAN
const stripHash = (u) => { const x = new URL(u); x.hash = ''; return x.href; };
const queue = [[stripHash(startUrl), 0]], seen = new Set([norm(startUrl)]), pages = [], headers = {};
for (const extra of findUrls(args).slice(1)) { try { if (!sameSite(extra, origin) || seen.has(norm(extra))) continue; seen.add(norm(extra)); queue.push([stripHash(extra), 0]); } catch {} } // extra URLs given on the command line are crawled too (script-built sites hide them from each other)
let consentAction = null;
const crawledFinal = new Set(), redirectLog = []; // dedupe by FINAL url: /old and /new that land on the same page are one page
const skippedByRobots = [], nonHtmlLog = [];
const t0 = Date.now();

let discovered = false;
while (pages.length < maxPages) {
  if (!queue.length) { if (discovered || !pages.length) break; discovered = true; if (!(await discoverMore(pages[0].url || startUrl))) break; }
  const [url, depth] = queue.shift();
  await ensureRobots(url).catch(() => {});
  if (!allowed(url)) { console.log('skip (robots):', url); skippedByRobots.push(url); continue; }
  const page = await ctx.newPage();
  const net = attachNetworkRecorder(page); const pageErrors = [];
  page.on('pageerror', (e) => { if (pageErrors.length < 6) { const at = String(e.stack || '').split('\n').find((l) => /https?:\/\//.test(l)); pageErrors.push(_t('錯誤：') + String(e.message).split('\n')[0].slice(0, 160) + (at ? _t('　位置：') + at.replace(/^\s*at\s+/, '').trim().slice(0, 160) : '')); } });
  page.on('console', (m) => { if (m.type() === 'error' && pageErrors.length < 6) pageErrors.push(_t('主控台：') + m.text().split('\n')[0].slice(0, 160)); });
  const watchdog = setTimeout(() => { console.log('timeout (120s), giving up on:', url); page.close().catch(() => {}); }, 120000);
  try {
    const mixed = new Set(); page.on('request', (r) => { if (/^https:/.test(page.url()) && /^http:/.test(r.url())) mixed.add(r.url().split(/[?#]/)[0].slice(0, 140)); });
    const resp = await openPage(page, url);
    const contentType = (resp?.headers()['content-type'] || '').toLowerCase();
    if (resp && contentType && !/html/.test(contentType)) { // JSON/PDF/XML/images are not pages: do not score them as pages
      nonHtmlLog.push({ url, contentType: contentType.split(';')[0] }); console.log(`   (skipped, not an HTML page: ${contentType.split(';')[0]})`);
      clearTimeout(watchdog); await page.close().catch(() => {}); continue;
    }
    if (pages.length === 0 && new URL(page.url()).origin !== origin) {
      origin = new URL(page.url()).origin; robotsInfo = await loadRobots(origin); robotsByOrigin.set(origin, robotsInfo);
      console.log('redirected to', origin);
    }
    await ensureRobots(page.url()).catch(() => {});
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
    let preConsent = null;
    if (pages.length === 0) { for (let k = 0; k < 6; k++) { if ((await page.evaluate(detectConsentInPage).catch(() => null))?.detected) break; await page.waitForTimeout(400); } // banners are often injected by a script after load
      preConsent = await snapshotPrivacy(page, ctx, net); consentAction = await dismissConsent(page); if (consentAction) await page.waitForTimeout(600); }
    let contentReady = await waitForContent(page, contentWaitMs);
    // trigger lazy content
    // bounded: infinite-scroll pages grow forever while you scroll
    await page.evaluate(async () => { const t0 = Date.now(); for (let y = 0, n = 0; y < document.body.scrollHeight && n < 40 && Date.now() - t0 < 4000; y += 600, n++) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    if (!contentReady) contentReady = await waitForContent(page, 0); // content inserted only by the lazy-load scroll counts
    if (!contentReady) console.log(_t('   ⚠️ 頁面在等待後仍幾乎是空的（見報告中的診斷）（可能是 3D／WebGL 體驗頁、要先點「進入」、被擋或載入逾時）：') + url);
    const data = await page.evaluate(extractInPage);
    data.deep = await deepContent(page).catch(() => null);
    data.network = net.summary(page.url());
    { // first page: cookies + banner as a NEW visitor sees them (snapshot taken before the crawler touched the banner); later pages: only the services they load
      const now = await snapshotPrivacy(page, ctx, net);
      if (!now) data.privacy = null;
      else if (preConsent) { const names = new Set(preConsent.vendors.map((v) => v.name)); data.privacy = { stage: 'before', vendors: preConsent.vendors, vendorsAfter: now.vendors.filter((v) => !names.has(v.name)), cookies: preConsent.cookies, consent: preConsent.consent }; } // vendors = loaded for a new visitor; vendorsAfter = only appeared after the crawler touched the banner / scrolled
      else data.privacy = { stage: 'after', vendors: [], vendorsAfter: now.vendors, cookies: [], consent: { detected: false, kind: null } };
    }
    const aria = await ariaTree(page);
    data.aria = aria ? { lines: aria.lines, headings: aria.headings, links: aria.links, buttons: aria.buttons, images: aria.images, landmarks: aria.landmarks, head: aria.text.split('\n').slice(0, 40).join('\n').slice(0, 3500) } : null;
    data._ariaText = aria?.text || null; // written to aria.yml below, not kept in page.json
    data.tech = await page.evaluate(extractTechInPage).catch(() => null); // globals / DOM markers for techstack.mjs
    data._markdown = await page.evaluate(extractMarkdownInPage).catch(() => null); // written to content.md below (document order, one file per page)
    data.emptyPage = !contentReady;
    if (data.emptyPage) { // say WHY, from what the page actually contains
      data.emptyDiag = await page.evaluate(() => {
        const all = [...document.querySelectorAll('*')]; const txt = (document.body?.innerText || '').trim();
        let gl = null; try { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (g) { const e = g.getExtension('WEBGL_debug_renderer_info'); gl = e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : 'webgl'; } } catch {}
        return { webgl: gl, webdriver: navigator.webdriver === true, elements: all.length, canvases: document.querySelectorAll('canvas').length, iframes: document.querySelectorAll('iframe').length, shadowHosts: all.filter((e) => e.shadowRoot).length, buttons: document.querySelectorAll('button,[role=button],a[href]').length, textChars: txt.length, readyState: document.readyState, title: document.title.slice(0, 80), sample: txt.slice(0, 100), blockPage: /just a moment|access denied|attention required|captcha|verify you are human|are you a robot|unusual traffic|enable javascript/i.test(document.title + ' ' + txt.slice(0, 400)) };
      }).catch(() => null);
      if (data.emptyDiag && abProbes < 3) { // same URL again with the browser's own default identity: does the site serve something else to our identity?
        abProbes++;
        try { const a = await probe(browser, page.url(), { label: 'browser-default', userAgent: null, outDir: path.join(outDir, 'pages', slugOf(url), 'alt'), waitMs: 6000 });
          data.emptyDiag.alt = a.error ? { error: a.error } : { status: a.status, contentAppeared: !!a.contentAppeared, textChars: a.deep ? a.deep.textChars : a.dom.textChars, elements: a.dom.elements, canvases: a.dom.canvases, title: a.dom.title, errors: a.consoleErrors.slice(0, 3) };
        } catch (e) { data.emptyDiag.alt = { error: String(e.message).slice(0, 100) }; } }
      data.pageErrors = pageErrors.slice();
      if (data.emptyDiag) { data.emptyDiag.consoleErrors = pageErrors.slice(); const n = net.summary(page.url()); data.emptyDiag.scripts = n.byType.script || 0; data.emptyDiag.dataRequests = (n.byType.fetch || 0) + (n.byType.xhr || 0); data.emptyDiag.requests = n.total; data.emptyDiag.scriptUrls = n.scriptUrls || []; }
    }
    data.designer = await page.evaluate(extractDesignerInPage).catch((e) => { console.log('   (designer data skipped:', e.message.split('\n')[0] + ')'); return null; });
    for (const b of data.designer?.blocks || []) if (b && typeof b.why === 'string') b.why = whyText(b.why); // the reason text is produced inside the page (no translator there): translate it here
    data.status = resp?.status();
    // --- SEO / indexability signals ---
    data.seo = await page.evaluate(extractSeoInPage).catch((e) => { console.log('   (seo data skipped:', e.message.split('\n')[0] + ')'); return null; });
    if (data.seo?.perf && !auth && (perfRuns > 1 || throttle)) { // repeated (and optionally throttled) cold loads on throwaway pages; the page's numbers become the median of the runs
      const runs = throttle ? [] : [data.seo.perf];
      for (let k = 0; k < Math.max(perfRuns, throttle ? 1 : 2) - (throttle ? 0 : 1); k++) {
        const p2 = await ctx.newPage();
        try {
          const cdp = await ctx.newCDPSession(p2); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          if (throttle) { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
          await p2.goto(url, { waitUntil: 'load', timeout: throttle ? 60000 : 30000 }); await p2.waitForTimeout(600);
          const s2 = await p2.evaluate(extractSeoInPage); if (s2?.perf) runs.push(s2.perf);
        } catch {} finally { await p2.close().catch(() => {}); }
      }
      if (runs.length) { const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; }; const base = runs[0]; const merged = { ...base }; for (const key of ['ttfbMs', 'domContentLoadedMs', 'loadMs', 'fcpMs', 'lcpMs', 'cls', 'tbtMs', 'totalBytes', 'requests']) { const m = med(runs.map((r) => r[key])); if (m != null) merged[key] = m; } data.seo.perf = merged; data.seo.perfRuns = runs.length; data.seo.perfThrottled = throttle; }
    }
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
    const __html = await page.content(); fs.writeFileSync(path.join(dir, 'page.html'), __html);
    if (extractRules) { // --extract: the user's own rules, on the rendered page
      try {
        const css = await page.evaluate(extractCssInPage, extractRules.filter((r) => r.css).map(({ name, css, attr, all }) => ({ name, css, attr, all })));
        const text = extractRules.some((r) => r.regex && r.in === 'text') ? await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 300000)) : '';
        data.extract = { ...css, ...extractRegex(extractRules, { text, html: __html }) };
      } catch { data.extract = null; }
    }
    if (args.includes('--archive')) { // opt-in single-file offline copy (rendered DOM, CSS and images inlined, scripts removed)
      try { const a = await page.evaluate(archiveInPage, { maxBytes: 12e6, maxOne: 2e6, pageUrl: page.url(), when: new Date().toISOString().slice(0, 10) }); fs.writeFileSync(path.join(dir, 'archive.html'), a.html); data.archive = { file: 'archive.html', bytes: a.bytes, embedded: a.embedded, linked: a.linked }; } catch (e) { data.archive = { error: String(e.message).split('\n')[0].slice(0, 100) }; }
    }
    data.responsive = {};
    const homeUrl = page.url(); // some sites redirect when the window is resized (e.g. to an m. site): measurements taken there are not this page's
    const jumped = async (name) => { if (page.url() === homeUrl) return false; data.responsiveSkipped = _t`頁面在視窗縮到「${name}」寬度時自己跳轉到別的網址，手機／平板的量測與截圖略過`; delete data.responsive[name]; await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {}); await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); return true; };
    if (shots) {
      for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
        if (name !== 'desktop' && await jumped(name)) break;
        data.responsive[name] = await page.evaluate(extractResponsiveInPage).catch(() => null);
        if (name === 'tablet' && data.seo) data.seo.tablet = await page.evaluate(extractMobileInPage).catch(() => null);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth).catch(() => false);
        data.layout[`${name}Overflow`] = overflow;
        try { await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, timeout: 20000 }); }
        catch { await page.screenshot({ path: path.join(dir, `${name}.png`), timeout: 10000 }).catch(() => {}); } // huge pages: keep the data, fall back to the visible area
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
    } else {
      for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
        if (name !== 'desktop' && await jumped(name)) break;
        data.responsive[name] = await page.evaluate(extractResponsiveInPage).catch(() => null);
        if (data.seo && name === 'tablet') data.seo.tablet = await page.evaluate(extractMobileInPage).catch(() => null);
        if (data.seo && name === 'mobile') data.seo.mobile = await page.evaluate(extractMobileInPage).catch(() => null);
      }
    }
    // Experience pages hide content behind "enter", scrolling or keys: walk through those states last, so nothing above was measured on a changed page
    { const canv = await page.evaluate(() => document.querySelectorAll('canvas').length).catch(() => 0);
      if (interactedPages < interactMax && (args.includes('--interact') || canv > 0 || (data.emptyPage && (!data.deep || data.deep.textChars === 0)) || (data.deep && data.deep.textChars < 80 && data.deep.interactive >= 1))) {
        interactedPages++;
        try { await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
          const startPageUrl = page.url();
          const st = await exploreStates(page, { outDir: path.join(dir, 'states'), maxSteps: 6, allowed, log: (m) => console.log(m) });
          data.network = net.summary(startPageUrl); // refresh: what the clicked / scrolled states fetched (APIs, 3D assets) belongs in the picture too
          data.states = st.states; data.statesStopped = st.stoppedBecause;
          if (st.blockedWrites) console.log(_t`   （互動時拒絕了 ${st.blockedWrites} 個會改資料的請求（POST／PUT／DELETE）；依賴它們的畫面可能看起來不完整）`);
          if (st.states.length > 1) console.log(_t`   互動探索：${st.states.length} 個畫面狀態（${st.stoppedBecause === 'maxSteps' ? _t('達步數上限') : st.stoppedBecause === 'timeBudget' ? _t('達時間上限') : _t('之後沒有變化')}）`);
          else console.log(_t('   互動探索：點擊、滾動、按鍵後畫面都沒有變化'));
        } catch (e) { console.log(_t('   (互動探索略過：') + String(e.message).split('\n')[0] + ')'); }
      } }
    if (data._ariaText) fs.writeFileSync(path.join(dir, 'aria.yml'), sanitizeDoc(data._ariaText));
    data.behaviors = await collectBehaviors(page, { auth: !!auth }).catch(() => null); // fingerprinting hooks + a harmless typing probe (never submits)
    delete data._ariaText;
    if (data._markdown) { try { fs.writeFileSync(path.join(dir, 'content.md'), sanitizeDoc(renderPageMarkdown(data, data._markdown, BANNER)) + '\n'); data.contentWords = data._markdown.words; } catch {} }
    delete data._markdown;
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(data, null, 2));
    data.slug = slugOf(url);
    pages.push(data);
    console.log(`[${pages.length}/${maxPages}] ${url}`);
    if (depth < maxDepth) {
      for (const l of data.content.links) {
        try {
          if (!/^https?:/.test(l.href) || !sameSite(l.href, origin)) continue;
          if (skipLink(l.href, { authed: !!auth })) continue;
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
  console.error(_t('\n沒有成功爬取任何頁面。'));
  if (skippedByRobots.length) console.error(_t`原因：robots.txt 不允許爬取此網站（${robotsList().join(', ')}）。已依網站設定停止；若你擁有此網站，請調整 robots.txt，或改用 Playwright MCP 手動瀏覽。`);
  else console.error(_t('原因：頁面無法載入（網址錯誤、逾時或被擋住）。請執行：site-explorer doctor <網址> 確認連線。'));
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
    const r = await gfetch(u, { signal: AbortSignal.timeout(15000) }); if (!r.ok || !/^(image\/|text\/xml|application\/xml)/i.test(r.headers.get('content-type') || '')) continue;
    const buf = await readCappedBuffer(r, 5_000_000); if (!buf) continue;
    const ext = (new URL(u).pathname.match(/\.(svg|png|jpe?g|webp|ico|gif)$/i) || [, 'bin'])[1].toLowerCase();
    fs.writeFileSync(path.join(outDir, 'assets', `${name}.${ext}`), buf);
    assets.push({ name, file: `assets/${name}.${ext}`, source: u });
  } catch {}
}

const fetchStatus = async (u) => { try { if (!(await resolvesInternal(new URL(startUrl).hostname)) && await resolvesInternal(new URL(u).hostname)) return null; return (await fetch(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) })).status; } catch { return null; } };
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
  schemaVersion: 3, authenticated: !!auth, tool: { name: 'site-explorer', version: toolVersion }, userAgent: UA, requestedUrl: startUrl, finalOrigin: origin,
  startUrl, crawledAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), robotsDisallow: robotsList(), robotsTxt: { status: robotsInfo.status, text: (robotsInfo.text || '').slice(0, 20000) }, consentAction, redirects: redirectLog, nonHtmlSkipped: nonHtmlLog, blockedPages: pages.filter((p) => p.blocked).map((p) => ({ url: p.url, reason: p.blocked })), skippedByRobots,
  server: { server: headers.main?.server, poweredBy: headers.main?.['x-powered-by'], generator: pages[0]?.meta.generator },
  editing: { platforms, contenteditablePages: pages.filter((p) => p.editing.contenteditable).map((p) => p.url), loginOrAdminLinks: [...new Map(pages.flatMap((p) => p.editing.editLinks).map((l) => [l.href, l])).values()].slice(0, 15) },
  design: { textColors: merge('textColors'), backgrounds: merge('backgrounds'), fontFamilies: merge('fontFamilies', 6), fontSizes: merge('fontSizes'), radii: merge('radii', 6), shadows: merge('shadows', 5), spacing: merge('spacing'), cssVars: pages[0]?.design.cssVars || {}, webFonts: [...new Set(pages.flatMap((p) => p.design.webFonts))], typography: pages[0]?.design.typography, breakpoints: (() => { const m = {}; for (const p of pages) for (const b of p.breakpoints) m[b.px] = (m[b.px] || 0) + b.uses; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([px, uses]) => ({ px: Number(px), uses })); })(), darkMode: pages[0]?.darkMode, buttonHover: pages[0]?.buttonHover },
  components: pages[0]?.components, assets, designer,
  privacy: summarizePrivacy(pages.map((p) => p.privacy)),
  pages: pages.map((p) => ({ responsive: p.responsive || null, privacy: p.privacy || null, states: p.states || null, network: p.network || null, aria: p.aria || null, deep: p.deep || null, emptyPage: !!p.emptyPage, emptyDiag: p.emptyDiag || null, slug: p.slug, url: p.url, title: p.title, status: p.status, blocked: p.blocked, h1: p.content.headings.filter((h) => h.level === 1).map((h) => h.text), docHeight: p.layout.docHeight, mobileOverflow: p.layout.mobileOverflow })),
};
fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(site, null, 2));
if (extractRules) { // one row per page, one column per rule
  const rows = pages.map((p) => ({ url: p.url, extract: p.extract || {} }));
  fs.writeFileSync(path.join(outDir, 'extractions.json'), JSON.stringify({ rules: extractRules.map(({ name, css, regex, attr, in: where }) => ({ name, css, regex, attr, in: where })), rows }, null, 2));
  fs.writeFileSync(path.join(outDir, 'extractions.csv'), toCsv(extractRules, rows));
}

// markdown report
const list = (a) => a.map((x) => `\`${x.value}\` (${x.count})`).join(', ') || '—';
const md = [
  _t`# 網站探索報告：${startUrl}`, _t`爬取 ${pages.length} 頁，耗時 ${site.seconds}s，時間 ${site.crawledAt}`, '',
  ...(pages.some((p) => p.emptyPage) ? [_t('> ⚠️ **有頁面在等待後仍幾乎是空的**（') + pages.filter((p) => p.emptyPage).map((p) => p.url).join(_t('、')) + _t('）：設計、文字、版面可能抓不到。請看該頁的 `desktop.png` 截圖確認畫面。'), ...pages.filter((p) => p.emptyPage && p.emptyDiag).flatMap((p) => { const d = p.emptyDiag; return ['', _t`診斷（${p.url}）：DOM 元素 ${d.elements}、canvas ${d.canvases}、iframe ${d.iframes}、shadow root ${d.shadowHosts}、可點擊元素 ${d.buttons}、可見文字 ${d.textChars} 字、載入狀態 ${d.readyState}、標題「${d.title}」`, _t`- 請求 ${d.requests ?? '?'} 個（腳本 ${d.scripts ?? '?'}、資料請求 fetch／XHR ${d.dataRequests ?? '?'}）；WebGL：${d.webgl || _t('此瀏覽器環境沒有')}；webdriver 旗標：${d.webdriver ? _t('有') : _t('無')}`, ...((d.consoleErrors || []).length ? [_t('- 頁面錯誤：'), ...d.consoleErrors.map((e) => `  - ${e}`)] : [_t('- 頁面錯誤：沒有（腳本沒有丟出錯誤）')]),
      ...((d.scriptUrls || []).length ? [_t`- 載入的腳本：${d.scriptUrls.join(_t('、'))}`] : []),
      ...(p.seo && p.seo.raw && p.seo.raw.htmlTag !== undefined ? [_t`- 伺服器給的原始 HTML：\`${p.seo.raw.htmlTag || _t('（沒有 <html> 標籤）')}\`，meta 標籤 ${p.seo.raw.metaCount} 個`] : []),
      ...(d.alt ? (d.alt.error ? [_t`- 用瀏覽器預設身分再開一次：失敗（${d.alt.error}）`] : [_t`- 用瀏覽器預設身分再開一次：${d.alt.contentAppeared ? _t('**內容出現了**') : _t('仍然沒有內容')}（可見文字 ${d.alt.textChars} 字、DOM 元素 ${d.alt.elements}${d.alt.errors && d.alt.errors.length ? _t('；錯誤：') + d.alt.errors.join(' | ') : ''}）；截圖 pages/${p.slug}/alt/browser-default.png`]) : []), (d.alt && d.alt.contentAppeared) ? _t`→ **用瀏覽器預設身分就讀得到內容（${d.alt.textChars} 字），用爬蟲身分讀不到**：網站依「識別字串」提供了不同的內容。爬蟲身分是 \`Mozilla/5.0 (compatible; site-explorer-claude-plugin)\`。` : (d.scripts > 0 && d.dataRequests === 0 && d.canvases === 0 && d.textChars === 0) ? _t('→ **腳本有載入，卻沒有發出任何資料請求，也沒有建立任何畫面**：程式像是在等某個條件而停住（偵測瀏覽器或 WebGL、使用者互動、特定網址參數），或執行時出錯（見上方「頁面錯誤」）。建議執行 `site-explorer diagnose <網址>`，比較「爬蟲身分」與「瀏覽器預設身分」。') : (p.network && p.network.blockedLike > 0) ? _t`→ **網站對 ${p.network.blockedLike} 個請求回了 403/429**：像是被防護擋下，可試 \`--headed\`。` : d.blockPage ? _t('→ **像是防機器人／驗證頁**：網站把自動化瀏覽器擋在外面。可試 `--headed`（顯示瀏覽器視窗）。') : d.canvases > 0 && d.textChars < 40 ? _t('→ **像是 WebGL／canvas 整頁體驗**：畫面由 3D 繪製，網頁上幾乎沒有文字或版面元素可抽取。請改看 3D 擷取（motion.md、影格）與截圖。') : d.iframes > 0 && d.elements < 40 ? _t('→ 內容可能在 iframe 裡，目前不會深入 iframe。') : d.buttons > 0 && d.textChars < 40 ? _t('→ 可能要先點「進入」或同意 Cookie 才會顯示內容。可試 `--headed` 親手點一下。') : _t('→ 原因不明；可試 `--wait 30000` 或 `--headed`。')]; }), ''] : []),
  ...(site.blockedPages.length ? [_t('> ⚠️ **部分頁面被擋住**（') + site.blockedPages.map((b) => b.reason).join(_t('、')) + _t('）。結果可能不完整；可降低頻率、改用 Playwright MCP 互動，或確認你有權存取。'), ''] : []),
  ...(site.consentAction ? [_t('- 已自動處理 Cookie 橫幅：「') + site.consentAction + _t('」'), ''] : []),
  _t('## 編輯方式'),
  platforms.length ? platforms.map((p) => _t`- **${p.platform}**：${p.howToEdit}${Object.keys(p.adminProbes).length ? _t`（後台探測：${Object.entries(p.adminProbes).map(([k, v]) => `${k}→${v}`).join(', ')}）` : ''}`).join('\n') : _t('- 未偵測到已知平台特徵（可能為自訂程式碼或靜態站）'),
  _t`- Server: ${site.server.server || '?'}；X-Powered-By: ${site.server.poweredBy || '?'}；Generator: ${site.server.generator || '?'}`,
  _t`- 登入/後台相關連結：${site.editing.loginOrAdminLinks.map((l) => l.href).join(', ') || _t('無')}`,
  _t`- 可直接編輯 (contenteditable) 頁面：${site.editing.contenteditablePages.length}`, '',
  _t('## 設計'), _t`- 字型：${list(site.design.fontFamilies)}`, _t`- Web fonts：${site.design.webFonts.join(', ') || '—'}`, _t`- 字級：${list(site.design.fontSizes)}`,
  _t`- 文字色：${list(site.design.textColors)}`, _t`- 背景色：${list(site.design.backgrounds)}`, _t`- 圓角：${list(site.design.radii)}`, _t`- 陰影：${list(site.design.shadows)}`, _t`- 間距：${list(site.design.spacing)}`,
  _t`- CSS 變數：${Object.keys(site.design.cssVars).length} 個（見 site.json）`, '',
  _t('## 頁面'), ...site.pages.map((p) => _t`- [${p.status}] ${p.title || _t('(無標題)')} — ${p.url}（高 ${p.docHeight}px${p.mobileOverflow ? _t('，手機版橫向溢出') : ''}；${p.slug}/）`), '',
  _t('## 網路與內容來源（頁面實際載入了什麼）'), ...pages.slice(0, 3).flatMap((p) => { const n = p.network; if (!n) return []; return [`### ${p.url}`, _t`- 請求 ${n.total} 個（${Object.entries(n.byType).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(_t('、'))}）；第三方網域 ${n.thirdParty.length} 個${n.errorCount ? _t`；**錯誤回應 ${n.errorCount} 個**（403/429 共 ${n.blockedLike} 個）` : ''}${n.failedCount ? _t`；失敗請求 ${n.failedCount} 個` : ''}`, ...(n.assets3d.length ? [_t`- 3D 資源：${n.assets3d.map((a) => _t`${a.url}（${a.status}）`).join(_t('、'))}`] : []), ...(n.media.length ? [_t`- 影音：${n.media.map((a) => a.url).join(_t('、'))}`] : []), ...(n.fonts.length ? [_t`- 字型檔：${n.fonts.slice(0, 6).join(_t('、'))}`] : []), ...(n.apis.length ? [_t`- API／JSON：${n.apis.slice(0, 8).map((a) => _t`${a.url}（${a.status}）`).join(_t('、'))}`] : []), ...(n.errors.length ? [_t`- 失敗的請求：${n.errors.slice(0, 6).map((e) => `${e.status} ${e.url}`).join(_t('、'))}`] : []), ...(n.apiTextSamples.length ? [_t('- API 回應裡的文字（頁面上看不到時，內容常在這裡）：'), ...n.apiTextSamples.slice(0, 12).map((t) => `  - ${t}`)] : []), ...(p.deep ? [_t`- 含 shadow DOM 與 iframe 的可見文字：${p.deep.textChars} 字（主文件 ${p.deep.mainTextChars} 字；iframe ${p.deep.frameCount} 個、shadow root ${p.deep.shadowHosts} 個）`] : []), ...(p.aria && p.aria.lines > 0 ? [_t`- 無障礙樹：${p.aria.lines} 行，標題 ${p.aria.headings}、連結 ${p.aria.links}、按鈕 ${p.aria.buttons}、圖片 ${p.aria.images}、地標 ${p.aria.landmarks}（完整內容見 pages/${p.slug}/aria.yml）`, '```yaml', p.aria.head, '```'] : (p.aria ? [_t('- 無障礙樹：空的（頁面上沒有任何可讀的語意結構）')] : [])), '']; }),
  ...(pages.some((p) => p.states && p.states.length > 1) ? [_t('## 互動狀態（自動點擊／滾動／按鍵後出現的畫面）'), ...pages.filter((p) => p.states && p.states.length > 1).slice(0, 4).flatMap((p) => [`### ${p.url}`, ...p.states.map((s) => _t`- 狀態 ${s.index}：${s.action}${s.label ? _t('「') + s.label + _t('」') : ''}　可見文字 ${s.textChars} 字　截圖 pages/${p.slug}/states/${s.screenshot}${s.text ? _t('\n  - 文字開頭：') + s.text.slice(0, 160) : ''}`), '']), ] : []),
  ...privacyMarkdown(summarizePrivacy(pages.map((p) => p.privacy))),
  ...(pages.some((p) => p.responsive && p.responsive.desktop) ? [_t('## 手機／平板實測（不是猜的：在三種寬度各量一次）'), '', ...pages.filter((p) => p.responsive && p.responsive.desktop).slice(0, 3).flatMap((p) => [`### ${p.url}`, ...responsiveMarkdown(p.responsive), '']),] : []),
  _t('## 排版'), ...(() => {
    // pick the pages that actually HAVE a layout (the first ones you typed may be empty script-built pages); say so for the empty ones
    const rich = (p) => (p.layout.sections || []).length + (p.designer?.blocks || []).length;
    const withLayout = pages.filter((p) => rich(p) > 0).sort((x, y) => rich(y) - rich(x)).slice(0, 4), empty = pages.filter((p) => rich(p) === 0);
    const KIND = { header: _t('頁首'), hero: 'Hero', features: _t('功能格'), pricing: _t('價格'), testimonial: _t('見證'), faq: 'FAQ', form: _t('表單'), logos: _t('Logo 牆'), stats: _t('數據'), gallery: _t('圖庫'), cta: 'CTA', footer: _t('頁尾'), content: _t('內容') };
    return [...withLayout.flatMap((p) => [`### ${p.url}`, _t`- landmarks: ${JSON.stringify(p.layout.landmarks)}；頁面高度 ${p.layout.docHeight}px`, ...((p.designer?.blocks || []).length ? [_t`- 版型流程：${p.designer.blocks.map((bk) => _t`${KIND[bk.kind] || bk.kind}（${bk.h}px）`).join(' → ')}`] : []), ...p.layout.sections.slice(0, 15).map((sc) => `- <${sc.tag}${sc.id ? '#' + sc.id : ''}> ${sc.height}px ${sc.heading ? '— ' + sc.heading : ''}`), '']),
      ...(empty.length ? [_t('### 沒有版面可抽取的頁面'), ...empty.map((p) => `- ${p.url}${p.emptyPage ? _t('（頁面是空的，原因見上方診斷）') : ''}`), ''] : []),
      ...(!withLayout.length ? [_t('（沒有任何頁面抽取到版面）')] : [])];
  })(),
].join('\n');
fs.writeFileSync(path.join(outDir, 'report.md'), BANNER + '\n\n' + sanitizeDoc(md) + '\n');
console.log(_t`\n完成。報告：${path.join(outDir, 'report.md')}`);
