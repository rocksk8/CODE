#!/usr/bin/env node
// "Does the site follow our design system?" Checks the colours, corner radii and font sizes a site really uses against a W3C Design Tokens (DTCG) file you give it.
//   token-check.mjs --site <crawl folder> --tokens tokens.json [--max-off-token <percent>]
// Colours match when they are within CIEDE2000 <= 2 of a token (not just "the same hex"); lengths match within 0.5 px (rem = 16 px). Writes token-check.json / token-check.md next to the crawl.
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { isMain } from './util.mjs';
import { BANNER, clean } from './untrusted.mjs';
import { colorDistance } from './color-science.mjs';

const MAX_BYTES = 1_000_000;
export function parseColor(v) {
  if (v && typeof v === 'object') { if (typeof v.hex === 'string') return parseColor(v.hex); const c = v.components; if (Array.isArray(c) && c.length >= 3 && (!v.colorSpace || v.colorSpace === 'srgb')) return { r: Math.round(c[0] * 255), g: Math.round(c[1] * 255), b: Math.round(c[2] * 255) }; return null; }
  const s = String(v || '').trim(); let m;
  if ((m = /^#([0-9a-f]{3,4})$/i.exec(s))) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  if ((m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(s))) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}
export function parseLength(v) {
  if (v && typeof v === 'object' && v.value != null) return parseLength(`${v.value}${v.unit || 'px'}`);
  const m = /^(-?\d*\.?\d+)\s*(px|rem|em)?$/i.exec(String(v ?? '').trim()); if (!m) return null; const n = parseFloat(m[1]); return /^(rem|em)$/i.test(m[2] || '') ? n * 16 : n;
}
/** Reads a DTCG document: { colors:[{name,rgb}], radii:[{name,px}], fontSizes:[{name,px}] }. Groups pass their $type down; names are the dotted path. Unknown shapes are ignored, not fatal. */
export function parseTokenFile(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('token 檔不是有效的 JSON。')); }
  const out = { colors: [], radii: [], fontSizes: [] }; let nodes = 0;
  const walk = (node, p, type) => {
    if (!node || typeof node !== 'object' || ++nodes > 20000 || p.length > 12) return;
    const t = node.$type || type;
    if ('$value' in node) {
      const name = p.join('.');
      if (t === 'color') { const rgb = parseColor(node.$value); if (rgb) out.colors.push({ name, rgb }); }
      else if (t === 'dimension' || t === 'fontSize' || t === 'borderRadius') { const px = parseLength(node.$value); if (px != null) { if (t === 'fontSize' || /font.?size|text.?size|fontsize/i.test(name)) out.fontSizes.push({ name, px }); else if (t === 'borderRadius' || /radius|rounded|corner/i.test(name)) out.radii.push({ name, px }); } }
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...p, k], t);
  };
  walk(j, [], undefined);
  if (!out.colors.length && !out.radii.length && !out.fontSizes.length) throw new Error(_t('token 檔裡沒有可比對的顏色、圓角或字級（需要 W3C Design Tokens 格式：含 $value 與 $type）。'));
  return out;
}
const near = (list, px) => list.find((t) => Math.abs(t.px - px) <= 0.5) || null;
/** tokens = parseTokenFile result; design = the site's tokens.json (palette, radius, typography.sizesObserved). */
export function checkTokens(tokens, design, { threshold = 2 } = {}) {
  const res = { colors: { total: 0, off: [], on: 0 }, radii: { total: 0, off: [], on: 0 }, fontSizes: { total: 0, off: [], on: 0 } };
  for (const p of design.palette || []) {
    const rgb = parseColor(p.hex); if (!rgb) continue; const uses = Math.max(1, p.uses || 1);
    let best = null, bd = Infinity; for (const t of tokens.colors) { const d = colorDistance(rgb, t.rgb); if (d < bd) { bd = d; best = t; } }
    res.colors.total += uses; if (best && bd <= threshold) res.colors.on += uses; else res.colors.off.push({ value: p.hex, uses, nearest: best ? { name: clean(best.name, 60), delta: +bd.toFixed(1) } : null });
  }
  const px = (v) => { const m = /^(-?\d*\.?\d+)px$/.exec(String(v).trim()); return m ? parseFloat(m[1]) : null; };
  for (const r of design.radius || []) { const v = px(r); if (v == null || v === 0) continue; res.radii.total++; const t = near(tokens.radii, v); if (t) res.radii.on++; else res.radii.off.push({ value: `${v}px`, uses: 1, nearest: nearestPx(tokens.radii, v) }); }
  for (const s of design.typography?.sizesObserved || []) { if (!(s > 0)) continue; res.fontSizes.total++; const t = near(tokens.fontSizes, s); if (t) res.fontSizes.on++; else res.fontSizes.off.push({ value: `${s}px`, uses: 1, nearest: nearestPx(tokens.fontSizes, s) }); }
  const checked = ['colors', 'radii', 'fontSizes'].filter((k) => tokens[k].length && res[k].total);
  const total = checked.reduce((a, k) => a + res[k].total, 0), on = checked.reduce((a, k) => a + res[k].on, 0);
  const offPct = total ? +(100 * (total - on) / total).toFixed(1) : 0;
  for (const k of ['colors', 'radii', 'fontSizes']) res[k].off.sort((a, b) => b.uses - a.uses);
  return { ...res, checked, offPct, tokenCounts: { colors: tokens.colors.length, radii: tokens.radii.length, fontSizes: tokens.fontSizes.length } };
}
function nearestPx(list, v) { let b = null, bd = Infinity; for (const t of list) { const d = Math.abs(t.px - v); if (d < bd) { bd = d; b = t; } } return b ? { name: clean(b.name, 60), delta: +bd.toFixed(1) } : null; }

