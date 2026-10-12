// Figma layout draft: one SVG per page with named layers carrying the measured geometry; hostile text cannot break the XML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFigmaSvg } from '../scripts/figma-export.mjs';
import { launchBrowser } from '../scripts/launch.mjs';

const page = {
  title: 'Shop </title><script>alert(1)</script>', layout: { docHeight: 1200 },
  designer: { viewport: { w: 1440, h: 900 }, elements: [
    { role: 'block', tag: 'header', text: '', x: 0, y: 0, w: 1440, h: 80, bg: '#111111', color: '#ffffff', radius: '0px' },
    { role: 'heading', tag: 'h1', text: 'We build things for the web "quickly" & <well>', x: 40, y: 120, w: 600, h: 60, font: 'Inter"><x', size: '48px', weight: '700', lh: '56px', color: '#222222', bg: '#ffffff', radius: '0px' },
    { role: 'button', tag: 'a', text: 'Get started', x: 40, y: 220, w: 160, h: 48, font: 'Inter', size: '16px', weight: '600', color: '#ffffff', bg: '#e4572e', radius: '24px' },
    { role: 'media', tag: 'img', text: 'hero photo', x: 700, y: 100, w: 600, h: 400, radius: '12px' },
    { role: 'text', tag: 'p', text: 'x'.repeat(10) + '\u0001\u0002 text', x: 40, y: 300, w: 300, h: 80, size: '16px', color: 'javascript:alert(1)', radius: '0px' },
    { role: 'block', tag: 'section', x: NaN, y: 0, w: 10, h: 10 },
  ] },
};

test('layers: named groups, geometry, fills, radius, wrapped text; invalid elements are skipped; no designer data gives null', () => {
  const svg = renderFigmaSvg(page);
  assert.match(svg, /<svg [^>]*width="1440" height="1200"/); assert.match(svg, /<g id="Headings">/); assert.match(svg, /id="Button 1"/);
  assert.match(svg, /<rect x="40" y="220" width="160" height="48" rx="24" fill="#e4572e"/); assert.match(svg, /fill="#111111"/);
  assert.match(svg, /<tspan/); assert.ok((svg.match(/<tspan/g) || []).length >= 2, 'long heading wraps');
  assert.ok(!svg.includes('NaN') && !/javascript:/.test(svg) && !/\u0001/.test(svg));
  assert.equal(renderFigmaSvg({}), null); assert.equal(renderFigmaSvg({ designer: { elements: [] } }), null);
});

test('hostile text and font names stay inert: the SVG is well-formed XML with no script element', async (t) => {
  const svg = renderFigmaSvg(page);
  assert.ok(!/<script/i.test(svg));
  let b; try { b = await launchBrowser(); } catch { return t.skip('no browser'); }
  try {
    const pg = await b.newPage();
    const r = await pg.evaluate((s) => { const d = new DOMParser().parseFromString(s, 'image/svg+xml'); return { err: !!d.querySelector('parsererror'), scripts: d.querySelectorAll('script').length, texts: d.querySelectorAll('text').length }; }, svg);
    assert.deepEqual(r, { err: false, scripts: 0, texts: r.texts }); assert.ok(r.texts >= 3);
  } finally { await b.close(); }
});

import { treeToFigma, PLUGIN_CODE, PLUGIN_MANIFEST, writeFigmaJson } from '../scripts/figma-export.mjs';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tree = { tag: 'body', display: 'block', box: { x: 0, y: 0, w: 1440, h: 900 }, background: 'rgb(255, 255, 255)', children: [
  { tag: 'header', display: 'flex', flex: { direction: 'row', wrap: 'nowrap', justify: 'space-between', align: 'center', gap: '24px' }, box: { x: 0, y: 0, w: 1440, h: 80 }, background: 'rgb(17, 17, 17)', padding: '10px 40px', children: [
    { tag: 'a', display: 'inline', box: { x: 40, y: 20, w: 100, h: 40 }, text: 'Logo', type: { color: 'rgb(255, 255, 255)', size: '24px', weight: '700', family: 'Inter', lineHeight: '30px', align: 'left' } },
    { tag: 'nav', display: 'block', box: { x: 1000, y: 20, w: 400, h: 40 }, text: 'Home  About', type: { color: 'rgb(200, 200, 200)', size: '16px', weight: '400', family: 'Inter', lineHeight: 'normal', align: 'right' } } ] },
  { tag: 'section', id: 'hero', display: 'block', box: { x: 0, y: 80, w: 1440, h: 500 }, background: 'rgb(238, 238, 255)', radius: '12px', children: [
    { tag: 'h1', display: 'block', box: { x: 40, y: 120, w: 600, h: 60 }, text: 'A long headline that must not be cut to fifty characters because the plugin carries the full text of the page.', type: { color: 'rgb(0, 0, 0)', size: '48px', weight: '700', family: 'Georgia', lineHeight: '56px', align: 'left' } },
    { tag: 'img', display: 'block', box: { x: 700, y: 100, w: 600, h: 400 }, src: 'https://x.test/hero.png', alt: 'Hero' } ] },
  { tag: 'footer', display: 'grid', grid: { columns: '1fr 1fr', gap: '16px 32px' }, box: { x: 0, y: 580, w: 1440, h: 200 }, children: [{ tag: 'div', display: 'block', box: { x: 0, y: 580, w: 700, h: 100 }, text: 'Col', type: { color: 'rgb(0,0,0)', size: '14px', weight: '400', family: 'Inter', align: 'left' } }] },
] };

