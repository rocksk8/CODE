// A small, conservative HTML validity checker for the raw HTML a server sends (not the browser-repaired DOM, which can no longer be wrong).
// It reports only things that are certainly wrong or likely to bite: unclosed / stray / mis-nested tags, duplicate ids, duplicate attributes, block inside <p>,
// nested links or buttons, list / table children in the wrong parent, deprecated tags, missing doctype, late charset. It is not the W3C validator: it does not
// know every content model. Linear time: one pass over the text, no regex with unbounded gaps.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option', 'optgroup', 'colgroup', 'caption', 'rb', 'rt', 'rp', 'head', 'body', 'html']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const DEPRECATED = new Set(['font', 'center', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset', 'acronym', 'applet', 'basefont', 'dir', 'isindex', 'noframes']);
const INLINE_ONLY_PARENT = { li: new Set(['ul', 'ol', 'menu']), tr: new Set(['table', 'thead', 'tbody', 'tfoot']), td: new Set(['tr']), th: new Set(['tr']) };

/** Index of the ">" that ends the tag starting before position `from`, ignoring ">" inside quoted attribute values; -1 when there is none. Linear, capped at 8000 chars. */
function tagEnd(src, from) {
  const limit = Math.min(src.length, from + 8000); let q = null;
  for (let k = from; k < limit; k++) {
    const c = src[k];
    if (q) { if (c === q) q = null; continue; }
    if ((c === '"' || c === "'") && /[=\s]/.test(src[k - 1] || '') && /=\s*$/.test(src.slice(Math.max(from, k - 8), k))) { q = c; continue; }
    if (c === '>') return k;
  }
  const g = src.indexOf('>', from); return g >= 0 && g < limit ? g : (g >= 0 ? g : -1);
}

