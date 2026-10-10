// Designer workbench: pattern recognition, inspector, contrast, fonts, motion, grid, icons, exports, compare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const studio = fs.readFileSync(path.join(root, 'test', 'fixtures', 'studio.html'), 'utf8');
let server, base, tmp, haveBrowser = true, siteDir;

const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 't.db') } });
  let out = ''; const kill = setTimeout(() => p.kill(), 100000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});

before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); const f = (n) => fs.readFileSync(path.join(root, 'test', 'fixtures', n), 'utf8');
    res.end(req.url === '/other' ? '<title>Other</title><h1>Other</h1><p>Plain page without much design at all here.</p>' : req.url === '/blog' ? f('blog.html') : req.url === '/app' ? f('app.html') : studio); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se designer-'));
  if (haveBrowser) {
    const r = await run('crawl.mjs', [base + '/', '--max-pages', '1', '--out', path.join(tmp, 'a')]);
    assert.equal(r.status, 0, r.out);
    siteDir = path.join(tmp, 'a', `127.0.0.1_${server.address().port}`);
    await run('export-design.mjs', [siteDir]);
  }
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const page = () => JSON.parse(fs.readFileSync(path.join(siteDir, 'pages', 'home', 'page.json'), 'utf8')).designer;
const site = () => JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));

test('recognises the page pattern sequence', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  assert.deepEqual(page().blocks.map((b) => b.kind), ['header', 'hero', 'features', 'pricing', 'testimonial', 'cta', 'footer']);
});

test('finds real-background contrast failures (not just body text)', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const f = site().designer.contrast.failing;
  assert.ok(f.some((x) => x.fg === '#9a9aa8' && x.bg === '#ffffff' && x.ratio < 3), JSON.stringify(f));
  assert.ok(f.some((x) => x.bg === '#1f1f2e'), 'light-on-dark failure measured against the composited dark card');
});

test('extracts motion tokens, grid, fonts and icons', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const d = site().designer;
  assert.ok(d.motion.transitions.some((m) => /250ms cubic-bezier/.test(m.token)));
  assert.ok(d.grid.containerWidths.some((w) => w.px === 1120) && d.grid.columns.some((c) => c.columns === 3));
  assert.deepEqual(d.fonts.googleFamilies.sort(), ['Inter', 'Playfair Display']);
  assert.equal(d.icons.length, 3);
  assert.match(d.icons[0].svg, /stroke="rgb\(/, 'page CSS is baked into the standalone SVG');
});

test('design bundle: roles, font sources, Figma and palette exports', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const b = path.join(siteDir, 'design-bundle'), tok = JSON.parse(fs.readFileSync(path.join(b, 'tokens.json'), 'utf8'));
  assert.equal(tok.color.text, '#14141f', 'text colour comes from real paragraphs, not the most frequent colour');
  assert.equal(tok.color.brand, '#5b4bff');
  const src = Object.fromEntries(tok.typography.sources.map((s) => [s.family, s]));
  assert.equal(src['Playfair Display'].provider, 'google');
  assert.equal(src['Acme Sans'].provider, 'self-hosted');
  const ts = JSON.parse(fs.readFileSync(path.join(b, 'tokens.studio.json'), 'utf8'));
  assert.equal(ts.global.color.brand.type, 'color');
  assert.match(fs.readFileSync(path.join(b, 'palette.svg'), 'utf8'), /<svg[\s\S]*#5b4bff/);
});

test('dashboard: inspector, slices, skeleton, side-by-side, designer cards', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const dash = path.join(tmp, 'dash board.html');
  const r = await run('build-report.mjs', ['--site', siteDir, '--out', dash]); assert.equal(r.status, 0, r.out);
  const b = await launchBrowser(), p = await b.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + dash);
  await p.click('#tabs button[data-k=layout]'); await p.waitForTimeout(400);
  assert.ok(await p.locator('#ov .ib').count() > 10, 'inspector boxes rendered');
  const img = await p.evaluate(() => { const i = document.getElementById('shotimg').getBoundingClientRect(), o = document.getElementById('ov').getBoundingClientRect(); return [Math.abs(i.width - o.width), Math.abs(i.height - o.height)]; });
  assert.ok(img[0] < 1.5 && img[1] < 1.5, 'overlay is aligned with the screenshot: ' + img);
  const box = await p.evaluate(() => { const i = document.getElementById('shotimg').getBoundingClientRect(); return { x: i.x + i.width * (230 / 1440), y: i.y + i.height * (200 / document.getElementById('shotimg').naturalHeight) }; });
  await p.mouse.move(box.x, box.y); await p.waitForTimeout(150);
  assert.match(await p.locator('#insp').innerText(), /#14141f|#5b4bff|Playfair|Acme/);
  await p.click('[data-mode=slices]'); await p.waitForTimeout(300);
  assert.equal(await p.locator('.slice').count(), 7);
  assert.ok(await p.locator('.crop').first().evaluate((e) => e.style.backgroundImage.includes('desktop.png')));
  await p.click('[data-mode=skeleton]'); assert.match(await p.locator('#lbody').innerText(), /頁首.*主視覺 Hero.*功能／特色格.*價格方案/s);
  await p.click('[data-mode=side]'); assert.equal(await p.locator('[data-s]').count(), 3);
  await p.click('#tabs button[data-k=design]');
  const txt = await p.locator('#s-design').innerText();
  for (const needle of ['Google Fonts', '自架字型檔', '版面網格', '動態節奏', '真實背景上的對比檢查', '行內圖示', 'palette.svg']) assert.ok(txt.includes(needle), needle);
  await p.click('#tabs button[data-k=overview]');
  assert.match(await p.locator('#s-overview').innerText(), /版面組成/);
  assert.ok(await p.locator('.war .tile').count() === 4 && await p.locator('.war .led').count() === 1, 'war room rendered');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exp-md')]);
  assert.equal(dl.suggestedFilename(), 'design-reference.md');
  const md = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(md, /## 色彩/); assert.match(md, /## 版面/); assert.match(md, /頁首.*主視覺 Hero/s);
  assert.deepEqual(errs, []);
  await b.close();
});

