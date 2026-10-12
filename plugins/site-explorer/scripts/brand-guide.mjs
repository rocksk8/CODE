#!/usr/bin/env node
// A printable brand guide of the explored site, built from the design tokens: colours (roles + palette with contrast), type scale, spacing, radii, shadows and the contrast audit.
//   brand-guide.mjs --site <crawl folder> [--pdf]     writes design-bundle/brand-guide.html (and brand-guide.pdf with --pdf, Chromium only)
// Everything that came from the site is escaped and every value that goes into CSS is checked against a strict pattern first.
import fs from 'node:fs';
import path from 'node:path';
import { _t, htmlLang } from './i18n.mjs';
import { isMain } from './util.mjs';
import { clean } from './untrusted.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i, FONT = /^[\w \-　-鿿.]{1,60}$/, LEN = /^\d{1,4}(\.\d{1,2})?px$/, SHADOW = /^[\w\s.,()#%-]{1,160}$/;
const safeHex = (h) => (HEX.test(String(h)) ? String(h).toLowerCase() : null);
const safeFont = (f) => (FONT.test(String(f || '').trim()) ? String(f).trim() : null);
const rgbOf = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const contrastOf = (h1, h2) => { const a = lum(rgbOf(h1)), b = lum(rgbOf(h2)); return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); };

