// Runs inside the page (page.evaluate). Must be self-contained: no imports, no outer closures.
// Collects what a designer needs: inspectable elements, page blocks with pattern kinds,
// real-background contrast issues, motion tokens, layout grid, font sources, inline icons.
export function extractDesignerInPage() {
  const cs = (e) => getComputedStyle(e);
  const vw = innerWidth, vh = innerHeight;
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = cs(e); return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0; };
  const parseC = (c) => { const m = String(c).match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/); if (!m) return null; const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; return [+m[1], +m[2], +m[3], a]; };
  const hex = (c) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hasBgImage = (el) => { for (let e = el; e; e = e.parentElement) if (cs(e).backgroundImage !== 'none') return true; return false; };
  const effBg = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parseC(cs(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; } }
    let base = [255, 255, 255];
    for (const c of layers.reverse()) base = base.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
    return base;
  };
  const splitTop = (s) => String(s).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
  const all = [...document.querySelectorAll('body *')].slice(0, 3500);

  // ---------- inspectable elements (document coordinates) ----------
  const picked = [], seen = new Set();
  const add = (el, role) => {
    if (picked.length >= 240 || seen.has(el) || !visible(el)) return;
    const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return;
    seen.add(el);
    const s = cs(el), fg = parseC(s.color) || [0, 0, 0, 1];
    picked.push({
      role, tag: el.tagName.toLowerCase(), text: (el.innerText || el.alt || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height),
      font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: s.fontSize, weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing,
      color: hex(fg), bg: hex(effBg(el)), pad: s.padding, margin: s.margin, radius: s.borderRadius,
      shadow: s.boxShadow !== 'none' ? s.boxShadow : undefined,
      border: parseFloat(s.borderTopWidth) ? `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}` : undefined,
      display: s.display, gap: s.gap !== 'normal' ? s.gap : undefined,
    });
  };
  document.querySelectorAll('header, nav, main > *, section, footer').forEach((e) => add(e, 'block'));
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((e) => add(e, 'heading'));
  document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button], input[type=submit]').forEach((e) => add(e, 'button'));
  [...document.querySelectorAll('img, video, canvas')].slice(0, 30).forEach((e) => add(e, 'media'));
  [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].slice(0, 12).forEach((e) => add(e, 'input'));
  [...document.querySelectorAll('nav a, header a')].slice(0, 14).forEach((e) => add(e, 'link'));
  [...document.querySelectorAll('p, li, blockquote')].filter((e) => (e.innerText || '').trim().length > 20).slice(0, 40).forEach((e) => add(e, 'text'));

  // ---------- page blocks + pattern classification ----------
  const kidsOf = (root) => [...root.children].filter((k) => visible(k) && k.getBoundingClientRect().height > 30 && !/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(k.tagName));
  let root = document.querySelector('main') || document.body;
  for (let i = 0; i < 8; i++) { const k = kidsOf(root); if (k.length === 1) root = k[0]; else break; }
  let blocksEls = kidsOf(root);
  const extras = [...document.querySelectorAll('header, footer')].filter((e) => !root.contains(e) && !e.parentElement.closest('header,footer,section,article,main,aside') && visible(e));
  blocksEls = [...extras, ...blocksEls].filter((e, i, a) => a.indexOf(e) === i).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  blocksEls = blocksEls.filter((e) => !blocksEls.some((o) => o !== e && o.contains(e)));
  // "cards" = repeated siblings that look like components, not bare text (paragraphs, links, table rows)
  const NOT_CARD = /^(P|SPAN|A|BR|HR|INPUT|BUTTON|LABEL|TR|TD|TH|H[1-6]|STRONG|EM|B|I|SMALL|IMG|OPTION|DT|DD)$/;
  const cardLike = (c) => !NOT_CARD.test(c.tagName) && visible(c) && c.getBoundingClientRect().height >= 60 && !!(c.querySelector('h1,h2,h3,h4,h5,h6,img,svg,picture,video') || c.children.length >= 2);
  const repeatOf = (el) => {
    let best = 1;
    for (const p of [el, ...[...el.querySelectorAll('*')].slice(0, 250)]) {
      if (p.children.length < 3 || /^(UL|OL|TABLE|TBODY|SELECT|NAV)$/.test(p.tagName) && !p.querySelector('h1,h2,h3,h4,h5,h6,img')) continue;
      const m = {};
      for (const c of p.children) { if (!cardLike(c)) continue; const sig = c.tagName + '.' + String(c.className && c.className.baseVal === undefined ? c.className : '').split(/\s+/)[0]; m[sig] = (m[sig] || 0) + 1; }
      best = Math.max(best, ...Object.values(m), 1);
    }
    return best;
  };
  const classify = (el, idx, total) => {
    const r = el.getBoundingClientRect(), s = cs(el), t = (el.innerText || '').trim();
    const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + el.id;
    const q = (sel) => el.querySelectorAll(sel);
    const h = q('h1,h2,h3').length, btn = q('button, a[class*=btn], a[class*=button], [role=button]').length;
    const media = q('img, picture, video, canvas').length, links = q('a').length, rep = repeatOf(el);
    let kind = 'content';
    if (el.tagName === 'HEADER' || (idx === 0 && links >= 3 && r.height < 160) || ((s.position === 'fixed' || s.position === 'sticky') && r.top < 5 && r.height < 160)) kind = 'header';
    else if (el.tagName === 'FOOTER' || (idx === total - 1 && links >= 6 && r.height < 700)) kind = 'footer';
    else if (idx <= 2 && (q('h1').length || (h >= 1 && r.height > vh * 0.5)) && (btn || media || r.height > vh * 0.6)) kind = 'hero';
    else if (/pricing|plans?\b|price/i.test(cls) || (/(\$|€|£|NT\$|US\$)\s?\d/.test(t) && rep >= 2 && (/\/\s?(mo|month|yr|year)|per (month|year)|billed|每月|月付|年付/i.test(t) || (t.match(/\b(starter|basic|pro|team|business|enterprise|free|studio|premium|plus)\b/gi) || []).length >= 2))) kind = 'pricing';
    else if (q('blockquote').length || /testimonial|review|quote|customer-stor/i.test(cls) || (rep >= 2 && /[“”"]/.test(t) && media)) kind = 'testimonial';
    else if (q('details, summary').length >= 2 || /faq|accordion/i.test(cls)) kind = 'faq';
    else if (q('form').length && q('input, textarea, select').length >= 2) kind = 'form';
    else if (media >= 5 && t.length < 120) kind = 'logos';
    else if ((t.match(/\b\d[\d,.]*\s?(%|\+|k|m|x)?/gi) || []).length >= 3 && t.length < 260 && rep >= 3) kind = 'stats';
    else if (media >= 4 && t.length < 200) kind = 'gallery';
    else if (rep >= 3) kind = 'features';
    else if (btn >= 1 && t.length < 260 && r.height < 520 && h <= 1 && idx >= total - 3) kind = 'cta';
    const why = ({ header: '頁首標籤／頂部導覽', footer: '頁尾標籤／底部大量連結', hero: '首屏大標題＋按鈕或媒體', pricing: '價格字樣與重複方案', testimonial: '引言或客戶見證', faq: '展開式問答', form: '表單欄位', logos: '多張小圖且文字少', stats: '多個數字', gallery: '多張圖片', features: '重複 ' + rep + ' 個卡片', cta: '頁尾附近的短文＋按鈕', content: '未符合特定版型' })[kind];
    return { kind, why, tag: el.tagName.toLowerCase(), id: el.id || undefined, class: String(cls).trim().split(/\s+/).slice(0, 3).join(' ') || undefined,
      y: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width), columns: rep, headings: h, buttons: btn, media, links,
      heading: (el.querySelector('h1,h2,h3')?.innerText || '').trim().slice(0, 80), text: t.replace(/\s+/g, ' ').slice(0, 90) };
  };
  const blocks = blocksEls.slice(0, 40).map((e, i, a) => classify(e, i, a.length));

  // ---------- contrast on real (composited) backgrounds ----------
  const issues = new Map(); let checked = 0;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,span,label,td,small,blockquote')) {
    if (checked > 1500) break;
    if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const s = cs(el), fg = parseC(s.color); if (!fg) continue;
    const bg = effBg(el), fgc = fg[3] < 1 ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg;
    checked++;
    const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700), need = large ? 3 : 4.5, rt = ratio(fgc, bg);
    if (rt >= need) continue;
    const k = hex(fgc) + '|' + hex(bg) + '|' + large;
    const e = issues.get(k) || { fg: hex(fgc), bg: hex(bg), ratio: +rt.toFixed(2), need, large, count: 0, sample: '', uncertain: hasBgImage(el) };
    e.count++; if (!e.sample) e.sample = (el.innerText || '').trim().slice(0, 40); issues.set(k, e);
  }

  // ---------- motion tokens ----------
  const tm = {}, an = {};
  for (const el of all) {
    const s = cs(el);
    const d = splitTop(s.transitionDuration), e = splitTop(s.transitionTimingFunction);
    d.forEach((x, i) => { const ms = x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000; if (ms > 0) { const k = `${Math.round(ms)}ms ${e[i % e.length] || 'ease'}`; tm[k] = (tm[k] || 0) + 1; } });
    if (s.animationName !== 'none') { const ad = splitTop(s.animationDuration)[0] || '0s'; const ms = ad.endsWith('ms') ? parseFloat(ad) : parseFloat(ad) * 1000; const k = `${splitTop(s.animationName)[0]} ${Math.round(ms)}ms ${splitTop(s.animationTimingFunction)[0] || 'ease'}`; an[k] = (an[k] || 0) + 1; }
  }

  // ---------- layout grid ----------
  const widths = {}, cols = {}, gaps = {};
  for (const el of all) {
    const s = cs(el), r = el.getBoundingClientRect();
    if (r.width >= 600 && r.width < vw - 20 && s.display !== 'inline' && Math.abs(r.left - (vw - r.right)) < 3 && r.height > 40) { const k = Math.round(r.width); widths[k] = (widths[k] || 0) + 1; }
    if (s.display.includes('grid')) { const n = s.gridTemplateColumns.split(' ').filter((x) => /px|fr|%/.test(x)).length; if (n > 1) { cols[n] = (cols[n] || 0) + 1; if (s.columnGap !== 'normal') gaps[s.columnGap] = (gaps[s.columnGap] || 0) + 1; } }
    else if (s.display.includes('flex') && s.flexDirection.startsWith('row') && el.children.length >= 3 && s.columnGap !== 'normal' && s.columnGap !== '0px') gaps[s.columnGap] = (gaps[s.columnGap] || 0) + 1;
  }

  // ---------- font sources ----------
  const faces = [];
  for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) if (r.type === CSSRule.FONT_FACE_RULE) faces.push({ family: r.style.getPropertyValue('font-family').replace(/["']/g, '').trim(), weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal', src: (r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/) || [])[1] || '', display: r.style.getPropertyValue('font-display') || '' }); } catch {} }
  const fontLinks = [...document.querySelectorAll('link[href*="fonts.googleapis"], link[href*="typekit"], link[href*="fonts.adobe"], link[href*="fast.fonts"], link[href*="fonts.bunny"]')].map((l) => l.href);
  const googleFamilies = fontLinks.flatMap((h) => [...h.matchAll(/family=([^&:;]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')));

  // ---------- inline icons (as safe standalone SVG strings) ----------
  const icons = [], seenIcons = new Set();
  for (const svg of document.querySelectorAll('svg')) {
    if (icons.length >= 40) break;
    const r = svg.getBoundingClientRect();
    if (r.width < 12 || r.width > 96 || r.height < 12 || r.height > 96 || !visible(svg)) continue;
    // bake page CSS into attributes: a standalone SVG loses the stylesheet that made it an outline icon
    const clone = svg.cloneNode(true), srcEls = [svg, ...svg.querySelectorAll('*')], dstEls = [clone, ...clone.querySelectorAll('*')];
    srcEls.forEach((e, i) => { const c = cs(e), d = dstEls[i]; if (!d || !d.setAttribute) return; for (const [attr, prop] of [['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'stroke-width'], ['stroke-linecap', 'stroke-linecap'], ['stroke-linejoin', 'stroke-linejoin'], ['opacity', 'opacity']]) { const v = c.getPropertyValue(prop); if (v && v !== 'normal') d.setAttribute(attr, v); } });
    let html = clone.outerHTML;
    if (html.length > 4000 || html.length < 60 || /<use[\s>]/i.test(html)) continue;
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/currentColor/g, cs(svg).color);
    if (!/xmlns=/.test(html)) html = html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    if (seenIcons.has(html)) continue; seenIcons.add(html);
    icons.push({ svg: html, w: Math.round(r.width), h: Math.round(r.height) });
  }

  // ---------- copy / voice ----------
  const ctas = {};
  for (const el of document.querySelectorAll('button, a[class*=btn], a[class*=button], [role=button]')) { const t = (el.innerText || '').trim(); if (t && t.length < 32) ctas[t] = (ctas[t] || 0) + 1; }
  const navLabels = [...document.querySelectorAll('nav a, header a')].map((a) => (a.innerText || '').trim()).filter((t) => t && t.length < 30);

  return {
    viewport: { w: vw, h: vh }, elements: picked, blocks,
    contrast: { checked, failing: [...issues.values()].sort((a, b) => b.count - a.count).slice(0, 15) },
    motion: { transitions: top(tm, 8).map(([k, count]) => ({ token: k, count })), animations: top(an, 6).map(([k, count]) => ({ token: k, count })) },
    grid: { containerWidths: top(widths, 4).map(([w, count]) => ({ px: +w, count })), columns: top(cols, 5).map(([n, count]) => ({ columns: +n, count })), gaps: top(gaps, 5).map(([v, count]) => ({ value: v, count })) },
    fonts: { faces: faces.slice(0, 60), links: fontLinks, googleFamilies: [...new Set(googleFamilies)] },
    icons, copy: { ctas: top(ctas, 10).map(([text, count]) => ({ text, count })), nav: [...new Set(navLabels)].slice(0, 16) },
  };
}
