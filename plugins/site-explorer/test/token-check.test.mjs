import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deltaE2000, rgbToLab, clusterColors, colorDistance } from '../scripts/color-science.mjs';
import { parseTokenFile, checkTokens, parseColor, parseLength, renderTokenCheckMd } from '../scripts/token-check.mjs';
import { computeVerdicts } from '../scripts/verdicts.mjs';

test('CIEDE2000 matches the published reference pairs (Sharma, Wu & Dalal 2005)', () => {
  const cases = [[[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 2.5, 0], [73, 25, -18], 27.1492], [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644], [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0], [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]];
  for (const [a, b, want] of cases) assert.ok(Math.abs(deltaE2000(a, b) - want) < 0.001, `${a} vs ${b}: ${deltaE2000(a, b)} != ${want}`);
  assert.ok(colorDistance({ r: 255, g: 255, b: 255 }, { r: 254, g: 254, b: 254 }) < 1); assert.ok(colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) > 99);
  assert.deepEqual(rgbToLab({ r: 0, g: 0, b: 0 }).map((x) => Math.round(x)), [0, 0, 0]);
});

test('clustering merges look-alike colours, keeps different ones, and does not drift along a gradient', () => {
  const c = (r, g, b, w) => ({ rgb: { r, g, b }, weight: w });
  const out = clusterColors([c(255, 255, 255, 10), c(254, 254, 254, 3), c(253, 253, 253, 1), c(0, 0, 0, 5), c(226, 121, 77, 4)], 2);
  assert.equal(out.length, 3); const white = out.find((g) => g.rep.rgb.r === 255); assert.equal(white.members.length, 3); assert.equal(white.weight, 14);
  const ramp = Array.from({ length: 40 }, (_, i) => c(i * 6, i * 6, i * 6, 40 - i)); const g = clusterColors(ramp, 2);
  assert.ok(g.length > 3, 'a long gradient is several colours, not one chain: ' + g.length);
  for (const grp of g) for (const m of grp.members) assert.ok(colorDistance(m.rgb, grp.rep.rgb) <= 2.0001, 'every member is close to its own representative');
});

const DTCG = JSON.stringify({ color: { $type: 'color', brand: { primary: { $value: '#e2794d' }, blue: { $value: { colorSpace: 'srgb', components: [0.26, 0.71, 0.88] } } }, ink: { $value: 'rgb(22, 24, 29)' } }, radius: { $type: 'dimension', sm: { $value: '4px' }, md: { $value: '0.5rem' } }, font: { size: { $type: 'fontSize', body: { $value: '16px' }, h1: { $value: { value: 2, unit: 'rem' } } } }, ignored: { $type: 'duration', fast: { $value: '100ms' } } });
test('token file: DTCG colours (hex, rgb(), components), radii and font sizes are read; garbage is refused', () => {
  const t = parseTokenFile(DTCG);
  assert.deepEqual(t.colors.map((x) => x.name), ['color.brand.primary', 'color.brand.blue', 'color.ink']); assert.deepEqual(t.radii.map((x) => x.px), [4, 8]); assert.deepEqual(t.fontSizes.map((x) => x.px), [16, 32]);
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204 }); assert.equal(parseColor('hotpink'), null); assert.equal(parseLength('1.5rem'), 24); assert.equal(parseLength('12'), 12); assert.equal(parseLength('calc(1px)'), null);
  for (const bad of ['', '{', '[]', '{"a":1}', '{"x":{"$value":"10ms","$type":"duration"}}']) assert.throws(() => parseTokenFile(bad), undefined, bad);
});

