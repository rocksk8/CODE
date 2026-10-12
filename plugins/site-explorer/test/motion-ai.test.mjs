// AI-readable 3D / video: real three.js scene facts, video facts, single-image filmstrips, plain-language motion.md.
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
const threeDir = path.join(root, 'node_modules', 'three', 'build');
const haveThree = fs.existsSync(path.join(threeDir, 'three.module.js'));
let server, base, tmp, clip, haveBrowser = true, motionDir;

const run = (script, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 150000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});

before(async () => {
  let b; try { b = await launchBrowser(); } catch { haveBrowser = false; }
  if (!haveBrowser || !haveThree) { b?.close(); return; }
  // record a 2 s test video in the browser itself (no external ffmpeg needed)
  const p = await b.newPage();
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data); const done = new Promise((r) => (rec.onstop = r)); rec.start(); const t0 = performance.now();
    await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 2000; x.fillStyle = `hsl(${t * 360},70%,50%)`; x.fillRect(0, 0, 320, 180); x.fillStyle = '#fff'; x.fillRect(20 + t * 240, 70, 40, 40); t < 1 ? requestAnimationFrame(f) : res(); })(); });
    rec.stop(); await done; const buf = new Uint8Array(await new Blob(chunks).arrayBuffer()); let s = ''; for (const v of buf) s += String.fromCharCode(v); return btoa(s);
  });
  clip = Buffer.from(b64, 'base64'); await b.close();
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (/^\/three\.(module|core)\.js$/.test(u)) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(threeDir, u))); }
    if (u === '/clip.webm') { res.writeHead(200, { 'content-type': 'video/webm', 'content-length': clip.length }); return res.end(clip); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'test', 'fixtures', 'three-demo.html')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se motion-'));
  const r = await run('capture-3d.mjs', [base, '--out', path.join(tmp, 'm'), '--frames', '8', '--wait', '2500', '--no-video']);
  assert.equal(r.status, 0, r.out);
  motionDir = path.join(tmp, 'm', `127.0.0.1_${server.address().port}`);
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });

const report = () => JSON.parse(fs.readFileSync(path.join(motionDir, 'motion.json'), 'utf8'));
const skip = (t) => (!haveBrowser ? t.skip('no browser') : !haveThree ? t.skip('three not installed (npm install, not --omit=dev)') : false);

test('reads the three.js scene: objects, materials, camera, and which objects move', async (t) => {
  if (skip(t)) return;
  const w = report().targets.find((x) => x.kind === 'webgl'), th = w.ai.technique.three;
  assert.equal(th.scene.byType.Mesh, 2);
  assert.deepEqual(Object.keys(th.scene.geometries).sort(), ['BoxGeometry', 'TorusGeometry']);
  assert.ok(th.scene.materials.some((m) => m.type === 'MeshStandardMaterial' && m.colors.includes('#ff6633')));
  assert.equal(th.camera.type, 'PerspectiveCamera'); assert.equal(th.camera.fov, 50);
  assert.ok(th.moving.some((m) => m.name === 'ProductCube') && th.moving.some((m) => m.name === 'HaloRing'), JSON.stringify(th.moving));
  assert.ok(w.animatesOnItsOwn);
});

test('describes video as facts plus frames (AI cannot watch video)', async (t) => {
  if (skip(t)) return;
  const v = report().targets.find((x) => x.kind === 'video'), f = v.ai.technique.video;
  assert.ok(f.duration > 1.5 && f.duration < 2.6, 'duration ' + f.duration);
  assert.equal(f.videoWidth, 320); assert.ok(f.autoplay && f.loop && f.muted);
  for (const i of [0, 1, 2, 3]) assert.ok(fs.existsSync(path.join(motionDir, 'frames', v.id, `video-${i}.png`)), `video frame ${i}`);
});

test('every target has a single-image filmstrip, and a plain-language motion.md anchors it to the page', async (t) => {
  if (skip(t)) return;
  for (const x of report().targets) {
    const f = path.join(motionDir, x.filmstrip); assert.ok(fs.existsSync(f), x.filmstrip);
    const png = fs.readFileSync(f); assert.equal(png.readUInt32BE(16), 1500, 'filmstrip is a fixed-width sheet an AI can view in one go');
  }
  const md = fs.readFileSync(path.join(motionDir, 'motion.md'), 'utf8');
  assert.match(md, /AI 無法直接觀看 3D、影片或動畫/);
  assert.match(md, /位於「Our product in 3D」區塊/); assert.match(md, /three r\d+/); assert.match(md, /ProductCube/);
  assert.match(md, /影片規格：\d+\.\d 秒，320×180，自動播放、循環、靜音/);
  assert.doesNotMatch(md, /precision highp|#define/, 'no library shader boilerplate');
  assert.ok(!/載入模型／素材/.test(md), 'video is not mislabelled as a 3D model');
});
