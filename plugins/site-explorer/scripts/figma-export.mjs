#!/usr/bin/env node
// Figma-ready layout drafts (html.to.design-style, built from what the crawl measured): one SVG per page whose layers carry real positions, sizes, fills,
// corner radii and text with the page's fonts and colours. Drag the SVG onto a Figma canvas (or File → Place image… / import) and every layer is editable.
// Design variables for Figma come from design-bundle/tokens.studio.json (Tokens Studio plugin) and tokens.w3c.json.
// It is a layout DRAFT from up to 240 measured elements — not a pixel-exact copy: text is clipped to the first 50 characters and images are grey placeholders.
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { isMain } from './util.mjs';
import { clean } from './untrusted.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const colour = (c, d) => (HEX.test(String(c || '')) ? c : d);
const family = (f) => String(f || 'sans-serif').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40) || 'sans-serif';
const ORDER = ['block', 'media', 'input', 'button', 'heading', 'text', 'link'];
const NAMES = { block: 'Section', media: 'Image', input: 'Input', button: 'Button', heading: 'Heading', text: 'Text', link: 'Link' };

export function renderFigmaSvg(pageJson, { width = null } = {}) {
  const d = pageJson?.designer; if (!d?.elements?.length) return null;
  const W = Math.round(width || d.viewport?.w || 1440), H = Math.max(Math.round(pageJson.layout?.docHeight || d.viewport?.h || 900), 200);
  const els = d.elements.filter((e) => [e.x, e.y, e.w, e.h].every(Number.isFinite) && e.w > 0 && e.h > 0 && e.x < 20000 && e.y < 100000).slice(0, 240);
  const blocks = els.filter((e) => e.role === 'block').sort((a, b) => b.w * b.h - a.w * a.h);
  const pageBg = colour(blocks[0]?.bg, '#ffffff');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<title>${esc(clean(pageJson.title || pageJson.url || 'page', 80))}</title>`, `<g id="Page"><rect id="Background" width="${W}" height="${H}" fill="${pageBg}"/>`];
  for (const role of ORDER) {
    const list = els.filter((e) => e.role === role); if (!list.length) continue;
    out.push(`<g id="${NAMES[role]}s">`);
    list.forEach((e, i) => {
      const r = Math.min(num(e.radius), Math.min(e.w, e.h) / 2), id = `${NAMES[role]} ${i + 1}`;
      const text = clean(String(e.text || ''), 50), size = Math.max(8, Math.min(num(e.size, 16), 120)), fill = colour(e.color, '#000000');
      if (role === 'media') out.push(`<g id="${id}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${r}" fill="#d9d9d9"/><text x="${e.x + 8}" y="${e.y + 20}" font-family="sans-serif" font-size="12" fill="#666666">${esc(text || 'image')}</text></g>`);
      else if (role === 'block') { if (colour(e.bg, null) && e.bg.toLowerCase() !== pageBg.toLowerCase()) out.push(`<rect id="${id}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${r}" fill="${e.bg}"/>`); else out.push(`<rect id="${id}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="none" stroke="#e5e5e5" stroke-dasharray="4 4"/>`); }
      else {
        const hasBox = role === 'button' || role === 'input';
        out.push(`<g id="${id}">`);
        if (hasBox) out.push(`<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${r}" fill="${colour(e.bg, '#ffffff')}"${role === 'input' ? ' stroke="#cccccc"' : ''}/>`);
        if (text) {
          const lines = []; const perLine = Math.max(4, Math.floor((e.w - 4) / (size * 0.55)));
          for (let w = text; w.length;) { if (w.length <= perLine) { lines.push(w); break; } let cut = w.lastIndexOf(' ', perLine); if (cut < perLine * 0.5) cut = perLine; lines.push(w.slice(0, cut).trim()); w = w.slice(cut).trim(); }
          const lh = Math.max(size * 1.25, num(e.lh, size * 1.25));
          const cx = hasBox ? e.x + e.w / 2 : e.x, anchor = hasBox ? ' text-anchor="middle"' : '';
          const y0 = hasBox ? e.y + e.h / 2 + size * 0.35 - ((lines.length - 1) * lh) / 2 : e.y + size;
          out.push(`<text x="${cx}" y="${y0}" font-family="${family(e.font)}, sans-serif" font-size="${size}" font-weight="${/^\d+$/.test(String(e.weight)) ? e.weight : 400}" fill="${fill}"${anchor}>${lines.map((l, k) => `<tspan x="${cx}" dy="${k ? lh : 0}">${esc(l)}</tspan>`).join('')}</text>`);
        }
        out.push('</g>');
      }
    });
    out.push('</g>');
  }
  out.push('</g></svg>');
  return out.join('\n') + '\n';
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：figma-export.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const outDir = path.join(dir, 'figma'); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const p of site.pages || []) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(p.slug || '')) continue;
    let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { continue; }
    const svg = renderFigmaSvg(pj); if (!svg) continue;
    fs.writeFileSync(path.join(outDir, `${p.slug}.svg`), svg); n++;
  }
  fs.writeFileSync(path.join(outDir, 'README.md'), [_t('# 匯入 Figma'), '', _t('1. 把 `*.svg` 拖進 Figma 畫布：每個圖層都有真實的位置、大小、填色、圓角與文字，可以直接編輯。'), _t('2. 設計變數（色彩、字型、間距）：用 Tokens Studio 外掛匯入 `../design-bundle/tokens.studio.json`，或匯入 `tokens.w3c.json`。'), _t('3. 這是依實測元素（最多 240 個）產生的版面草稿，不是逐像素的複製：文字只取前 50 個字，圖片是灰色佔位。字型要先安裝在你的電腦上，Figma 才會顯示原字型。'), ''].join('\n'));
  console.log(_t`Figma 匯入檔：${n} 頁 → ${outDir}`);
}