test('conformance: near colours count as matching, off-token values are listed with the nearest token, the percentage and the gate follow', () => {
  const t = parseTokenFile(DTCG);
  const design = { palette: [{ hex: '#e2794d', uses: 6 }, { hex: '#e3794e', uses: 2 }, { hex: '#14b8a6', uses: 4 }, { hex: '#16181d', uses: 8 }], radius: ['4px', '8px', '10px', '0px', 'calc(1px)'], typography: { sizesObserved: [16, 32, 18] } };
  const r = checkTokens(t, design);
  assert.equal(r.colors.on, 16); assert.equal(r.colors.total, 20); assert.equal(r.colors.off[0].value, '#14b8a6'); assert.ok(r.colors.off[0].nearest.delta > 2);
  assert.equal(r.radii.total, 3); assert.equal(r.radii.on, 2); assert.equal(r.radii.off[0].value, '10px'); assert.equal(r.fontSizes.off[0].value, '18px');
  assert.equal(r.offPct, +(100 * (4 + 1 + 1) / (20 + 3 + 3)).toFixed(1));
  const md = renderTokenCheckMd(r, { maxOff: 10 }); assert.match(md, /#14b8a6/); assert.match(md, /10px/);
  assert.equal(checkTokens(parseTokenFile('{"c":{"$type":"color","a":{"$value":"#ffffff"}}}'), { palette: [{ hex: '#ffffff', uses: 1 }] }).offPct, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-tc-'));
  try { fs.writeFileSync(path.join(dir, 'token-check.json'), JSON.stringify({ ...r, failed: false })); const v = computeVerdicts(dir).find((x) => x.id === 'tokens'); assert.ok(v && v.status === 'bad', 'a quarter off-token is red'); fs.writeFileSync(path.join(dir, 'token-check.json'), JSON.stringify({ offPct: 3, failed: false })); assert.equal(computeVerdicts(dir).find((x) => x.id === 'tokens').status, 'ok'); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
test('explore --tokens writes token-check.md; --max-off-token exits 4 when exceeded and 0 when not; bad files are refused up front', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const site = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title><meta name="description" content="A page for the token check test."><style>body{font:16px Georgia;color:#16181d;background:#fff}.b{background:#14b8a6;color:#fff;border-radius:10px;padding:8px}</style></head><body><h1>Hello</h1><p>${'Some words. '.repeat(20)}</p><a class="b" href="/x">Go</a></body></html>`); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-tcx-'));
  const tf = path.join(dir, 'tokens.json'); fs.writeFileSync(tf, DTCG);
  const go = (extra, out) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, 'explore', url, ...extra, '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--no-db', '--max-pages', '1', '--lang', 'en', '--out', path.join(dir, out)], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
  try {
    const a = await go(['--tokens', tf], 'a'); assert.equal(a.status, 0, a.out); assert.match(a.out, /Design-system conformance/);
    const siteDir = path.join(dir, 'a', 'site', fs.readdirSync(path.join(dir, 'a', 'site'))[0]); const j = JSON.parse(fs.readFileSync(path.join(siteDir, 'token-check.json'), 'utf8')); assert.ok(j.offPct > 0 && j.colors.off.some((o) => o.value === '#14b8a6'), JSON.stringify(j.colors)); assert.match(fs.readFileSync(path.join(siteDir, 'token-check.md'), 'utf8'), /14b8a6/);
    const dashHtml = fs.readFileSync(path.join(dir, 'a', 'dashboard.html'), 'utf8'); assert.match(dashHtml, /"tokenCheck":\{/, 'the dashboard carries the conformance result'); assert.match(dashHtml, /Design-system conformance/, 'and has the card for it');
    const b = await go(['--tokens', tf, '--max-off-token', '1'], 'b'); assert.equal(b.status, 4, b.out);
    const c = await go(['--tokens', tf, '--max-off-token', '100'], 'c'); assert.equal(c.status, 0, c.out);
    for (const [extra, re] of [[['--tokens', path.join(dir, 'missing.json')], /--tokens/], [['--tokens', path.join(dir, 'x.json')], /--tokens/], [['--max-off-token', '5'], /--tokens/], [['--tokens', tf, '--max-off-token', '150'], /0/]]) { if (extra[1].endsWith('x.json')) fs.writeFileSync(extra[1], '{"nothing":true}'); const r = await go(extra, 'd'); assert.equal(r.status, 1, extra.join(' ') + '\n' + r.out); assert.match(r.out, re); }
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