export function checkHtml(html, { maxTags = 80000 } = {}) {
  const found = new Map(); // id → { severity, message, count, examples }
  const report = (id, severity, message, example) => { const f = found.get(id) || { id, severity, message, count: 0, examples: [] }; f.count++; if (example && f.examples.length < 4 && !f.examples.includes(example)) f.examples.push(example); found.set(id, f); };
  const src = String(html || '').slice(0, 2_000_000), lower = src.toLowerCase();
  const hasDoctype = (() => { let k = 0; for (let n = 0; n < 50; n++) { while (k < src.length && /\s/.test(src[k])) k++; if (src.startsWith('<!--', k)) { const e = src.indexOf('-->', k + 4); if (e < 0) return false; k = e + 3; continue; } break; } return /^<!doctype\s+html/i.test(src.slice(k, k + 30)); })();
  if (!hasDoctype) report('no-doctype', 'low', 'missing <!doctype html> (browsers fall back to quirks mode)');
  const stack = []; const ids = new Map(); let i = 0, tags = 0, charsetAt = -1, headEnd = -1;
  let pendingP = false; const cnt = new Map(); const open = (n) => (cnt.get(n) || 0) > 0;
  const push = (n) => { stack.push({ name: n }); cnt.set(n, (cnt.get(n) || 0) + 1); };
  const pop = () => { const s = stack.pop(); if (s) cnt.set(s.name, cnt.get(s.name) - 1); return s; };
  while (i < src.length && tags < maxTags) {
    const lt = src.indexOf('<', i); if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); if (e < 0) { report('unclosed-comment', 'medium', 'a comment is never closed'); break; } i = e + 3; continue; }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]{0,30})/.exec(src.slice(lt, lt + 40));
    if (!m) { i = lt + 1; continue; }
    const closing = m[1] === '/', name = m[2].toLowerCase(); tags++;
    const gt = tagEnd(src, lt + m[0].length); if (gt < 0) { report('unclosed-tag-bracket', 'medium', 'a tag is never finished (missing ">")', `<${name}`); break; }
    const attrs = src.slice(lt + m[0].length, Math.min(gt, lt + m[0].length + 4000)); i = gt + 1;
    if (closing) {
      let k = stack.length - 1; if (!open(name)) k = -1; else while (k >= 0 && stack[k].name !== name) k--;
      if (k < 0) { if (name === 'p' && pendingP) { report('block-in-p', 'low', 'a block element starts inside <p> (the browser closes the paragraph, so the markup is not what was written)', '</p> after a block'); pendingP = false; continue; } if (name !== 'p' && name !== 'br') report('stray-end-tag', 'low', 'closing tags without a matching opening tag', `</${name}>`); continue; }
      const skipped = stack.slice(k + 1).filter((s) => !OPTIONAL_END.has(s.name));
      for (const s of skipped) report('unclosed', 'medium', 'elements that are opened but never closed (or closed in the wrong order)', `<${s.name}>`);
      while (stack.length > k) pop(); continue;
    }
    if (DEPRECATED.has(name)) report('deprecated-tag', 'low', 'deprecated HTML elements', `<${name}>`);
    // attributes: duplicates and ids
    const seen = new Set(); const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g; let a;
    while ((a = re.exec(attrs)) && seen.size < 60) {
      const an = a[1].toLowerCase();
      if (seen.has(an)) report('duplicate-attribute', 'low', 'the same attribute is given twice on one element', `<${name} ${an}>`); seen.add(an);
      if (an === 'id') { const v = a[2] ?? a[3] ?? a[4] ?? ''; if (v) ids.set(v, (ids.get(v) || 0) + 1); }
      if (name === 'meta' && (an === 'charset' || (an === 'http-equiv' && /content-type/i.test(a[2] ?? a[3] ?? a[4] ?? '')))) charsetAt = lt;
    }
    if (name === 'meta' && /\bcharset\b/i.test(attrs)) charsetAt = lt;
    // structure
    let top = stack[stack.length - 1];
    if (CLOSES_P.has(name) && top && top.name === 'p' && name !== 'p') { pop(); pendingP = true; } // valid: the </p> may be omitted; only an explicit </p> afterwards is a mistake
    if (['li', 'dt', 'dd', 'td', 'th', 'tr', 'option', 'optgroup'].includes(name) && stack.length && stack[stack.length - 1].name === 'p') pop();
    if (name === 'tr' && stack.length && stack[stack.length - 1].name === 'colgroup') pop();
    top = stack[stack.length - 1];
    if (name === 'a' && open('a')) report('nested-interactive', 'medium', 'links or buttons nested inside another link or button', '<a> in <a>');
    if (name === 'button' && (open('button') || open('a'))) report('nested-interactive', 'medium', 'links or buttons nested inside another link or button', open('a') ? '<button> in <a>' : '<button> in <button>');
    if (name === 'a' && open('button')) report('nested-interactive', 'medium', 'links or buttons nested inside another link or button', '<a> in <button>');
    const need = INLINE_ONLY_PARENT[name]; if (need && top && !open('template') && !open('svg') && !open('math') && !need.has(top.name) && !(name === 'li' && top.name === 'li') && !(name !== 'li' && ['tr', 'td', 'th'].includes(top.name))) report('wrong-parent', 'low', 'list items, table rows or cells placed in the wrong parent', `<${name}> in <${top.name}>`);
    if (name === 'li' && top && top.name === 'li') pop(); // an implied </li>
    else if ((name === 'tr' || name === 'td' || name === 'th') && top && ['tr', 'td', 'th'].includes(top.name)) { while (stack.length && ['td', 'th'].includes(stack[stack.length - 1].name) && name !== 'td' && name !== 'th') pop(); if (name === 'tr' && stack.length && stack[stack.length - 1].name === 'tr') pop(); if ((name === 'td' || name === 'th') && stack.length && ['td', 'th'].includes(stack[stack.length - 1].name)) pop(); }
    else if (name === 'p' && top && top.name === 'p') pop();
    if (name === 'head') headEnd = -2;
    if (VOID.has(name) || (/\/\s*$/.test(attrs.trimEnd()) && (open('svg') || open('math') || name === 'svg' || name === 'math') && !RAW.has(name))) continue;
    if (RAW.has(name)) { const e = lower.indexOf('</' + name, gt + 1); if (e < 0) { report('unclosed', 'medium', 'elements that are opened but never closed (or closed in the wrong order)', `<${name}>`); break; } const ge = src.indexOf('>', e); i = ge < 0 ? src.length : ge + 1; continue; }
    push(name);
  }
  for (const s of stack) if (!OPTIONAL_END.has(s.name)) report('unclosed', 'medium', 'elements that are opened but never closed (or closed in the wrong order)', `<${s.name}>`);
  for (const [id, n] of ids) if (n > 1) report('duplicate-id', 'medium', 'ids used more than once (anchors, labels and scripts then hit the wrong element)', `#${id.slice(0, 40)} ×${n}`);
  if (charsetAt > 1024) report('late-charset', 'low', 'the character set declaration is after the first 1024 bytes (browsers may guess wrongly)');
  return [...found.values()].map((f) => ({ ...f, examples: f.examples.map((e) => e.slice(0, 60)) })).sort((a, b) => b.count - a.count);
}
