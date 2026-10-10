#!/usr/bin/env node
// Crawl a site with a real browser and capture design, content, layout and editing signals.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const startUrl = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!startUrl) {
  console.error('Usage: crawl.mjs <url> [--max-pages 10] [--depth 2] [--out ./site-report] [--no-screenshots]');
  process.exit(1);
}
const maxPages = Number(opt('max-pages', 10));
const maxDepth = Number(opt('depth', 2));
const shots = !args.includes('--no-screenshots');
const origin = new URL(startUrl).origin;
const host = new URL(startUrl).host.replace(/[^a-z0-9.-]/gi, '_');
const outDir = path.join(opt('out', './site-report'), host);
fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });

const VIEWPORTS = { desktop: [1440, 900], tablet: [768, 1024], mobile: [390, 844] };
const slugOf = (u) => {
  const x = new URL(u);
  return ((x.pathname + x.search).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home').slice(0, 80);
};
const norm = (u) => { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); };

// ---- robots.txt (Disallow for User-agent: *) ----
async function loadRobots() {
  try {
    const r = await fetch(origin + '/robots.txt');
    if (!r.ok) return [];
    const rules = []; let applies = false;
    for (const line of (await r.text()).split('\n')) {
      const [k, ...v] = line.split('#')[0].split(':');
      const key = k.trim().toLowerCase(), val = v.join(':').trim();
      if (key === 'user-agent') applies = val === '*';
      else if (applies && key === 'disallow' && val) rules.push(val);
    }
    return rules;
  } catch { return []; }
}

// ---- runs inside the page ----
function extractInPage() {
  const cs = (el) => getComputedStyle(el);
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

// ---- main ----
const robots = await loadRobots();
const allowed = (u) => !robots.some((r) => new URL(u).pathname.startsWith(r));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)' });
const queue = [[norm(startUrl), 0]], seen = new Set([norm(startUrl)]), pages = [], headers = {};
const t0 = Date.now();

while (queue.length && pages.length < maxPages) {
  const [url, depth] = queue.shift();
  if (!allowed(url)) { console.log('skip (robots):', url); continue; }
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }));
    if (pages.length === 0 && resp) headers.main = resp.headers();
    // trigger lazy content
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const data = await page.evaluate(extractInPage);
    data.status = resp?.status();
    const dir = path.join(outDir, 'pages', slugOf(url)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'page.html'), await page.content());
    if (shots) {
      for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        data.layout[`${name}Overflow`] = overflow;
        await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
      }
    }
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(data, null, 2));
    data.slug = slugOf(url);
    pages.push(data);
    console.log(`[${pages.length}/${maxPages}] ${url}`);
    if (depth < maxDepth) {
      for (const l of data.content.links) {
        try {
          if (!/^https?:/.test(l.href) || new URL(l.href).origin !== origin) continue;
          if (/(wp-admin|wp-login|\/admin|\/login|\/ghost\/|\/administrator|logout|signin|sign-in)/i.test(new URL(l.href).pathname)) continue;
          if (/\.(pdf|zip|jpe?g|png|gif|svg|webp|mp4|css|js)(\?|$)/i.test(l.href)) continue;
          const n = norm(l.href);
          if (!seen.has(n)) { seen.add(n); queue.push([n, depth + 1]); }
        } catch {}
      }
    }
  } catch (e) { console.log('failed:', url, e.message.split('\n')[0]); }
  await page.close();
}
await browser.close();

const fetchStatus = async (u) => { try { return (await fetch(u, { method: 'HEAD', redirect: 'manual' })).status; } catch { return null; } };
const platforms = await detect(pages, headers, fetchStatus);

// aggregate design tokens across pages
const merge = (key, n = 10) => {
  const m = {};
  for (const p of pages) for (const { value, count } of p.design[key]) m[value] = (m[value] || 0) + count;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
};
const site = {
  startUrl, crawledAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), robotsDisallow: robots,
  server: { server: headers.main?.server, poweredBy: headers.main?.['x-powered-by'], generator: pages[0]?.meta.generator },
  editing: { platforms, contenteditablePages: pages.filter((p) => p.editing.contenteditable).map((p) => p.url), loginOrAdminLinks: [...new Map(pages.flatMap((p) => p.editing.editLinks).map((l) => [l.href, l])).values()].slice(0, 15) },
  design: { textColors: merge('textColors'), backgrounds: merge('backgrounds'), fontFamilies: merge('fontFamilies', 6), fontSizes: merge('fontSizes'), radii: merge('radii', 6), shadows: merge('shadows', 5), spacing: merge('spacing'), cssVars: pages[0]?.design.cssVars || {}, webFonts: [...new Set(pages.flatMap((p) => p.design.webFonts))], typography: pages[0]?.design.typography },
  pages: pages.map((p) => ({ slug: p.slug, url: p.url, title: p.title, status: p.status, h1: p.content.headings.filter((h) => h.level === 1).map((h) => h.text), docHeight: p.layout.docHeight, mobileOverflow: p.layout.mobileOverflow })),
};
fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(site, null, 2));

// markdown report
const list = (a) => a.map((x) => `\`${x.value}\` (${x.count})`).join(', ') || '—';
const md = [
  `# 網站探索報告：${startUrl}`, `爬取 ${pages.length} 頁，耗時 ${site.seconds}s，時間 ${site.crawledAt}`, '',
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
fs.writeFileSync(path.join(outDir, 'report.md'), md + '\n');
console.log(`\nDone. Report: ${path.join(outDir, 'report.md')}`);
