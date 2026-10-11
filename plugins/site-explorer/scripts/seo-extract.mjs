// Runs inside the page (page.evaluate). Self-contained. Collects on-page SEO, structure, social, structured data,
// accessibility basics and lab performance signals.

export async function extractSeoInPage() {
  // SVG elements have no innerText: without this one inline <svg><a>/<g role=button> makes the whole extraction throw
  if (typeof SVGElement !== 'undefined' && !('innerText' in SVGElement.prototype)) Object.defineProperty(SVGElement.prototype, 'innerText', { get() { return this.textContent || ''; }, configurable: true });
  const meta = (n) => { const e = document.querySelector(`meta[name="${n}" i],meta[property="${n}" i]`); return e ? (e.content || '').trim() : null; };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
  const strip = (h) => h.replace(/^www\./, '');
  const myHost = strip(location.hostname);
  const visibleText = (document.body ? document.body.innerText : '') || '';
  const latin = (visibleText.match(/[A-Za-z0-9À-ɏ']+/g) || []).length;
  const cjk = (visibleText.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  const wordsEq = latin + Math.round(cjk / 1.8);

  // headings
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ level: +h.tagName[1], text: (h.innerText || '').trim().slice(0, 120), hidden: !h.offsetParent && getComputedStyle(h).position !== 'fixed' })).filter((h) => h.text || true);
  let skipped = 0, prev = 0; for (const h of headings) { if (prev && h.level > prev + 1) skipped++; prev = h.level; }
  const h1s = headings.filter((h) => h.level === 1);

  // links
  const GENERIC = /^(click here|read more|more|here|learn more|details|link|點擊這裡|更多|了解更多|詳情|閱讀更多)$/i;
  const links = { total: 0, internal: 0, external: 0, nofollow: 0, ugcOrSponsored: 0, empty: 0, generic: 0, jsOrHash: 0, mailtoTel: 0, externalNoRel: 0, sampleEmpty: [], sampleGeneric: [] };
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href') || ''; links.total++;
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    if (/^(javascript:|#)/i.test(raw)) { links.jsOrHash++; continue; }
    if (/^(mailto:|tel:)/i.test(raw)) { links.mailtoTel++; continue; }
    let u; try { u = new URL(raw, location.href); } catch { continue; }
    const internal = strip(u.hostname) === myHost;
    internal ? links.internal++ : links.external++;
    if (/nofollow/.test(rel)) links.nofollow++;
    if (/ugc|sponsored/.test(rel)) links.ugcOrSponsored++;
    if (!internal && u.target !== '' && !/noopener|noreferrer/.test(rel) && a.target === '_blank') links.externalNoRel++;
    const label = (a.innerText || a.getAttribute('aria-label') || a.querySelector('img')?.alt || a.title || '').trim();
    if (!label) { links.empty++; if (links.sampleEmpty.length < 5) links.sampleEmpty.push(u.href); }
    else if (GENERIC.test(label)) { links.generic++; if (links.sampleGeneric.length < 5) links.sampleGeneric.push(label + ' → ' + u.href); }
  }

  // images
  const imgs = [...document.images];
  const images = { total: imgs.length, missingAlt: 0, emptyAlt: 0, lazy: 0, oversized: 0, legacyFormat: 0, broken: 0, sampleBroken: [], sampleMissingAlt: [], sampleOversized: [] };
  for (const i of imgs) {
    if (!i.hasAttribute('alt')) { images.missingAlt++; if (images.sampleMissingAlt.length < 5) images.sampleMissingAlt.push(i.currentSrc || i.src); } else if (i.alt.trim() === '') images.emptyAlt++;
    if (i.loading === 'lazy') images.lazy++;
    if (i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src) && !/^data:/.test(i.currentSrc || i.src)) { images.broken++; if (images.sampleBroken.length < 5) images.sampleBroken.push(i.currentSrc || i.src); }
    if (i.clientWidth > 0 && i.naturalWidth > i.clientWidth * 2 && i.naturalWidth > 600) { images.oversized++; if (images.sampleOversized.length < 5) images.sampleOversized.push(`${(i.currentSrc || i.src).split('/').pop().slice(0, 50)} ${i.naturalWidth}px shown at ${i.clientWidth}px`); }
    if (/\.(jpe?g|png|gif|bmp)(\?|$)/i.test(i.currentSrc || i.src)) images.legacyFormat++;
  }

  // structured data
  const jsonld = [];
  const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const bare = (t) => String(t).replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, ''); // "https://schema.org/Product" and "schema:Product" are the type Product
  const flat = (x, out, depth) => { // top-level object / array / @graph (array OR single object), nested arbitrarily
    if (depth > 4 || out.length > 200 || x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) flat(y, out, depth + 1); return; }
    if (x['@graph'] !== undefined) { const ctx = x['@context']; const g = x['@graph']; for (const y of [].concat(g)) if (y && typeof y === 'object') flat(ctx && !y['@context'] ? { ...y, '@context': ctx } : y, out, depth + 1); const rest = Object.keys(x).filter((k) => k !== '@graph' && k !== '@context'); if (rest.some((k) => k === '@type')) out.push(Object.fromEntries(Object.entries(x).filter(([k]) => k !== '@graph'))); return; }
    out.push(x);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent); const nodes = []; flat(data, nodes, 0);
      if (!nodes.length) continue; // `null`, `[]`, a bare string: valid JSON, but not structured data
      for (const n of nodes) { const t = n && n['@type']; const ctx = (n && n['@context']) || null; jsonld.push({ types: [].concat(t || []).map(bare).filter((x) => /^[\w.-]{1,60}$/.test(x)), props: Object.keys(n || {}).filter((k) => !k.startsWith('@') && filled(n[k])).slice(0, 60), context: ctx ? (typeof ctx === 'string' ? ctx : JSON.stringify(ctx)).slice(0, 80) : null, hasId: !!(n && n['@id']), name: n && (n.name || n.headline || '') ? String(n.name || n.headline).slice(0, 60) : '' }); }
    } catch (e) { jsonld.push({ error: String(e.message).slice(0, 80) }); }
  }
  const microdata = document.querySelectorAll('[itemscope]').length;

  // head / social / international
  const canonicalEl = document.querySelector('link[rel~="canonical" i]');
  const hreflang = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({ lang: l.hreflang, href: abs(l.href) }));
  const social = { ogTitle: meta('og:title'), ogDescription: meta('og:description'), ogImage: meta('og:image'), ogUrl: meta('og:url'), ogType: meta('og:type'), twitterCard: meta('twitter:card'), twitterImage: meta('twitter:image') };
  const fav = [...document.querySelectorAll('link[rel~="icon" i],link[rel="apple-touch-icon"]')].map((l) => abs(l.href));

  // forms & accessibility basics
  let inputsNoLabel = 0, buttonsNoName = 0;
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), textarea, select')) {
    const has = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (!has) inputsNoLabel++;
  }
  for (const b of document.querySelectorAll('button, [role=button]')) if (!(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.title && !b.querySelector('img[alt]')) buttonsNoName++;

  // lab performance
  const nav = performance.getEntriesByType('navigation')[0];
  const lcp = await new Promise((res) => { let v = null; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} setTimeout(() => res(v), 120); });
  const cls = await new Promise((res) => { let s = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) s += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} setTimeout(() => res(s), 120); });
  const fcp = (performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint') || {}).startTime ?? null;
  const res = performance.getEntriesByType('resource');
  const size = (e) => e.transferSize || e.encodedBodySize || 0;
  const byType = {}; let total = 0; const thirdParty = new Set();
  for (const e of res) { const t = e.initiatorType || 'other'; byType[t] = byType[t] || { count: 0, bytes: 0 }; byType[t].count++; byType[t].bytes += size(e); total += size(e); try { const h = new URL(e.name).hostname; if (strip(h) !== myHost) thirdParty.add(h); } catch {} }
  const largest = [...res].sort((a, b) => size(b) - size(a)).slice(0, 5).map((e) => ({ url: e.name.split(/[?#]/)[0].slice(0, 120), bytes: size(e), ms: Math.round(e.duration) }));
  const blockingScripts = [...document.querySelectorAll('head script[src]')].filter((s) => !s.async && !s.defer && s.type !== 'module').length;
  const blockingCss = document.querySelectorAll('head link[rel=stylesheet]').length;
  const perf = {
    ttfbMs: nav ? Math.round(nav.responseStart - nav.startTime) : null, domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    fcpMs: fcp != null ? Math.round(fcp) : null, lcpMs: lcp ? Math.round(lcp.startTime) : null, lcpElement: lcp && lcp.element ? lcp.element.tagName.toLowerCase() + (lcp.url ? ' ' + lcp.url.split('/').pop().slice(0, 40) : '') : null, cls: +cls.toFixed(3),
    htmlBytes: nav ? (nav.encodedBodySize || nav.decodedBodySize || 0) : 0, requests: res.length + 1, totalBytes: total + (nav ? size(nav) : 0), byType, largest, thirdPartyHosts: [...thirdParty].slice(0, 12), thirdPartyCount: thirdParty.size, renderBlockingScripts: blockingScripts, stylesheetsInHead: blockingCss,
    domNodes: document.getElementsByTagName('*').length,
  };

  return {
    title: document.title || '', description: meta('description'), robotsMeta: meta('robots'), googlebotMeta: meta('googlebot'),
    canonical: canonicalEl ? abs(canonicalEl.getAttribute('href')) : null, lang: document.documentElement.lang || null, charset: document.characterSet, hasCharsetMeta: !!document.querySelector('meta[charset],meta[http-equiv="content-type" i]'),
    viewport: meta('viewport'), themeColor: meta('theme-color'), favicons: fav, manifest: !!document.querySelector('link[rel=manifest]'),
    hreflang, social, headings: headings.slice(0, 80), h1Count: h1s.length, h1: h1s.map((h) => h.text), headingSkips: skipped,
    words: wordsEq, latinWords: latin, cjkChars: cjk, textBytes: visibleText.length, htmlLength: document.documentElement.outerHTML.length,
    landmarks: { main: document.querySelectorAll('main,[role=main]').length, nav: document.querySelectorAll('nav,[role=navigation]').length, header: document.querySelectorAll('header').length, footer: document.querySelectorAll('footer').length },
    links, images, structuredData: { jsonld, microdata }, forms: { inputsNoLabel, buttonsNoName }, perf,
    noscript: document.querySelectorAll('noscript').length, iframes: document.querySelectorAll('iframe').length,
  };
}

/** Run at a mobile viewport. */
export function extractMobileInPage() {
  let smallText = 0, small = 0, checked = 0;
  for (const el of [...document.querySelectorAll('p,li,span,a,td,label,small')].slice(0, 500)) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue; checked++;
    if (parseFloat(getComputedStyle(el).fontSize) < 12) smallText++;
  }
  let tapChecked = 0;
  for (const el of [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button]')].slice(0, 300)) {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue; tapChecked++;
    if (Math.min(r.width, r.height) < 24) small++;
  }
  return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, smallTextCount: smallText, textChecked: checked, smallTapTargets: small, tapChecked, hasViewportMeta: !!document.querySelector('meta[name=viewport]') };
}
