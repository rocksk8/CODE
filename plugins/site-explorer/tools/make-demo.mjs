#!/usr/bin/env node
// Maintainer tool (not shipped to users): regenerates docs/demo/ (real output of the current version against the fictional fixture sites),
// docs/images/ (screenshots for the README) and docs/images/demo.gif.
//   node tools/make-demo.mjs            (needs: npm install --no-save three@0.170.0 ; devDependencies gifenc + pngjs)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import gifenc from 'gifenc';
const { PNG } = pngjs, { GIFEncoder, quantize, applyPalette } = gifenc;
import { launchBrowser } from '../scripts/launch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.resolve(root, '..', '..');
const docs = path.join(repo, 'docs'), demo = path.join(docs, 'demo'), images = path.join(docs, 'images');
const fx = (n) => fs.readFileSync(path.join(root, 'test', 'fixtures', n));
const threeDir = path.join(root, 'node_modules', 'three', 'build');
if (!fs.existsSync(path.join(threeDir, 'three.module.js'))) { console.error('needs: npm install --no-save three@0.170.0'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-demo-'));

// a 2 s clip recorded in the browser itself (no ffmpeg)
async function makeClip() {
  const b = await launchBrowser(); const p = await b.newPage();
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data); const done = new Promise((r) => (rec.onstop = r)); rec.start(); const t0 = performance.now();
    await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 2000; x.fillStyle = `hsl(${t * 360},70%,50%)`; x.fillRect(0, 0, 320, 180); x.fillStyle = '#fff'; x.fillRect(20 + t * 240, 70, 40, 40); t < 1 ? requestAnimationFrame(f) : res(); })(); });
    rec.stop(); await done; const buf = new Uint8Array(await new Blob(chunks).arrayBuffer()); let s = ''; for (const v of buf) s += String.fromCharCode(v); return btoa(s);
  });
  await b.close(); return Buffer.from(b64, 'base64');
}
const clip = await makeClip();
const listen = (srv, port) => new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv.address().port)));
const acme = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fx('studio.html')); });
const three = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (/^\/three\.(module|core)\.js$/.test(u)) { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(fs.readFileSync(path.join(threeDir, u))); }
  if (u === '/clip.webm') { r.writeHead(200, { 'content-type': 'video/webm', 'content-length': clip.length }); return r.end(clip); }
  if (u === '/robots.txt') { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fx('three-demo.html'));
});
const pa = await listen(acme, 4173), pt = await listen(three, 4174);

// async on purpose: the fixture servers live in THIS process and must keep answering while the child runs
function explore(url, name, extra = []) {
  const out = path.join(tmp, name);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'bin', 'site-explorer.mjs'), 'explore', url, '--out', out, '--max-pages', '1', '--wait', '2500', '--no-open', '--no-db', ...extra], { env: { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 'x.db') } });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    p.on('close', (status) => { if (status !== 0) { console.error(log); process.exit(1); } resolve(out); });
  });
}
console.log('exploring fixtures…');
const outAcme = await explore(`http://127.0.0.1:${pa}/`, 'acme', ['--no-motion']);
const outThree = await explore(`http://127.0.0.1:${pt}/`, 'three');
acme.close(); three.close();

// docs/demo: only what a visitor should open (dashboard + handoff); never the crawl internals
fs.rmSync(demo, { recursive: true, force: true });
for (const [name, out] of [['acme-studio', outAcme], ['three-demo', outThree]]) {
  fs.mkdirSync(path.join(demo, name), { recursive: true });
  fs.copyFileSync(path.join(out, 'dashboard.html'), path.join(demo, name, 'dashboard.html'));
  fs.cpSync(path.join(out, 'handoff'), path.join(demo, name, 'handoff'), { recursive: true });
  fs.rmSync(path.join(demo, name, 'handoff', 'media', 'states'), { recursive: true, force: true });
}
// the demo must not carry the maintainer's temp paths: show a neutral location instead
{ const swap = (dir, from) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) swap(f, from); else if (/\.(html|md|json|css|js|csv|svg)$/.test(f)) { const t = fs.readFileSync(f, 'utf8'); if (t.includes(from)) fs.writeFileSync(f, t.split(from).join('~/explore-out')); } } };
  swap(path.join(demo, 'acme-studio'), outAcme); swap(path.join(demo, 'three-demo'), outThree); swap(path.join(demo, 'acme-studio'), tmp); swap(path.join(demo, 'three-demo'), tmp); }
fs.writeFileSync(path.join(demo, 'README.md'), `# Demo output (fictional sites)

Real output of the current version against the fictional fixture sites in \`plugins/site-explorer/test/fixtures/\` (Acme Studio, and a WebGL + CSS-3D + video page). **Not an analysis of a real website.**
Regenerate with \`node plugins/site-explorer/tools/make-demo.mjs\`.

| Folder | What | Look at |
|---|---|---|
| \`acme-studio/dashboard.html\` | single-file dashboard (double-click) | overview, design, layout, health, **Export for AI** tab, **Details** switch |
| \`acme-studio/handoff/\` | the handoff package for the marketing site | \`START-HERE.md\`, \`PROMPT.md\`, \`starter/index.html\` (runnable skeleton), \`ai-brief.md\`, \`SPEC.md\`, \`media/sections/\` |
| \`three-demo/dashboard.html\` | dashboard with WebGL, CSS 3D and video | "3D／動畫" tab (frame player), live motion preview on the overview |
| \`three-demo/handoff/\` | handoff with motion | \`starter/motion/index.html\` (every animation running next to its filmstrip), \`motion.md\`, \`media/motion/*-filmstrip.png\` |

---

# Demo 輸出（虛構網站）

用目前版本對 \`test/fixtures/\` 內的**虛構網站**實際跑出來的結果；**不是真實網站的分析**。重新產生：\`node plugins/site-explorer/tools/make-demo.mjs\`。
`);