test('compare report builds for two sites without script errors', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  await run('crawl.mjs', [base + '/other', '--max-pages', '1', '--out', path.join(tmp, 'b')]);
  const bDir = path.join(tmp, 'b', `127.0.0.1_${server.address().port}`), out = path.join(tmp, 'cmp page.html');
  const r = await run('compare-report.mjs', ['--a', siteDir, '--b', bDir, '--out', out]); assert.equal(r.status, 0, r.out);
  const b = await launchBrowser(), p = await b.newPage(), errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); await p.goto('file://' + out); await p.waitForTimeout(300);
  const txt = await p.locator('#root').innerText();
  assert.match(txt, /色彩角色/); assert.match(txt, /頁面骨架/); assert.match(txt, /數據對照/);
  assert.deepEqual(errs, []); await b.close();
});

test('pattern recognition does not hallucinate marketing sections on articles or app UIs', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const kinds = async (route, name) => {
    const out = path.join(tmp, name); await run('crawl.mjs', [base + route, '--max-pages', '1', '--no-screenshots', '--out', out]);
    const dir = path.join(out, `127.0.0.1_${server.address().port}`, 'pages'), slug = fs.readdirSync(dir)[0];
    return JSON.parse(fs.readFileSync(path.join(dir, slug, 'page.json'), 'utf8')).designer.blocks.map((b) => b.kind);
  };
  const blog = await kinds('/blog', 'blog'), app = await kinds('/app', 'app');
  assert.ok(!blog.includes('features') && !blog.includes('pricing'), 'article paragraphs are not feature cards: ' + blog);
  assert.ok(!app.includes('pricing') && !app.includes('features'), 'KPI numbers and tables are not pricing: ' + app);
});

test('standalone dashboard is one self-contained file (images and downloads inlined) with an audit trail', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const full = path.join(tmp, 'standalone-src.html');
  const r = await run('build-report.mjs', ['--site', siteDir, '--standalone', '--out', full]); assert.equal(r.status, 0, r.out);
  const lone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se lone ')), 'moved report.html'); // move it away from every other file
  fs.copyFileSync(full, lone);
  const b = await launchBrowser(), p = await b.newPage({ viewport: { width: 1280, height: 900 } }), errs = [], missing = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('requestfailed', (q) => missing.push(q.url().slice(0, 80)));
  await p.goto('file://' + lone);
  const ov = await p.locator('#s-overview').innerText();
  assert.match(ov, /探索紀錄（可稽核）/); assert.match(ov, /site-explorer-claude-plugin/); assert.match(ov, /未登入、未送出表單、未繞過驗證/);
  await p.click('#tabs button[data-k=layout]'); await p.waitForTimeout(400);
  assert.ok(await p.evaluate(() => { const i = document.getElementById('shotimg'); return i.complete && i.naturalWidth === 1440 && i.src.startsWith('data:image/png'); }), 'screenshot is inlined and renders');
  await p.click('#tabs button[data-k=design]');
  const hrefs = await p.locator('#s-design a[download]').evaluateAll((as) => as.map((a) => a.href.slice(0, 5)));
  assert.ok(hrefs.length >= 3 && hrefs.every((h) => h === 'data:'), 'design files are downloadable without the folder: ' + hrefs);
  assert.deepEqual(errs, []); assert.deepEqual(missing, []);
  await b.close();
  assert.ok(fs.statSync(lone).size < 6 * 1024 * 1024);
});
