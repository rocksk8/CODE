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
