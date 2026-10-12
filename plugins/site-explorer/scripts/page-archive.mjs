// Page archive (SingleFile-style): one self-contained HTML file per page that opens offline, with no scripts. Opt-in (--archive) because files are large.
// What is kept: the rendered DOM, all CSS inlined (url() resources and images embedded as data: URIs up to a size budget), the page's own look.
// What is removed: scripts, frames, plugins, inline event handlers and javascript: links. A Content-Security-Policy meta blocks anything active that is left.
// Resources over the budget stay as absolute https links (they will load online but not offline); the report line says how many were embedded.

/** Runs in the browser. Returns { html, embedded, linked, bytes }. */
export async function archiveInPage({ maxBytes, maxOne, pageUrl, when }) {
  let budget = maxBytes, embedded = 0, linked = 0;
  const abs = (u, base) => { try { return new URL(u, base || document.baseURI).href; } catch { return ''; } };
  const cache = new Map();
  const noEnd = (css) => String(css).replace(/<\/(style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'); // CSS text can contain "</style>": it must never close the element it sits in
  const toData = (url) => {
    if (!/^https?:/i.test(url)) return Promise.resolve(null);
    if (cache.has(url)) return cache.get(url);
    const p = (async () => {
      try {
        if (budget <= 0) return null;
        const r = await fetch(url, { credentials: 'omit' }); if (!r.ok) return null;
        const b = await r.blob(); if (b.size > maxOne || b.size > budget) return null;
        budget -= b.size;
        return await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(b); });
      } catch { return null; }
    })();
    cache.set(url, p); return p;
  };
  // styles first (read from the live document, so CSS-in-JS rules and constructed sheets are included)
  const liveLinks = [...document.querySelectorAll('link[rel~="stylesheet"]')];
  const liveStyles = [...document.querySelectorAll('style')];
  const rulesOf = (sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText).join('\n'); } catch { return null; } };
  const inlineUrls = async (css, base) => {
    const urls = new Set(); css = css.replace(/url\(\s*(['"]?)(?!data:|#)([^)'"]+?)\1\s*\)/gi, (m, q, u) => { const a = abs(u.trim(), base); if (a) urls.add(a); return `url(${q}${a || u}${q})`; });
    const map = new Map(); let n = 0;
    for (const u of urls) { if (n++ >= 60) break; const d = await toData(u); if (d) { map.set(u, d); embedded++; } else linked++; }
    return css.replace(/url\(\s*(['"]?)([^)'"]+?)\1\s*\)/gi, (m, q, u) => (map.has(u) ? `url(${map.get(u)})` : m));
  };
  const root = document.documentElement.cloneNode(true);
  const cLinks = [...root.querySelectorAll('link[rel~="stylesheet"]')], cStyles = [...root.querySelectorAll('style')];
  for (let i = 0; i < cLinks.length; i++) {
    const css = liveLinks[i] && liveLinks[i].sheet ? rulesOf(liveLinks[i].sheet) : null;
    if (css == null) { cLinks[i].setAttribute('href', abs(liveLinks[i]?.href || cLinks[i].getAttribute('href'))); linked++; continue; }
    const st = document.createElement('style'); st.textContent = noEnd(await inlineUrls(css, liveLinks[i].href)); cLinks[i].replaceWith(st);
  }
  for (let i = 0; i < cStyles.length; i++) { const css = liveStyles[i] && liveStyles[i].sheet ? rulesOf(liveStyles[i].sheet) : null; cStyles[i].textContent = noEnd(await inlineUrls(css ?? cStyles[i].textContent, document.baseURI)); }
  if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) { const st = document.createElement('style'); st.textContent = noEnd(document.adoptedStyleSheets.map(rulesOf).filter(Boolean).join('\n')); root.querySelector('head')?.appendChild(st); }
  // images
  const liveImgs = [...document.querySelectorAll('img')], cImgs = [...root.querySelectorAll('img')];
  for (let i = 0; i < cImgs.length && i < 200; i++) {
    const src = liveImgs[i]?.currentSrc || liveImgs[i]?.src || ''; if (!src || src.startsWith('data:')) continue;
    const d = await toData(abs(src)); cImgs[i].removeAttribute('srcset'); cImgs[i].removeAttribute('sizes'); cImgs[i].removeAttribute('loading');
    if (d) { cImgs[i].setAttribute('src', d); embedded++; } else { cImgs[i].setAttribute('src', abs(src)); linked++; }
  }
  root.querySelectorAll('source[srcset]').forEach((s) => s.remove());
  // inline style="background-image:url(...)" is kept as an absolute link
  root.querySelectorAll('[style*="url("]').forEach((e) => { e.setAttribute('style', e.getAttribute('style').replace(/url\(\s*(['"]?)(?!data:|#)([^)'"]+?)\1\s*\)/gi, (m, q, u) => `url(${q}${abs(u.trim())}${q})`)); });
  // links become absolute so they still point somewhere; everything active is removed
  const js = (v) => /^[\s\u0000-\u001f]*j[\s\u0000-\u001f]*a[\s\u0000-\u001f]*v[\s\u0000-\u001f]*a[\s\u0000-\u001f]*s[\s\u0000-\u001f]*c[\s\u0000-\u001f]*r[\s\u0000-\u001f]*i[\s\u0000-\u001f]*p[\s\u0000-\u001f]*t[\s\u0000-\u001f]*:/i.test(String(v));
  root.querySelectorAll('a[href]').forEach((a) => { const v = a.getAttribute('href'); if (js(v)) a.removeAttribute('href'); else { const x = abs(v); if (x && /^https?:|^mailto:|^tel:/i.test(x)) a.setAttribute('href', x); else a.removeAttribute('href'); } });
  root.querySelectorAll('form').forEach((f) => { f.removeAttribute('action'); });
  root.querySelectorAll('[formaction]').forEach((e) => e.removeAttribute('formaction'));
  root.querySelectorAll('script,noscript,iframe,frame,frameset,object,embed,applet,base,meta[http-equiv],link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"],link[rel~="preconnect"],link[rel~="dns-prefetch"]').forEach((e) => e.remove());
  root.querySelectorAll('*').forEach((e) => { for (const a of [...e.attributes]) if (/^on/i.test(a.name) || (/^(src|action|formaction|xlink:href|data|href)$/i.test(a.name) && js(a.value))) e.removeAttribute(a.name); });
  const head = root.querySelector('head') || root.insertBefore(document.createElement('head'), root.firstChild);
  const meta = (attrs) => { const m = document.createElement('meta'); for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v); return m; };
  head.prepend(meta({ 'http-equiv': 'Content-Security-Policy', content: "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:; media-src data: https: http:" }));
  head.prepend(meta({ charset: 'utf-8' }));
  const note = String(pageUrl).replace(/--+>?/g, '-').replace(/[\r\n]/g, ' ').slice(0, 300);
  const html = `<!doctype html>\n<!-- Archived by site-explorer from ${note} on ${when}. Scripts removed. -->\n` + root.outerHTML;
  return { html, embedded, linked, bytes: html.length };
}
