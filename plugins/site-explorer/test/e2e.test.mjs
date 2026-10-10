// End-to-end: local fixture site -> explore pipeline -> database -> dashboard.   npm test
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
const script = (n) => path.join(root, 'scripts', n);

const HOME = `<!doctype html><html lang="en"><head><title>Fixture</title><meta name="generator" content="WordPress 6.5">
<style>:root{--brand:#e4572e}body{font-family:Georgia;margin:0;background:#fff;color:#222}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}@media(max-width:768px){.grid{grid-template-columns:1fr!important}}
header{display:flex;gap:16px;padding:16px;background:#111;color:#fff}header a{color:#fff}.btn{background:#e4572e;color:#fff;border:0;border-radius:8px;padding:12px 24px;font:600 16px Arial}.btn:hover{background:#c0431f}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px}.card{border-radius:8px;box-shadow:0 2px 6px #0003;padding:16px}
.scene{perspective:600px;width:200px;height:200px;margin:40px}.cube{width:100%;height:100%;position:relative;transform-style:preserve-3d;animation:spin 4s linear infinite}.cube div{position:absolute;width:200px;height:200px;background:rgba(228,87,46,.7)}.f{transform:translateZ(100px)}.b{transform:rotateY(180deg) translateZ(100px)}@keyframes spin{to{transform:rotateY(360deg)}}canvas{display:block;width:300px;height:200px;margin:40px}</style></head>
<body><header><nav><a href="/about">About</a> <a href="/blocked">Members</a></nav></header><h1>Hello</h1><p>This fixture paragraph is long enough to be counted as content.</p><button class="btn">Get started</button>
<div class="grid"><div class="card">A</div><div class="card">B</div><div class="card">C</div></div>
<div class="scene"><div class="cube"><div class="f"></div><div class="b"></div></div></div><canvas id="gl" width="300" height="200"></canvas>
<script>const gl=document.getElementById('gl').getContext('webgl');const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);return o};const p=gl.createProgram();
gl.attachShader(p,sh(gl.VERTEX_SHADER,'attribute vec2 a;uniform float t;void main(){float c=cos(t),s=sin(t);gl_Position=vec4(mat2(c,-s,s,c)*a,0.,1.);}'));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,'void main(){gl_FragColor=vec4(1.,.4,.2,1.);}'));gl.linkProgram(p);gl.useProgram(p);
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.6,-.6,.6,-.6,0,.6]),gl.STATIC_DRAW);const l=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);const u=gl.getUniformLocation(p,'t');
(function f(t){gl.clearColor(.1,.1,.15,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(u,t/600);gl.drawArrays(gl.TRIANGLES,0,3);requestAnimationFrame(f)})(0)</script></body></html>`;

let server, base, tmp, haveBrowser = true;
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  server = http.createServer((req, res) => {
    if (req.url === '/blocked') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<title>Just a moment...</title><p>Verify you are human</p>'); }
    if (req.url === '/about') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>About</title><main><h1>About</h1><p>About page paragraph that is long enough to count.</p></main>'); }
    if (req.url === '/robots.txt') { res.writeHead(200); return res.end('User-agent: *\nDisallow: /private\n'); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(HOME);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-test-'));
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const env = () => ({ ...process.env, SITE_EXPLORER_DB: path.join(tmp, 'test.db') });
// async on purpose: the fixture server lives in this process and must keep serving while the child runs
const node = (script_, args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script(script_), ...args], { env: env() });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => p.kill(), 240000);
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});

test('doctor passes basic checks', { skip: !haveBrowser && 'no browser' }, async () => {
  const r = await node('doctor.mjs', [base]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /瀏覽器/);
});

