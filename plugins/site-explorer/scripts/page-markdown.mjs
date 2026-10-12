// Per-page Markdown of what a visitor reads, in document order (headings, paragraphs, lists, tables, quotes, code, image alt text).
//   extractMarkdownInPage  runs INSIDE the browser page (no imports, no closures over module code)
//   renderPageMarkdown     builds the file: a small front matter (url, title, language, description, word count) and the body
// Everything comes from a third-party site, so the output is data: links are written as `text (url)` and images as `[image: alt] (url)` —
// never as Markdown links or images, so the file cannot render a clickable or tracking element; the writer also runs it through sanitizeDoc.

/** Browser-side: returns { md, words, truncated }. Reads <main>/<article>/[role=main] if the page has one, else <body>; skips script/style/hidden/aria-hidden/nav/header/footer/aside. */
export function extractMarkdownInPage() {
  const MAX = 150000, SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'SELECT', 'OPTION', 'BUTTON', 'INPUT', 'TEXTAREA', 'LABEL']);
  const root = document.querySelector('main, [role=main]') || document.querySelector('article') || document.body;
  if (!root) return { md: '', words: 0, truncated: false };
  const insideMain = root !== document.body;
  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return ''; } };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getAttribute('aria-hidden') !== 'true' && !el.hidden; };
  const isChrome = (el) => !insideMain && ['NAV', 'HEADER', 'FOOTER', 'ASIDE'].includes(el.tagName);
  const esc = (s) => s.replace(/([\\`*_{}\[\]<>#|])/g, '\\$1');
  let out = '', truncated = false;
  const push = (s) => { if (out.length >= MAX) { truncated = true; return; } out += s; };
  const inline = (node) => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += esc(c.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (c.nodeType !== 1 || SKIP.has(c.tagName.toUpperCase()) || !shown(c)) continue;
      const t = c.tagName;
      if (t === 'BR') { s += '  \n'; continue; }
      if (t === 'IMG') { const alt = clean(c.alt); if (alt) s += `[image: ${esc(alt)}]`; continue; }
      const inner = inline(c);
      if (t === 'A') { const href = abs(c.getAttribute('href') || ''); s += /^https?:/i.test(href) && clean(inner) ? `${inner} (${href})` : inner; }
      else if (t === 'STRONG' || t === 'B') s += clean(inner) ? `**${inner.trim()}**` : '';
      else if (t === 'EM' || t === 'I') s += clean(inner) ? `*${inner.trim()}*` : '';
      else if (t === 'CODE') s += clean(inner) ? '`' + inner.replace(/`/g, '') + '`' : '';
      else s += inner;
    }
    return s;
  };
  const block = (el, depth, listPrefix) => {
    if (out.length >= MAX) { truncated = true; return; }
    for (const c of el.children) {
      const t = c.tagName;
      if (SKIP.has(t.toUpperCase()) || !shown(c) || isChrome(c)) continue;
      if (/^H[1-6]$/.test(t)) { const x = clean(inline(c)); if (x) push(`\n${'#'.repeat(Number(t[1]))} ${x}\n`); }
      else if (t === 'P') { const x = clean(inline(c)); if (x) push(`\n${x}\n`); }
      else if (t === 'UL' || t === 'OL') {
        let n = 0; if (depth === 0) push('\n');
        for (const li of c.children) {
          if (li.tagName !== 'LI' || !shown(li)) continue;
          n++; const mark = t === 'OL' ? `${n}. ` : '- ';
          const own = document.createElement('div'); // text of the item without its nested lists
          for (const k of li.childNodes) { if (k.nodeType === 1 && /^(UL|OL)$/.test(k.tagName)) continue; own.appendChild(k.cloneNode(true)); }
          const x = clean(inline(own)); if (x) push(`${'  '.repeat(depth)}${mark}${x}\n`);
          for (const k of li.children) if (/^(UL|OL)$/.test(k.tagName)) block({ children: [k] }, depth + 1);
        }
      }
      else if (t === 'BLOCKQUOTE') { const x = clean(inline(c)); if (x) push(`\n> ${x}\n`); }
      else if (t === 'PRE') { const x = (c.innerText || '').replace(/\r/g, '').trimEnd().slice(0, 4000); if (x) push('\n```\n' + x.replace(/```/g, "'''") + '\n```\n'); }
      else if (t === 'HR') push('\n---\n');
      else if (t === 'TABLE') {
        const rows = [...c.querySelectorAll('tr')].filter(shown).slice(0, 40).map((tr) => [...tr.children].filter((k) => /^T[HD]$/.test(k.tagName)).slice(0, 12).map((k) => clean(inline(k)).replace(/\\?\|/g, '/')));
        if (rows.length && rows[0].length) { push('\n'); rows.forEach((r, i) => { push(`| ${r.join(' | ')} |\n`); if (i === 0) push(`| ${r.map(() => '---').join(' | ')} |\n`); }); }
      }
      else if (t === 'IMG') { const alt = clean(c.alt); if (alt) push(`\n[image: ${esc(alt)}]\n`); }
      else if (t === 'FIGURE' || t === 'DIV' || t === 'SECTION' || t === 'ARTICLE' || t === 'MAIN' || t === 'DETAILS' || t === 'DL' || t === 'FIGCAPTION' || t === 'SPAN' || t === 'A' || t === 'NAV' || t === 'HEADER' || t === 'FOOTER' || t === 'ASIDE' || t === 'DD' || t === 'DT' || t === 'FORM') {
        const kids = [...c.children]; const hasBlock = kids.some((k) => /^(H[1-6]|P|UL|OL|BLOCKQUOTE|PRE|TABLE|DIV|SECTION|ARTICLE|FIGURE|MAIN|DETAILS|DL|HR|NAV|HEADER|FOOTER|ASIDE|FORM)$/.test(k.tagName));
        if (hasBlock) block(c, depth); else { const x = clean(inline(c)); if (x) push(`\n${x}\n`); }
      }
    }
  };
  block(root, 0);
  const md = out.replace(/\n{3,}/g, '\n\n').trim();
  const words = (md.replace(/[\[\]()*`#>|\\-]/g, ' ').match(/[A-Za-z0-9À-ɏ']+|[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  return { md, words, truncated };
}

import { looksInjected } from './untrusted.mjs';
// instruction-like site text never goes into the front matter (a later line filter would break the YAML); the body is sanitised by the writer
const ONE_LINE = (s, n = 200) => { const t = String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").slice(0, n); return looksInjected(t) ? '[removed: instruction-like text]' : t; };

/** Front matter (JSON-safe scalars on one line each) + body. `data` is the page.json object; `r` is the extractMarkdownInPage result. */
export function renderPageMarkdown(data, r, banner = '') {
  const f = ['---', `url: "${ONE_LINE(data.url, 500)}"`, `title: "${ONE_LINE(data.title)}"`];
  if (data.lang) f.push(`language: "${ONE_LINE(data.lang, 20)}"`);
  if (data.meta?.description) f.push(`description: "${ONE_LINE(data.meta.description, 300)}"`);
  f.push(`words: ${Number(r.words) || 0}`, `truncated: ${!!r.truncated}`, '---', '');
  return f.join('\n') + (banner ? banner + '\n\n' : '') + (r.md ? r.md + '\n' : '_(no readable text found on this page)_\n'); // front matter stays first; the safety notice follows it
}