/** tokens = design-bundle/tokens.json. Returns one self-contained HTML document. */
export function renderBrandGuideHtml(tokens, { url = '', when = '' } = {}) {
  const roles = Object.entries(tokens.color || {}).map(([k, v]) => [clean(k, 30), safeHex(v)]).filter(([, v]) => v);
  const palette = (tokens.palette || []).map((p) => ({ hex: safeHex(p.hex), uses: Number.isFinite(p.uses) ? p.uses : 0, merged: (p.merged || []).map(safeHex).filter(Boolean).slice(0, 4) })).filter((p) => p.hex).slice(0, 16);
  const swatch = (hex, name, extra = '') => { const on = contrastOf(hex, '#ffffff') >= contrastOf(hex, '#000000') ? '#ffffff' : '#000000'; return `<div class="sw"><div class="chip" style="background:${hex};color:${on}"><b>${esc(name)}</b></div><div class="meta"><code>${hex}</code> <span>rgb(${Object.values(rgbOf(hex)).join(', ')})</span><br><small>${esc(_t('白底對比'))} ${contrastOf(hex, '#ffffff')}:1 · ${esc(_t('黑底對比'))} ${contrastOf(hex, '#000000')}:1${extra}</small></div></div>`; };
  const fam = tokens.typography?.fontStack || {}; const scale = Object.entries(tokens.typography?.scale || {}).slice(0, 8);
  const heading = safeFont(fam.heading), body = safeFont(fam.body);
  const typeRows = scale.map(([k, v]) => { const px = LEN.test(String(v.size)) ? v.size : null; if (!px) return ''; const f = safeFont(v.family) || (/^h/i.test(k) ? heading : body); return `<div class="ty"><div class="tag">${esc(clean(k, 12))} · ${px} · ${esc(clean(v.weight, 6))}</div><div class="sample" style="font-size:${px};font-weight:${/^\d{3}$/.test(String(v.weight)) ? v.weight : 400};${f ? `font-family:'${f}',system-ui,sans-serif;` : ''}">${esc(_t('敏捷的棕色狐狸 The quick brown fox 123'))}</div></div>`; }).join('');
  const sp = (tokens.spacing?.observed || []).filter((n) => Number.isFinite(n) && n > 0 && n <= 160).slice(0, 14);
  const radii = [...new Set((tokens.radius || []).filter((r) => LEN.test(String(r))))].slice(0, 8);
  const shadows = [...new Set((tokens.shadow || []).filter((s) => SHADOW.test(String(s))))].slice(0, 6);
  const audit = (tokens.contrastAudit || []).slice(0, 8).filter((a) => safeHex(a.fg) && safeHex(a.bg));
  const css = `:root{--ink:#16181d;--mute:#667085;--line:#e3e8ef}*{box-sizing:border-box}body{margin:0;font:13px/1.55 system-ui,-apple-system,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif;color:var(--ink);background:#fff}.page{max-width:900px;margin:0 auto;padding:32px 36px}h1{font-size:30px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--ink)}.sub{color:var(--mute);word-break:break-all}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}.sw{border:1px solid var(--line);border-radius:8px;overflow:hidden;break-inside:avoid}.chip{height:64px;padding:8px 10px;display:flex;align-items:flex-end}.meta{padding:8px 10px}code{font:12px ui-monospace,Menlo,monospace}small{color:var(--mute)}.ty{padding:8px 0;border-bottom:1px solid var(--line);break-inside:avoid}.tag{font-size:11px;color:var(--mute)}.sample{line-height:1.25}.bar{height:10px;background:#43b4e0;border-radius:3px}.row{display:flex;align-items:center;gap:10px;margin:4px 0}.row span{width:60px;color:var(--mute)}.box{width:90px;height:56px;background:#f3f5f8;border:1px solid var(--line)}.shd{width:120px;height:60px;background:#fff;border-radius:8px;margin:8px 14px 8px 0;display:inline-block}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}.ok{color:#067647}.no{color:#b42318}.foot{margin-top:32px;color:var(--mute);font-size:11px}@page{size:A4;margin:14mm}@media print{.page{padding:0}}`;
  return `<!doctype html><html lang="${htmlLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(_t('品牌手冊'))}</title><style>${css}</style></head><body><div class="page">
<h1>${esc(_t('品牌手冊'))}</h1><div class="sub">${esc(clean(url, 200))}${when ? ' · ' + esc(clean(when, 40)) : ''}</div>
<h2>${esc(_t('主要顏色'))}</h2><div class="grid">${roles.map(([k, v]) => swatch(v, k)).join('') || `<p>${esc(_t('沒有偵測到。'))}</p>`}</div>
<h2>${esc(_t('色票'))}</h2><div class="grid">${palette.map((p) => swatch(p.hex, `${p.uses}×`, p.merged.length ? `<br><small>${esc(_t('合併了近似色'))}: ${p.merged.join(', ')}</small>` : '')).join('') || `<p>${esc(_t('沒有偵測到。'))}</p>`}</div>
<h2>${esc(_t('字型'))}</h2><p>${esc(_t('標題'))}: <b>${esc(heading || '—')}</b> · ${esc(_t('內文'))}: <b>${esc(body || '—')}</b></p>${typeRows || `<p>${esc(_t('沒有偵測到。'))}</p>`}
<h2>${esc(_t('間距'))}</h2>${sp.map((n) => `<div class="row"><span>${n}px</span><div class="bar" style="width:${Math.min(100, n * 2)}%"></div></div>`).join('') || `<p>${esc(_t('沒有偵測到。'))}</p>`}
<h2>${esc(_t('圓角與陰影'))}</h2><div>${radii.map((r) => `<div class="box" style="display:inline-block;border-radius:${r};margin:0 12px 8px 0" title="${esc(r)}"></div>`).join('') || `<p>${esc(_t('這個網站沒有圓角。'))}</p>`}</div><div>${shadows.map((s) => `<div class="shd" style="box-shadow:${s}"></div>`).join('')}</div>
<h2>${esc(_t('對比檢查'))}</h2>${audit.length ? `<table><tr><th>${esc(_t('項目'))}</th><th>${esc(_t('前景'))}</th><th>${esc(_t('背景'))}</th><th>${esc(_t('對比'))}</th></tr>${audit.map((a) => `<tr><td>${esc(clean(a.name, 60))}</td><td><code>${safeHex(a.fg)}</code></td><td><code>${safeHex(a.bg)}</code></td><td class="${a.pass ? 'ok' : 'no'}">${esc(a.ratio)}:1 ${a.pass ? '✓' : '✗'}</td></tr>`).join('')}</table>` : `<p>${esc(_t('沒有資料。'))}</p>`}
<div class="foot">${esc(_t('這份手冊是從網站實際呈現的樣子量測而來，不是品牌方提供的官方規範。'))}</div></div></body></html>`;
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--site'), wantPdf = process.argv.includes('--pdf'); const tf = dir && path.join(dir, 'design-bundle', 'tokens.json');
  if (!dir || !fs.existsSync(tf)) { console.error(_t('用法：brand-guide.mjs --site <含 design-bundle 的爬取資料夾> [--pdf]')); process.exit(1); }
  try {
    const tokens = JSON.parse(fs.readFileSync(tf, 'utf8')); let site = {}; try { site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8')); } catch {}
    const html = renderBrandGuideHtml(tokens, { url: site.startUrl || '', when: String(site.crawledAt || '').slice(0, 10) }); const out = path.join(dir, 'design-bundle', 'brand-guide.html'); fs.writeFileSync(out, html);
    console.log(_t`品牌手冊：${out}`);
    if (wantPdf) {
      try { const { launchBrowser } = await import('./launch.mjs'); const br = await launchBrowser(); try { const pg = await br.newPage(); await pg.setContent(html, { waitUntil: 'load' }); await pg.pdf({ path: path.join(dir, 'design-bundle', 'brand-guide.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } }); console.log(_t`品牌手冊 PDF：${path.join(dir, 'design-bundle', 'brand-guide.pdf')}`); } finally { await br.close(); } }
      catch (e) { console.error(_t('（PDF 沒有產生：') + String(e.message).split('\n')[0] + _t('；HTML 仍可用瀏覽器開啟後列印。）')); }
    }
  } catch (e) { console.error('✖ ' + String(e.message).split('\n')[0]); process.exit(1); }
}