export function renderTokenCheckMd(r, { maxOff = null } = {}) {
  const L = [BANNER, '', _t('# 設計規範符合度'), '', _t`網站實際用到的值，有 ${(100 - r.offPct).toFixed(1)}% 符合你的 token 檔（不符合 ${r.offPct}%）。顏色允許肉眼看不出的差異（CIEDE2000 ≤ 2），長度允許 0.5 px。${maxOff != null ? _t`門檻：不符合比例不得超過 ${maxOff}%。` : ''}`, ''];
  const sec = (k, title, unit) => { if (!r.checked.includes(k)) { L.push(`## ${title}`, '', _t('（token 檔沒有這一類，或網站沒有量到。）'), ''); return; } const x = r[k]; L.push(`## ${title}`, '', _t`${x.on}／${x.total} 符合。`, '');
    if (x.off.length) { L.push(`| ${_t('網站用到的值')} | ${_t('使用量')} | ${_t('最接近的 token')} |`, '|---|---|---|', ...x.off.slice(0, 30).map((o) => `| ${o.value} | ${o.uses} | ${o.nearest ? `${o.nearest.name}（${unit} ${o.nearest.delta}）` : '—'} |`), ''); } };
  sec('colors', _t('顏色'), 'ΔE'); sec('radii', _t('圓角'), 'px'); sec('fontSizes', _t('字級'), 'px');
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--site'), file = arg('--tokens'), maxArg = arg('--max-off-token');
  if (!dir || !file || !fs.existsSync(path.join(dir, 'design-bundle', 'tokens.json'))) { console.error(_t('用法：token-check.mjs --site <含 design-bundle 的爬取資料夾> --tokens <tokens.json> [--max-off-token <百分比>]')); process.exit(1); }
  try {
    if (fs.statSync(file).size > MAX_BYTES) throw new Error(_t('token 檔太大（上限 1 MB）。'));
    const maxOff = maxArg == null ? null : Number(maxArg); if (maxOff != null && !(maxOff >= 0 && maxOff <= 100)) throw new Error(_t('--max-off-token 必須是 0 到 100 的數字。'));
    const tokens = parseTokenFile(fs.readFileSync(file, 'utf8')); const design = JSON.parse(fs.readFileSync(path.join(dir, 'design-bundle', 'tokens.json'), 'utf8'));
    const r = checkTokens(tokens, design); const failed = maxOff != null && r.offPct > maxOff;
    fs.writeFileSync(path.join(dir, 'token-check.json'), JSON.stringify({ ...r, maxOff, failed }, null, 2)); fs.writeFileSync(path.join(dir, 'token-check.md'), renderTokenCheckMd(r, { maxOff }) + '\n');
    console.log(_t`設計規範符合度：${(100 - r.offPct).toFixed(1)}%（不符合 ${r.offPct}%）→ ${path.join(dir, 'token-check.md')}`);
    if (failed) { console.error(_t`✖ 不符合比例 ${r.offPct}% 超過門檻 ${maxOff}%。`); process.exit(4); }
  } catch (e) { console.error('✖ ' + String(e.message).split('\n')[0]); process.exit(1); }
}