test('layout tree → Figma frames: flex becomes auto layout with its gap, plain stacked children become a vertical auto layout, full text kept, images carry their source', () => {
  const f = treeToFigma(tree); assert.equal(f.type, 'FRAME'); assert.equal(f.layout.mode, 'VERTICAL'); assert.equal(f.layout.spacing, 0);
  const header = f.children[0]; assert.equal(header.layout.mode, 'HORIZONTAL'); assert.equal(header.layout.spacing, 24); assert.equal(header.layout.primary, 'SPACE_BETWEEN'); assert.deepEqual(header.layout.padding, [10, 40, 10, 40]); assert.equal(header.fill, '#111111');
  const hero = f.children[1]; assert.equal(hero.radius, 12); assert.equal(hero.children[0].type, 'TEXT'); assert.ok(hero.children[0].text.length > 90, 'full text'); assert.equal(hero.children[0].font.family, 'Georgia'); assert.equal(hero.children[1].type, 'IMAGE'); assert.equal(hero.children[1].src, 'https://x.test/hero.png');
  assert.equal(hero.children[0].x, 40); assert.equal(hero.children[0].y, 40, 'positions are relative to the parent');
  assert.equal(f.children[2].layout.wrap, true); assert.equal(f.children[2].layout.spacing, 32);
  assert.equal(treeToFigma(null), null);
});

test('hostile text, non-http image sources and font names are neutralised in the JSON', () => {
  const f = treeToFigma({ tag: 'body', box: { x: 0, y: 0, w: 10, h: 10 }, children: [{ tag: 'img', box: { x: 0, y: 0, w: 5, h: 5 }, src: 'javascript:alert(1)', alt: '<script>' }, { tag: 'p', box: { x: 0, y: 0, w: 5, h: 5 }, text: 'x\u0001y', type: { family: 'Evil"; }<x>', size: '9999px', weight: '700', color: 'url(x)' } }] });
  assert.equal(f.children[0].src, null); assert.ok(/^[A-Za-z0-9 _-]+$/.test(f.children[1].font.family)); assert.ok(f.children[1].font.size <= 200); assert.equal(f.children[1].color, '#000000'); assert.ok(!/\u0001/.test(f.children[1].text));
});

test('the Figma plugin code builds frames, text and images against a mocked Figma API without throwing, and respects auto layout', async () => {
  const made = []; const mk = (kind) => { const n = { kind, children: [], appendChild(c) { this.children.push(c); }, resize(w, h) { this.width = w; this.height = h; } }; made.push(n); return n; };
  const posted = []; let handler = null; let closed = null;
  const figma = { showUI() {}, ui: { set onmessage(f) { handler = f; }, postMessage: (m) => posted.push(m) }, currentPage: mk('page'), createFrame: () => mk('frame'), createText: () => mk('text'), createRectangle: () => mk('rect'), loadFontAsync: async (f) => { if (f.family === 'Georgia') throw new Error('missing font'); }, createImageAsync: async () => ({ hash: 'h' }), closePlugin: (m) => { closed = m; } };
  vm.runInNewContext(PLUGIN_CODE, { figma, __html__: '<html>', Map, parseInt, String, Math });
  const doc = { name: 'home', root: treeToFigma(tree) };
  await handler({ type: 'import', docs: [doc] });
  assert.deepEqual(posted, [], JSON.stringify(posted)); assert.match(closed, /Imported 1/);
  const frames = made.filter((n) => n.kind === 'frame'), texts = made.filter((n) => n.kind === 'text'), rects = made.filter((n) => n.kind === 'rect');
  assert.ok(frames.length >= 4 && texts.length === 4 && rects.length === 1);
  const hdr = frames.find((n) => n.name === 'header'); assert.equal(hdr.layoutMode, 'HORIZONTAL'); assert.equal(hdr.itemSpacing, 24); assert.equal(hdr.primaryAxisAlignItems, 'SPACE_BETWEEN'); assert.equal(hdr.paddingLeft, 40);
  assert.equal(hdr.children[0].x, undefined, 'children of an auto-layout frame are not positioned by hand'); assert.equal(texts.find((n) => n.characters.startsWith('A long')).fontName.family, 'Inter', 'a missing font falls back to Inter');
  assert.equal(rects[0].fills[0].type, 'IMAGE'); assert.equal(frames.find((n) => n.name === 'footer').layoutWrap, 'WRAP');
  await handler({ type: 'import', docs: [{ root: { type: 'TEXT' } }] }); assert.ok(posted.length === 1 && /Failed/.test(posted[0].text), 'a broken file is reported, not thrown');
});

test('writeFigmaJson writes <slug>.figma.json; the plugin manifest is valid JSON with the files it needs', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-fj-'));
  try { assert.equal(writeFigmaJson({ title: 'T', url: 'https://x.test/', layout: { docWidth: 1440, docHeight: 1000, tree } }, 'home', d), true); const j = JSON.parse(fs.readFileSync(path.join(d, 'home.figma.json'), 'utf8')); assert.equal(j.root.h, 1000); assert.equal(writeFigmaJson({ layout: {} }, 'x', d), false); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  assert.equal(PLUGIN_MANIFEST.main, 'code.js'); assert.equal(PLUGIN_MANIFEST.ui, 'ui.html');
});
