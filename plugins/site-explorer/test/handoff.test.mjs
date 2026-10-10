// Handoff package: what an AI needs to design from, and what the next developer needs to know.
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
const fx = (n) => fs.readFileSync(path.join(root, 'test', 'fixtures', n), 'utf8');
const threeDir = path.join(root, 'node_modules', 'three', 'build'), haveThree = fs.existsSync(path.join(threeDir, 'three.module.js'));
let server, port, tmp, clip, haveBrowser = true, H1, H2, siteDir;
const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 150000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
// every `media/...` path mentioned in the docs must exist inside the handoff folder (a package that stands alone)
const danglingRefs = (dir) => [...new Set(['SPEC.md', 'ai-brief.md', 'motion.md', 'README.md'].filter((f) => fs.existsSync(path.join(dir, f))).flatMap((f) => [...read(dir, f).matchAll(/`((?:media|tokens)\/[^`\s]+)`/g)].map((m) => m[1])))].filter((r) => !fs.existsSync(path.join(dir, r)));

before(async () => {
  let b; try { b = await launchBrowser(); } catch { haveBrowser = false; }
  if (!haveBrowser) return;
  if (haveThree) { // browser-recorded test video
    const p = await b.newPage();
    const b64 = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm;codecs=vp8' }), ch = []; rec.ondataavailable = (e) => ch.push(e.data); const done = new Promise((r) => (rec.onstop = r)); rec.start(); const t0 = performance.now(); await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 2000; x.fillStyle = `hsl(${t * 360},70%,50%)`; x.fillRect(0, 0, 320, 180); t < 1 ? requestAnimationFrame(f) : res(); })(); }); rec.stop(); await done; const buf = new Uint8Array(await new Blob(ch).arrayBuffer()); let s = ''; for (const v of buf) s += String.fromCharCode(v); return btoa(s); });
    clip = Buffer.from(b64, 'base64');
  }
  await b.close();
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0], send = (t, body) => { res.writeHead(200, { 'content-type': t }); res.end(body); };
    if (/^\/three\.(module|core)\.js$/.test(u)) return send('text/javascript', fs.readFileSync(path.join(threeDir, u)));
    if (u === '/clip.webm') return send('video/webm', clip);
    if (u === '/3d') return send('text/html; charset=utf-8', fx('three-demo.html'));
    if (u === '/robots.txt') { res.writeHead(404); return res.end(); }
    send('text/html; charset=utf-8', fx('studio.html'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se handoff-'));
  const base = `http://127.0.0.1:${port}`, host = `127.0.0.1_${port}`;
  await run('crawl.mjs', [base + '/', '--max-pages', '1', '--out', path.join(tmp, 'a')]); siteDir = path.join(tmp, 'a', host);
  await run('export-design.mjs', [siteDir]); await run('health-check.mjs', ['--site', siteDir, '--no-link-check']);
  assert.equal((await run('build-handoff.mjs', ['--site', siteDir, '--out', path.join(tmp, 'h1')])).status, 0); H1 = path.join(tmp, 'h1');
  if (haveThree) {
    await run('crawl.mjs', [base + '/3d', '--max-pages', '1', '--out', path.join(tmp, 'c')]);
    await run('capture-3d.mjs', [base + '/3d', '--out', path.join(tmp, 'm'), '--frames', '8', '--wait', '2500', '--no-video']);
    const r = await run('build-handoff.mjs', ['--site', path.join(tmp, 'c', host), '--motion', path.join(tmp, 'm', host), '--out', path.join(tmp, 'h2')]); assert.equal(r.status, 0, r.out); H2 = path.join(tmp, 'h2');
  }
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const skip = (t, three = false) => (!haveBrowser ? (t.skip('no browser'), true) : three && !haveThree ? (t.skip('three not installed'), true) : false);

test('package has every document, and nothing references a file that is not inside it', (t) => {
  if (skip(t)) return;
  for (const f of ['README.md', 'CLAUDE.md', 'ai-brief.md', 'SPEC.md', 'spec.json', 'DECISIONS.md', 'handoff.json', 'health.md', 'tokens/tokens.css', 'tokens/tokens.studio.json', 'tokens/palette.svg']) assert.ok(fs.existsSync(path.join(H1, f)), f);
  assert.deepEqual(danglingRefs(H1), []);
  assert.ok(fs.readdirSync(path.join(H1, 'media', 'sections', 'home')).length === 7, 'one crop per section');
  assert.ok(!read(H1, 'SPEC.md').includes(tmp) && !read(H1, 'ai-brief.md').includes(tmp), 'no machine-specific absolute paths leak into the docs');
});

test('ai-brief is compact and has what a designer-AI needs', (t) => {
  if (skip(t)) return;
  const b = read(H1, 'ai-brief.md');
  assert.ok(b.length < 12000, 'brief stays small enough to paste into a prompt: ' + b.length);
  for (const needle of ['風格一句話', '--color-brand: #5b4bff', '--font-heading: "Playfair Display", serif', '首頁骨架', '頁首 → ', '文案語氣', 'Sentence case', '一定要遵守', '請先檢視這些圖片', 'media/sections/home/02-hero.png', '已知限制']) assert.ok(b.includes(needle) || b.includes(needle.replace(' → ', '')), 'brief lacks: ' + needle);
  assert.ok(!/Times New Roman 若無授權/.test(b), 'system fonts are not offered as "substitute if unlicensed"');
  assert.match(b, /Design that moves people/, 'real content structure is in the brief');
});

test('SPEC.md is the full spec: tokens, components, sections with content, unknowns, build order', (t) => {
  if (skip(t)) return;
  const s = read(H1, 'SPEC.md');
  for (const h of ['## 1. 一眼看懂', '## 2. 資訊架構', '### 3.1 色彩', '### 3.2 字型', '### 3.6 無障礙：對比不足', '## 4. 元件', '## 5. 頁面規格', '## 9. 健檢摘要', '## 10. 重現建議', '## 11. 未知與限制', '## 12. 檔案索引']) assert.ok(s.includes(h), h);
  assert.match(s, /\| 功能／特色格 \|/); assert.match(s, /`h2` What we do/); assert.match(s, /Playfair Display \| Google Fonts（免費）/); assert.match(s, /Acme Sans \| 自架（可能需授權）/);
  assert.match(s, /區塊版型.*依 DOM 規則推測/); assert.match(s, /不要複製原站的文案/);
  const j = JSON.parse(read(H1, 'spec.json'));
  assert.equal(j.schemaVersion, 1); assert.equal(j.pages[0].sections.length, 7); assert.ok(j.unknowns.length >= 6); assert.ok(j.health.score > 0);
  assert.deepEqual(j.pages[0].sections.map((x) => x.kind), ['header', 'hero', 'features', 'pricing', 'testimonial', 'cta', 'footer']);
});

test('DECISIONS.md and CLAUDE.md make the package a living record', (t) => {
  if (skip(t)) return;
  const d = read(H1, 'DECISIONS.md'), c = read(H1, 'CLAUDE.md');
  assert.match(d, /## 待確認問題/); assert.match(d, /- \[ \] 區塊版型/); assert.match(d, /## 已做決策\n（尚無）/); assert.match(d, /未登入、未送出表單、未繞過驗證/);
  assert.match(c, /先讀 `ai-brief\.md`/); assert.match(c, /DECISIONS\.md.*新增一筆/); assert.match(c, /無法觀看影片或 3D/);
});

test('3D and video arrive as text + numbers + single-image filmstrips, with valid paths', (t) => {
  if (skip(t, true)) return;
  assert.deepEqual(danglingRefs(H2), []);
  const m = read(H2, 'motion.md'), b = read(H2, 'ai-brief.md'), j = JSON.parse(read(H2, 'spec.json'));
  assert.match(m, /AI 無法直接觀看/); assert.match(m, /media\/motion\/t0-filmstrip\.png/); assert.match(m, /ProductCube/);
  assert.match(b, /three\.js r\d+ 場景/); assert.match(b, /ProductCube/); assert.match(b, /影片規格：\d+\.\d 秒/);
  assert.equal(j.motion.targets.length, 2); assert.ok(j.motion.targets.every((x) => x.filmstrip && x.ai.description.length >= 3));
  assert.ok(fs.readdirSync(path.join(H2, 'media', 'motion')).length >= 3);
});

test('inventory.csv lists every page for the redesign, opens in a spreadsheet and cannot run formulas', (t) => {
  if (skip(t)) return;
  const c = read(H1, 'inventory.csv');
  assert.ok(c.startsWith('﻿'), 'BOM so Excel reads Chinese correctly');
  const lines = c.trim().split('\n'); assert.match(lines[0], /網址.*標題.*改版時請保留/);
  assert.ok(lines.length >= 2 && lines[1].includes(`http://127.0.0.1:${port}/`), lines[1]);
  assert.ok(!/(^|,)"[=+\-@]/m.test(lines.slice(1).join('\n')), 'no cell starts with a formula character');
});