// ---- screenshots + GIF
fs.mkdirSync(images, { recursive: true });
const b = await launchBrowser();
const shots = [];
const snap = async (page, name, w = 1360, h = 880) => { const f = path.join(images, name); await page.screenshot({ path: f }); shots.push(f); return f; };
{
  const p = await b.newPage({ viewport: { width: 1360, height: 880 } });
  await p.goto('file://' + path.join(demo, 'acme-studio', 'dashboard.html')); await p.waitForTimeout(900);
  await snap(p, 'dashboard-overview.png');
  await p.click('#tabs button[data-k=export]'); await p.waitForTimeout(300); await snap(p, 'dashboard-export.png');
  await p.check('#dtsw'); await p.click('#tabs button[data-k=data]'); await p.waitForTimeout(300); await snap(p, 'dashboard-detail.png'); await p.uncheck('#dtsw');
  await p.click('#tabs button[data-k=health]'); await p.waitForTimeout(300); await snap(p, 'dashboard-health.png');
  await p.click('#tabs button[data-k=design]'); await p.waitForTimeout(300); await snap(p, 'dashboard-design.png');
  await p.close();
  const q = await b.newPage({ viewport: { width: 1360, height: 880 } });
  await q.goto('file://' + path.join(demo, 'three-demo', 'dashboard.html')); await q.waitForTimeout(900);
  await q.waitForTimeout(700); { const f = path.join(images, 'dashboard-motion-preview.png'); await q.locator('.live').locator('xpath=..').screenshot({ path: f }); shots.push(f); }
  await q.click('#tabs button[data-k=motion]'); await q.waitForTimeout(500); await snap(q, 'dashboard-motion.png');
  await q.close();
}
// reference vs rebuilt starter, side by side
{
  const handoff = path.join(demo, 'acme-studio', 'handoff');
  const srv = http.createServer((q, r) => { const f = path.join(handoff, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); return r.end(fs.readFileSync(f)); } r.writeHead(404); r.end(); });
  const port = await listen(srv, 0);
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`http://127.0.0.1:${port}/starter/index.html`); await p.waitForTimeout(500);
  const rebuilt = path.join(tmp, 'rebuilt.png'); await p.screenshot({ path: rebuilt, fullPage: true }); await p.close(); srv.close();
  const ref = path.join(handoff, 'media', 'pages', 'home-desktop.png');
  const c = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const img = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  await c.setContent(`<body style="margin:0;background:#0f1115;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:28px;padding:24px;align-items:flex-start;justify-content:center"><figure style="margin:0;width:620px"><div style="padding:0 0 10px">1 · Original page (reference screenshot)</div><div style="height:760px;overflow:hidden;border-radius:10px;border:1px solid #333"><img style="width:100%;display:block" src="${img(ref)}"></div></figure><figure style="margin:0;width:620px"><div style="padding:0 0 10px">2 · Generated starter/index.html (placeholder copy)</div><div style="height:760px;overflow:hidden;border-radius:10px;border:1px solid #333;background:#fff"><img style="width:100%;display:block" src="${img(rebuilt)}"></div></figure></div></body>`);
  await c.waitForTimeout(300); const f = path.join(images, 'starter-vs-original.png'); await c.screenshot({ path: f }); shots.push(f); await c.close();
}
await b.close();

// GIF: overview → design → export → health (readable at README width)
{
  const frames = ['dashboard-overview.png', 'dashboard-design.png', 'dashboard-export.png', 'dashboard-detail.png', 'dashboard-health.png', 'starter-vs-original.png'];
  const W = 900; const gif = GIFEncoder();
  for (const name of frames) {
    const png = PNG.sync.read(fs.readFileSync(path.join(images, name)));
    const H = Math.round((png.height * W) / png.width); const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // box-ish downscale (nearest of an averaged 2x2 block is enough for UI screenshots)
      const sx = Math.min(png.width - 1, Math.floor((x * png.width) / W)), sy = Math.min(png.height - 1, Math.floor((y * png.height) / H)), s = (sy * png.width + sx) * 4, d = (y * W + x) * 4;
      data[d] = png.data[s]; data[d + 1] = png.data[s + 1]; data[d + 2] = png.data[s + 2]; data[d + 3] = 255;
    }
    const palette = quantize(data, 256); gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay: 2200 });
  }
  gif.finish(); fs.writeFileSync(path.join(images, 'demo.gif'), Buffer.from(gif.bytes()));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('done:\n' + [...shots, path.join(images, 'demo.gif')].map((f) => '  ' + path.relative(repo, f) + ' ' + Math.round(fs.statSync(f).size / 1024) + ' KB').join('\n'));
