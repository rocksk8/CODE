#!/usr/bin/env node
// Figma-ready layout drafts (html.to.design-style, built from what the crawl measured): one SVG per page whose layers carry real positions, sizes, fills,
// corner radii and text with the page's fonts and colours. Drag the SVG onto a Figma canvas (or File → Place image… / import) and every layer is editable.
// Design variables for Figma come from design-bundle/tokens.studio.json (Tokens Studio plugin) and tokens.w3c.json.
// It is a layout DRAFT from up to 240 measured elements — not a pixel-exact copy: text is clipped to the first 200 characters and images are grey placeholders.
// Auto layout: figma/<page>.figma.json + figma/plugin/ (a small Figma plugin) rebuild the page as real frames with auto layout, full text and the page's images.
// The plugin is generated from the measured layout tree; it has been exercised against a mocked Figma API but not inside Figma itself.
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
      const text = clean(String(e.text || ''), 200), size = Math.max(8, Math.min(num(e.size, 16), 120)), fill = colour(e.color, '#000000');
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


// ---------------------------------------------------------------- layered frames with auto layout (figma.json + plugin)
const rgb = (c) => { const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(String(c || '')); if (!m) return null; if (m[4] !== undefined && Number(m[4]) === 0) return null; return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join(''); };
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const median = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : 0; };
const pad4 = (v) => { const p = String(v || '0').split(/\s+/).map(px); return p.length === 1 ? [p[0], p[0], p[0], p[0]] : p.length === 2 ? [p[0], p[1], p[0], p[1]] : p.length === 3 ? [p[0], p[1], p[2], p[1]] : p.slice(0, 4); };
const JUSTIFY = { 'flex-start': 'MIN', start: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', 'space-between': 'SPACE_BETWEEN', normal: 'MIN' };
const ALIGN = { 'flex-start': 'MIN', start: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', normal: 'MIN', stretch: 'MIN', baseline: 'MIN' };

/** layout.tree of a crawled page → { type: 'FRAME'|'TEXT'|'IMAGE', ... } with positions relative to the parent and auto layout inferred from flex / grid / stacking. */
export function treeToFigma(tree, { maxNodes = 1500 } = {}) {
  let count = 0;
  const conv = (n, parent) => {
    if (!n || !n.box || count >= maxNodes) return null; count++;
    const b = n.box, rel = parent ? { x: b.x - parent.box.x, y: b.y - parent.box.y } : { x: 0, y: 0 };
    const base = { name: clean(`${n.tag}${n.id ? '#' + n.id : ''}${n.class ? '.' + String(n.class).split(' ')[0] : ''}`, 50), x: rel.x, y: rel.y, w: Math.max(1, b.w), h: Math.max(1, b.h) };
    if (n.tag === 'img' && n.src) return { type: 'IMAGE', ...base, src: /^https?:/i.test(n.src) ? String(n.src).slice(0, 400) : null, alt: clean(n.alt || '', 80), radius: px(n.radius) };
    if (n.text && !(n.children || []).length) { const t = n.type || {}; return { type: 'TEXT', ...base, text: clean(n.text, 300), font: { family: String(t.family || 'Inter').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40) || 'Inter', size: Math.max(6, Math.min(px(t.size) || 16, 200)), weight: /^\d+$/.test(String(t.weight)) ? Number(t.weight) : 400, lineHeight: t.lineHeight && t.lineHeight !== 'normal' ? px(t.lineHeight) : null }, color: rgb(t.color) || '#000000', align: ['left', 'center', 'right', 'justify'].includes(t.align) ? t.align : 'left' }; }
    const kids = (n.children || []).map((c) => conv(c, n)).filter(Boolean);
    const f = { type: 'FRAME', ...base, fill: rgb(n.background), radius: px(n.radius), children: kids };
    const pad = pad4(n.padding);
    if (kids.length) {
      if (n.flex && /flex/.test(n.display || '')) {
        const dir = /column/.test(n.flex.direction || '') ? 'VERTICAL' : 'HORIZONTAL'; const gap = px(String(n.flex.gap || '0').split(' ')[0]);
        f.layout = { mode: dir, spacing: gap, wrap: /wrap/.test(n.flex.wrap || '') && !/nowrap/.test(n.flex.wrap || ''), padding: pad, primary: JUSTIFY[n.flex.justify] || 'MIN', counter: ALIGN[n.flex.align] || 'MIN' };
      } else if (n.grid && /grid/.test(n.display || '')) {
        f.layout = { mode: 'HORIZONTAL', spacing: px(String(n.grid.gap || '0').split(' ').pop()), wrap: true, padding: pad, primary: 'MIN', counter: 'MIN' };
      } else if (kids.length >= 2) { // plain block: if the children are stacked top to bottom without overlapping, it is a vertical auto-layout; side by side → horizontal
        const ys = kids.slice().sort((a, c) => a.y - c.y); const stacked = ys.every((k, i) => i === 0 || k.y >= ys[i - 1].y + ys[i - 1].h - 1);
        const xs = kids.slice().sort((a, c) => a.x - c.x); const side = !stacked && xs.every((k, i) => i === 0 || k.x >= xs[i - 1].x + xs[i - 1].w - 1) && new Set(kids.map((k) => k.y)).size <= 2;
        if (stacked) f.layout = { mode: 'VERTICAL', spacing: Math.max(0, Math.round(median(ys.slice(1).map((k, i) => k.y - (ys[i].y + ys[i].h))))), wrap: false, padding: [Math.max(0, ys[0].y), 0, 0, 0].map(Math.round), primary: 'MIN', counter: 'MIN', loose: true };
        else if (side) f.layout = { mode: 'HORIZONTAL', spacing: Math.max(0, Math.round(median(xs.slice(1).map((k, i) => k.x - (xs[i].x + xs[i].w))))), wrap: false, padding: [0, 0, 0, Math.max(0, xs[0].x)].map(Math.round), primary: 'MIN', counter: 'MIN', loose: true };
      }
    }
    return f;
  };
  return conv(tree, null);
}

const PLUGIN_MANIFEST = { name: 'site-explorer import', id: 'site-explorer-import', api: '1.0.0', main: 'code.js', ui: 'ui.html', editorType: ['figma'], networkAccess: { allowedDomains: ['*'], reasoning: 'Loads the images of the explored page so they appear in the design.' } };
const PLUGIN_UI = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px}button{margin-top:12px;padding:8px 14px}</style>
<p>Choose the <b>*.figma.json</b> files from site-explorer's <code>figma/</code> folder.</p><input id="f" type="file" accept=".json,application/json" multiple><br><button id="go">Import into this file</button><p id="m"></p>
<script>document.getElementById('go').onclick=async function(){var fs=document.getElementById('f').files;if(!fs.length){document.getElementById('m').textContent='Pick a file first.';return}var docs=[];for(var i=0;i<fs.length;i++){try{docs.push(JSON.parse(await fs[i].text()))}catch(e){document.getElementById('m').textContent='Not a valid file: '+fs[i].name;return}}parent.postMessage({pluginMessage:{type:'import',docs:docs}},'*')};onmessage=function(e){var m=e.data.pluginMessage;if(m&&m.text)document.getElementById('m').textContent=m.text}</script>`;
const PLUGIN_CODE = `// site-explorer → Figma: rebuilds an explored page as frames with auto layout, text and images.
figma.showUI(__html__, { width: 380, height: 240 });
const STYLE = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const loaded = new Map();
async function font(family, weight) {
  const style = STYLE[weight] || 'Regular', key = family + '|' + style;
  if (!loaded.has(key)) {
    let f = { family, style };
    try { await figma.loadFontAsync(f); } catch (e) { f = { family: 'Inter', style: STYLE[weight] || 'Regular' }; try { await figma.loadFontAsync(f); } catch (e2) { f = { family: 'Inter', style: 'Regular' }; await figma.loadFontAsync(f); } }
    loaded.set(key, f);
  }
  return loaded.get(key);
}
async function build(n, parent, inAuto) {
  let node;
  if (n.type === 'TEXT') {
    node = figma.createText(); node.fontName = await font(n.font.family, n.font.weight); node.fontSize = n.font.size; node.characters = n.text;
    node.fills = [{ type: 'SOLID', color: hex(n.color) }]; node.textAlignHorizontal = n.align === 'center' ? 'CENTER' : n.align === 'right' ? 'RIGHT' : n.align === 'justify' ? 'JUSTIFIED' : 'LEFT';
    if (n.font.lineHeight) node.lineHeight = { value: n.font.lineHeight, unit: 'PIXELS' };
    node.textAutoResize = 'HEIGHT'; node.resize(Math.max(1, n.w), Math.max(1, n.h));
  } else if (n.type === 'IMAGE') {
    node = figma.createRectangle(); node.resize(n.w, n.h); node.name = n.alt || 'image'; node.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    if (n.radius) node.cornerRadius = n.radius;
    if (n.src) { try { const img = await figma.createImageAsync(n.src); node.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }]; } catch (e) { /* keep the grey placeholder */ } }
  } else {
    node = figma.createFrame(); node.resize(n.w, n.h); node.clipsContent = false;
    node.fills = n.fill ? [{ type: 'SOLID', color: hex(n.fill) }] : []; if (n.radius) node.cornerRadius = n.radius;
    const L = n.layout, kidsIn = !!L;
    if (L) {
      node.layoutMode = L.mode; node.itemSpacing = L.spacing || 0; node.primaryAxisSizingMode = 'FIXED'; node.counterAxisSizingMode = 'FIXED';
      node.paddingTop = L.padding[0] || 0; node.paddingRight = L.padding[1] || 0; node.paddingBottom = L.padding[2] || 0; node.paddingLeft = L.padding[3] || 0;
      node.primaryAxisAlignItems = L.primary; node.counterAxisAlignItems = L.counter === 'MAX' ? 'MAX' : L.counter === 'CENTER' ? 'CENTER' : 'MIN';
      if (L.wrap && L.mode === 'HORIZONTAL') node.layoutWrap = 'WRAP';
    }
    for (const c of n.children || []) await build(c, node, kidsIn);
  }
  node.name = n.name || node.name; parent.appendChild(node);
  if (!inAuto) { node.x = n.x; node.y = n.y; }
  return node;
}
figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'import') return;
  try {
    let offset = 0, made = 0;
    for (const doc of msg.docs) {
      const root = await build(doc.root, figma.currentPage, false); root.name = doc.name || root.name; root.x = offset; root.y = 0; offset += root.width + 120; made++;
    }
    figma.closePlugin('Imported ' + made + ' page(s).');
  } catch (e) { figma.ui.postMessage({ text: 'Failed: ' + String(e && e.message || e).slice(0, 120) }); }
};
`;
export { PLUGIN_CODE, PLUGIN_UI, PLUGIN_MANIFEST };

/** Writes <outDir>/<slug>.figma.json for a page and returns true when the page had a layout tree. */
export function writeFigmaJson(pageJson, slug, outDir) {
  const root = treeToFigma(pageJson?.layout?.tree); if (!root) return false;
  root.w = Math.max(root.w, pageJson.layout.docWidth || root.w); root.h = Math.max(root.h, pageJson.layout.docHeight || root.h);
  fs.writeFileSync(path.join(outDir, `${slug}.figma.json`), JSON.stringify({ schema: 1, name: clean(String(pageJson.title || slug), 60) || slug, url: clean(String(pageJson.url || ''), 200), root }, null, 1));
  return true;
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：figma-export.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const outDir = path.join(dir, 'figma'); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  let n = 0, nj = 0;
  for (const p of site.pages || []) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(p.slug || '')) continue;
    let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { continue; }
    const svg = renderFigmaSvg(pj); if (svg) { fs.writeFileSync(path.join(outDir, `${p.slug}.svg`), svg); n++; }
    if (writeFigmaJson(pj, p.slug, outDir)) nj++;
  }
  if (nj) { const pd = path.join(outDir, 'plugin'); fs.mkdirSync(pd, { recursive: true }); fs.writeFileSync(path.join(pd, 'manifest.json'), JSON.stringify(PLUGIN_MANIFEST, null, 2)); fs.writeFileSync(path.join(pd, 'code.js'), PLUGIN_CODE); fs.writeFileSync(path.join(pd, 'ui.html'), PLUGIN_UI); }
  fs.writeFileSync(path.join(outDir, 'README.md'), [_t('# 匯入 Figma'), '', _t('## 做法 A：拖進畫布（最簡單）'), _t('把 `*.svg` 拖進 Figma 畫布：每個圖層都有真實的位置、大小、填色、圓角與文字，可以直接編輯。'), '', _t('## 做法 B：用外掛匯入（有 auto layout、完整文字與圖片）'), _t('1. 在 Figma 桌面版：選單 → Plugins → Development → Import plugin from manifest…，選 `plugin/manifest.json`。'), _t('2. 執行這個外掛，選 `*.figma.json`，按匯入。每一頁會變成一個 Frame，裡面是帶 auto layout 的巢狀 Frame、文字與圖片。'), _t('這個外掛只在模擬的 Figma 介面上測過，還沒有在真正的 Figma 裡驗證；如果匯入有問題，請先用做法 A。'), '', _t('## 設計變數'), _t('色彩、字型、間距：用 Tokens Studio 外掛匯入 `../design-bundle/tokens.studio.json`，或匯入 `tokens.w3c.json`。'), '', _t('## 限制'), _t('這是依實測元素產生的版面草稿，不是逐像素的複製：SVG 最多 240 個元素、文字最多 200 字、圖片是灰色佔位；auto layout 是由版面推測的（flex／grid／上下堆疊）。字型要先安裝在你的電腦上，Figma 才會顯示原字型。'), ''].join('\n'));
  console.log(_t`Figma 匯入檔：${n} 頁 → ${outDir}`);
}