test('explore pipeline produces all artifacts', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const out = path.join(tmp, 'out');
  const r = await node('explore.mjs', [base, '--max-pages', '4', '--out', out, '--wait', '1500']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const host = new URL(base).host.replace(/[^a-z0-9.-]/gi, '_');
  assert.match(fs.readFileSync(path.join(out, 'ABOUT-THIS-FOLDER.md'), 'utf8'), /這是什麼資料夾/); assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'runs.json'), 'utf8'))[0].host, new URL(base).host.replace(/[^a-z0-9.-]/gi, '_'));
  const site = JSON.parse(fs.readFileSync(path.join(out, 'site', host, 'site.json'), 'utf8'));
  assert.equal(site.schemaVersion, 3);
  assert.ok(site.editing.platforms.some((p) => p.platform === 'WordPress'), 'detects WordPress via generator meta');
  assert.ok(site.blockedPages.some((b) => /403|驗證/.test(b.reason)), 'flags the blocked page');
  assert.ok(!site.pages.some((p) => p.url.includes('/private')), 'respects robots');
  const bundle = path.join(out, 'site', host, 'design-bundle');
  const tok = JSON.parse(fs.readFileSync(path.join(bundle, 'tokens.json'), 'utf8'));
  assert.equal(tok.color.brand, '#e4572e');
  for (const f of ['tokens.css', 'tokens.w3c.json', 'tailwind.config.js', 'README.md']) assert.ok(fs.existsSync(path.join(bundle, f)), f);
  JSON.parse(fs.readFileSync(path.join(bundle, 'tokens.w3c.json'), 'utf8'));
  // the new stages of the pipeline: health check + handoff package
  const health = JSON.parse(fs.readFileSync(path.join(out, 'site', host, 'health.json'), 'utf8'));
  assert.ok(health.score >= 0 && health.score <= 100 && health.issues.length > 0, 'health check ran');
  for (const f of ['ai-brief.md', 'SPEC.md', 'spec.json', 'DECISIONS.md', 'CLAUDE.md', 'motion.md', 'health.md']) assert.ok(fs.existsSync(path.join(out, 'handoff', f)), 'handoff/' + f);
  const motion = JSON.parse(fs.readFileSync(path.join(out, 'motion', host, 'motion.json'), 'utf8'));
  const kinds = motion.targets.map((x) => x.kind);
  assert.ok(kinds.includes('webgl') && kinds.includes('css-3d'), 'finds WebGL and CSS 3D: ' + kinds);
  assert.ok(motion.targets.every((x) => x.animatesOnItsOwn), 'both animate by themselves');

  // dashboard renders without script errors and shows the blocked warning
  const b = await launchBrowser(); const page = await b.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(out, 'dashboard.html'));
  for (const k of ['overview', 'design', 'layout', 'content', 'motion', 'edit', 'history', 'about']) { const tab = page.locator(`#tabs button[data-k=${k}]`); if (await tab.count()) await tab.click(); }
  assert.deepEqual(errs, []);
  assert.match(await page.locator('#s-overview').innerText(), /被擋住/);
  const about = await page.locator('#s-about').innerText(); assert.ok(about.includes(out) && /SITE_EXPLORER_OUT/.test(about) && /site-explorer/.test(about) && /127\.0\.0\.1/.test(about), 'about tab shows output location, env var, rerun command and runs');
  await b.close();
});

test('database: second run yields history and search works', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const host = new URL(base).host;
  const out = path.join(tmp, 'out2');
  const r = await node('explore.mjs', [base, '--max-pages', '2', '--no-motion', '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const hist = await node('db.mjs', ['history', host]);
  if (/Node ≥ 22/.test(hist.stderr)) return t.skip('node:sqlite unavailable');
  assert.match(hist.stdout, new RegExp(host.replace('.', '\\.')));
  assert.equal((hist.stdout.match(/^#\d+/gm) || []).length, 2, hist.stdout);
  assert.doesNotMatch(hist.stdout, /3D／動畫元素數/, 'a --no-motion run must not read as "3D elements disappeared"');
  assert.match((await node('db.mjs', ['search', '--platform', 'WordPress'])).stdout, new RegExp(host.replace('.', '\\.')));
  assert.match((await node('db.mjs', ['search', '--color', '#e5582f'])).stdout, /e4572e/);
  assert.match((await node('db.mjs', ['search', '--font', 'nonexistent'])).stdout, /沒有符合/);
});
