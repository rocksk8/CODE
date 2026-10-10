#!/usr/bin/env node
// Detect and visually capture 3D / animated elements (WebGL canvas, three.js, model-viewer,
// CSS 3D transforms, Lottie, video): frame sequences over time, on scroll, and on mouse interaction,
// plus a screen recording, a motion report and an HTML contact sheet.
import { guardInternal } from './util.mjs';
import { launchBrowser } from './launch.mjs';
import { findUrl, intOpt, robotsBlocks } from './args.mjs';
import { threeHookInit, summarizeThreeInPage, analyzeFramesInBrowser, describeTarget, buildFilmstrip, renderMotionMd } from './motion-ai.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const url = findUrl(args);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
if (!url) { console.error('Usage: capture-3d.mjs <url> [--out DIR] [--frames 12] [--interval 250] [--max-targets 6] [--wait 2500] [--no-video]'); process.exit(1); }
const FRAMES = intOpt(args, 'frames', 12, { min: 1, max: 60 }), INTERVAL = intOpt(args, 'interval', 250, { min: 16, max: 5000 }), MAX = intOpt(args, 'max-targets', 6, { min: 1, max: 20 }), WAIT = intOpt(args, 'wait', 2500, { min: 0, max: 60000 });
const blockedBy = await robotsBlocks(url);
if (blockedBy) { console.error(`robots.txt 不允許存取此頁面（Disallow: ${blockedBy}），已依網站設定停止。`); process.exit(3); }
const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
const out = path.join(opt('out', './motion-report'), host);
fs.mkdirSync(out, { recursive: true });

const initScript = () => {
  const W = (window.__s3d = { contexts: [], shaders: [], rafCount: 0, libs: {}, lottie: false });
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = gc.call(this, type, ...rest);
    if (ctx) { this.dataset.s3dCtx = type; W.contexts.push(type); }
    return ctx;
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const ss = C.prototype.shaderSource;
    C.prototype.shaderSource = function (sh, src) { if (W.shaders.length < 12) W.shaders.push(String(src).slice(0, 1500)); return ss.call(this, sh, src); };
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { W.rafCount++; return raf.call(window, cb); };
};

const browser = await launchBrowser({
  headless: !args.includes('--headed'),
  args: args.includes('--headed') ? ['--ignore-gpu-blocklist', '--enable-webgl'] : ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'], // headed: let Chromium use the real GPU
});
let wantVideo = !args.includes('--no-video');
const newCtx = async (video) => {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(video ? { recordVideo: { dir: path.join(out, 'video'), size: { width: 1280, height: 800 } } } : {}),
  });
  await guardInternal(c, url);
  await c.addInitScript(initScript);
  await c.addInitScript(threeHookInit);
  return [c, await c.newPage()];
};
let ctx, page;
try { [ctx, page] = await newCtx(wantVideo); }
catch (e) {
  if (!wantVideo) throw e;
  console.warn('Video recording unavailable (ffmpeg missing: run `npx playwright install ffmpeg`); continuing with frames only.');
  wantVideo = false; [ctx, page] = await newCtx(false);
}
const assets3d = new Set();
page.on('response', (r) => { const u = r.url(); if (/\.(glb|gltf|obj|fbx|usdz|hdr|exr|ktx2?|basis|drc|splat|ply|riv|lottie)(\?|$)/i.test(u) || /lottie.*\.json|\/models?\/.*\.bin/i.test(u)) assets3d.add(u); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(WAIT);

// ---- detection ----
const detected = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 80 && r.height >= 80 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const sel = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
  const targets = [];
  let n = 0;
  const add = (el, kind, extra = {}) => {
    if (el.dataset.s3dId) return;
    el.dataset.s3dId = 't' + n++;
    const r = el.getBoundingClientRect();
    const lm = el.closest('header,nav,main,section,footer,aside,article');
    let context = { landmark: lm ? lm.tagName.toLowerCase() : undefined };
    for (let a = el, i = 0; a && a !== document.body && i < 12; a = a.parentElement, i++) { const h = a.querySelector('h1,h2,h3'); if (h && h.innerText.trim()) { context.heading = h.innerText.trim().slice(0, 80); break; } }
    context.position = +((r.y + scrollY) / Math.max(1, document.documentElement.scrollHeight)).toFixed(2);
    const ai = {};
    const anim = [el, ...el.querySelectorAll('*')].slice(0, 40).find((x) => getComputedStyle(x).animationName !== 'none');
    if (anim) {
      const cs = getComputedStyle(anim); ai.animation = `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction} ${cs.animationIterationCount}`;
      const nm = cs.animationName.split(',')[0].trim();
      for (const sh of document.styleSheets) { try { for (const rule of sh.cssRules) if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === nm) { ai.keyframesText = rule.cssText.slice(0, 700); } } catch {} }
    }
    if (el.tagName === 'VIDEO') ai.video = { duration: Number.isFinite(el.duration) ? el.duration : null, videoWidth: el.videoWidth, videoHeight: el.videoHeight, src: el.currentSrc || el.src, poster: el.poster || null, autoplay: el.autoplay, loop: el.loop, muted: el.muted, controls: el.controls, readyState: el.readyState };
    targets.push({ id: el.dataset.s3dId, kind, selector: sel(el), box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }, context, ...ai, ...extra });
  };
  document.querySelectorAll('canvas').forEach((c) => vis(c) && add(c, c.dataset.s3dCtx ? ({ webgl: 'webgl', webgl2: 'webgl', 'experimental-webgl': 'webgl', '2d': 'canvas2d', bitmaprenderer: 'canvas2d', webgpu: 'webgpu' })[c.dataset.s3dCtx] || 'canvas' : 'canvas', { glContext: c.dataset.s3dCtx || null, pixelSize: [c.width, c.height] }));
  document.querySelectorAll('model-viewer, spline-viewer, a-scene, lottie-player, dotlottie-player, rive-canvas').forEach((e) => vis(e) && add(e, e.tagName.toLowerCase(), { src: e.getAttribute('src') }));
  document.querySelectorAll('video').forEach((v) => vis(v) && add(v, 'video', { src: v.currentSrc, autoplay: v.autoplay, loop: v.loop }));
  document.querySelectorAll('svg').forEach((s) => vis(s) && s.querySelector('animate, animateTransform, animateMotion') && add(s, 'svg-smil'));
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    // skip nested duplicates: a 3D/animated element inside (or wrapping) an existing target is the same scene
    if (el.parentElement?.closest('[data-s3d-id]') || el.querySelector('[data-s3d-id]')) continue;
    if ((s.transformStyle === 'preserve-3d' || s.perspective !== 'none') && vis(el)) add(el, 'css-3d', { perspective: s.perspective, transformStyle: s.transformStyle, transform: s.transform !== 'none' ? s.transform : undefined });
    else if (s.animationName !== 'none' && vis(el)) add(el, 'css-animation', { animation: `${s.animationName} ${s.animationDuration} ${s.animationTimingFunction} ${s.animationIterationCount}` });
  }
  const keyframes = [];
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.type === CSSRule.KEYFRAMES_RULE) keyframes.push({ name: r.name, steps: [...r.cssRules].map((k) => k.keyText + '{' + k.style.cssText.slice(0, 160) + '}').slice(0, 6) }); } catch {} }
  const W = window.__s3d || {};
  const libs = {
    three: !!(window.THREE || window.__THREE__), threeRevision: window.__THREE__ || window.THREE?.REVISION || null,
    babylon: !!window.BABYLON, gsap: !!window.gsap, scrollTrigger: !!window.ScrollTrigger, lenis: !!window.Lenis, locomotive: !!window.LocomotiveScroll,
    lottie: !!window.lottie || !!window.bodymovin, aframe: !!window.AFRAME, pixi: !!window.PIXI, p5: !!window.p5, spline: !!document.querySelector('spline-viewer'), framerMotion: !!document.querySelector('[data-framer-appear-id],[data-projection-id]'),
    webgpu: W.contexts?.includes('webgpu'),
  };
  const scripts = [...document.scripts].map((s) => s.src).filter(Boolean).join(' ');
  for (const [k, re] of [['three', /three(\.module)?(\.min)?\.js|three@/i], ['gsap', /gsap/i], ['babylon', /babylon/i], ['spline', /spline/i], ['rive', /rive/i], ['lottie', /lottie|bodymovin/i], ['r3f', /react-three/i], ['theatre', /theatre/i]]) if (re.test(scripts)) libs[k + 'Script'] = true;
  return { targets, keyframes: keyframes.slice(0, 20), libs, contexts: W.contexts || [], shaders: W.shaders || [], rafCount: W.rafCount || 0, docHeight: document.documentElement.scrollHeight };
});
console.log(`Detected ${detected.targets.length} target(s); libs: ${Object.entries(detected.libs).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);

// prioritise real 3D over generic css-animation
const order = { webgl: 0, webgpu: 0, 'model-viewer': 0, 'spline-viewer': 0, 'a-scene': 0, 'css-3d': 1, canvas: 2, canvas2d: 3, 'lottie-player': 3, 'dotlottie-player': 3, 'rive-canvas': 3, video: 4, 'svg-smil': 5, 'css-animation': 6 };
const targets = detected.targets.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.box.w * b.box.h - a.box.w * a.box.h).slice(0, MAX);

const hash = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 10);
const sleep = (ms) => page.waitForTimeout(ms);
const pad = (i) => String(i).padStart(2, '0');
async function shoot(loc, file) { const buf = await loc.screenshot({ animations: 'allow', timeout: 8000 }); fs.writeFileSync(file, buf); return { h: hash(buf), buf }; }

// three.js facts (scene graph, camera, which objects move) — gathered once, attached to the main WebGL target
const threeInfo = await page.evaluate(summarizeThreeInPage).catch(() => null);
if (threeInfo) console.log(`three.js scene captured: ${threeInfo.scene.objects} objects, ${threeInfo.movingCount} moving`);

const buffers = {}; // target id -> { idle:[], hover:[], drag:[], video:[] } PNG buffers (for analysis + filmstrip)
for (const t of targets) {
  const dir = path.join(out, 'frames', t.id); fs.mkdirSync(dir, { recursive: true });
  const loc = page.locator(`[data-s3d-id="${t.id}"]`), B = (buffers[t.id] = { idle: [], hover: [], drag: [], video: [] });
  t.intervalMs = INTERVAL;
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 4000 }); await sleep(500);
    // 1. idle animation over time
    const idle = [];
    for (let i = 0; i < FRAMES; i++) { const r = await shoot(loc, path.join(dir, `idle-${pad(i)}.png`)); idle.push(r.h); B.idle.push(r.buf); await sleep(INTERVAL); }
    t.idleFrames = FRAMES; t.uniqueIdleFrames = new Set(idle).size; t.animatesOnItsOwn = t.uniqueIdleFrames > 1;
    // 2. mouse interaction: hover sweep, then drag (orbit-style)
    const bb = await loc.boundingBox();
    if (bb) {
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      for (let i = 0; i < 6; i++) { await page.mouse.move(bb.x + (bb.width * (i + 0.5)) / 6, cy + Math.sin(i) * bb.height * 0.2, { steps: 6 }); await sleep(180); B.hover.push((await shoot(loc, path.join(dir, `hover-${i}.png`))).buf); }
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 0; i < 6; i++) { await page.mouse.move(cx + (i + 1) * bb.width * 0.07, cy + (i % 2 ? 1 : -1) * bb.height * 0.03, { steps: 8 }); await sleep(150); B.drag.push((await shoot(loc, path.join(dir, `drag-${i}.png`))).buf); }
      await page.mouse.up();
    }
    // 3. video: seek to several positions (AI cannot watch video; frames + facts replace it)
    if (t.kind === 'video' && t.video && Number.isFinite(t.video.duration) && t.video.duration > 0) {
      for (const [i, f] of [0, 0.25, 0.5, 0.75].entries()) {
        await loc.evaluate((v, time) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.pause(); v.currentTime = time; setTimeout(res, 1500); }), t.video.duration * f).catch(() => {});
        B.video.push((await shoot(loc, path.join(dir, `video-${i}.png`))).buf);
      }
    }
  } catch (e) { t.error = e.message.split('\n')[0]; }
}

// 4. scroll-driven sequence: viewport frames while scrolling the whole page, plus each target's own appearance while in view
const scrollDir = path.join(out, 'frames', 'scroll'); fs.mkdirSync(scrollDir, { recursive: true });
const steps = Math.min(16, Math.max(4, Math.ceil(detected.docHeight / 700))), scrollHashes = [], scrollBufs = [], perTarget = Object.fromEntries(targets.map((t) => [t.id, []]));
await page.evaluate(() => scrollTo(0, 0)); await sleep(500);
for (let i = 0; i <= steps; i++) {
  await page.mouse.wheel(0, Math.min(detected.docHeight / steps, 1200)); await sleep(600);
  const buf = await page.screenshot({ animations: 'allow' }); fs.writeFileSync(path.join(scrollDir, `s-${pad(i)}.png`), buf); scrollHashes.push(hash(buf)); scrollBufs.push(buf);
  for (const t of targets) {
    try {
      const r = await page.locator(`[data-s3d-id="${t.id}"]`).evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vh: innerHeight, vw: innerWidth }; });
      const visibleH = Math.min(r.y + r.h, r.vh) - Math.max(r.y, 0);
      if (visibleH >= r.h * 0.6 && r.w > 20) perTarget[t.id].push(hash(await page.screenshot({ clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.w, r.vw - Math.max(0, r.x)), height: Math.min(r.h, r.vh - Math.max(0, r.y)) }, animations: 'allow' })));
    } catch {}
  }
}
for (const t of targets) { const h = perTarget[t.id]; t.scrollSamples = h.length; t.scrollUnique = new Set(h).size; t.scrollDriven = h.length >= 3 && new Set(h).size >= 3 && !t.animatesOnItsOwn; }

// 5. AI layer: numbers, language, filmstrips
const b64 = (arr) => arr.map((b) => b.toString('base64'));
const ap = await browser.newPage(); await ap.setContent('<!doctype html><html></html>');
const stats = {};
for (const t of targets) {
  const B = buffers[t.id]; if (!B) continue;
  try { stats[t.id] = await ap.evaluate(analyzeFramesInBrowser, { idle: b64(B.idle), hover: b64(B.hover), drag: b64(B.drag), video: b64(B.video) }); } catch (e) { stats[t.id] = null; }
  const st = stats[t.id];
  if (st?.idle) t.animatesOnItsOwn = t.animatesOnItsOwn && st.idle.meanStepChange > 0.05 ? true : t.animatesOnItsOwn;
  if (st && (st.hover || st.drag)) {
    const inter = Math.max(st.hover?.meanStepChange || 0, st.drag?.meanStepChange || 0), idleStep = st.idle?.meanStepChange || 0;
    t.reactsToMouse = t.animatesOnItsOwn ? inter > idleStep * 1.5 + 0.8 : inter > 0.5;
  }
}
await ap.close();
const mainWebgl = targets.find((t) => t.kind === 'webgl' || t.kind === 'webgpu');
for (const t of targets) {
  t.ai = describeTarget(t, stats[t.id], threeInfo && t === mainWebgl ? threeInfo : null);
  const B = buffers[t.id];
  if (B && (await buildFilmstrip(browser, [{ label: '靜置', files: B.idle }, { label: '滑鼠掃過', files: B.hover }, { label: '拖曳', files: B.drag }, { label: '影片位置', files: B.video }], path.join(out, 'frames', t.id, 'filmstrip.png'), `${t.kind} ${t.selector}（${t.box.w}×${t.box.h}）— 每格間隔 ${INTERVAL} ms`))) t.filmstrip = `frames/${t.id}/filmstrip.png`;
}
const scrollFilmstrip = (await buildFilmstrip(browser, [{ label: '捲動位置', files: scrollBufs }], path.join(scrollDir, 'filmstrip.png'), '整頁捲動序列（由上到下）')) ? 'frames/scroll/filmstrip.png' : null;

// ---- finish: video, report, contact sheet ----
const video = wantVideo ? await page.video()?.path() : null;
await ctx.close(); await browser.close();
let videoFile = null;
if (video && fs.existsSync(video)) { videoFile = path.join(out, 'recording.webm'); fs.renameSync(video, videoFile); fs.rmSync(path.join(out, 'video'), { recursive: true, force: true }); }

const report = { schemaVersion: 3, aiDocument: 'motion.md', three: threeInfo, scrollFilmstrip, url, capturedAt: new Date().toISOString(), webglContexts: detected.contexts, libs: detected.libs, raf: detected.rafCount, assets3d: [...assets3d], shaderSamples: detected.shaders.slice(0, 4), cssKeyframes: detected.keyframes, targets, scrollFrames: scrollHashes.length, scrollChangedFrames: new Set(scrollHashes).size, video: videoFile && path.basename(videoFile) };
fs.writeFileSync(path.join(out, 'motion.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'motion.md'), renderMotionMd(report));

const imgs = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort() : []);
const html = `<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file: 'self'; style-src 'unsafe-inline'"><title>Motion capture — ${host}</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:24px}h2{margin-top:32px}.row{display:flex;gap:6px;overflow-x:auto;padding:6px 0}.row img{height:160px;border:1px solid #333;border-radius:4px}code{color:#9cf}</style>
<h1>Motion capture — ${url}</h1><p>libs: <code>${Object.entries(detected.libs).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none detected'}</code> · WebGL contexts: ${detected.contexts.length} · 3D assets: ${assets3d.size}</p>
${videoFile ? '<video src="recording.webm" controls width=640></video>' : ''}
${targets.map((t) => `<h2>${t.kind} <code>${String(t.selector).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</code> ${t.animatesOnItsOwn ? '· animates by itself' : '· static at rest'} ${t.reactsToMouse ? '· reacts to mouse' : ''}</h2>
<div class=row>${imgs(path.join(out, 'frames', t.id)).map((f) => `<img title="${f}" src="frames/${t.id}/${f}">`).join('')}</div>`).join('\n')}
<h2>Scroll sequence</h2><div class=row>${imgs(scrollDir).map((f) => `<img src="frames/scroll/${f}">`).join('')}</div>`;
fs.writeFileSync(path.join(out, 'contact-sheet.html'), html);

console.log(`Targets captured: ${targets.map((t) => `${t.kind}${t.animatesOnItsOwn ? '*' : ''}`).join(', ') || 'none'}   (* = animates by itself)`);
console.log(`AI-readable: ${path.join(out, 'motion.md')}\nReport: ${path.join(out, 'motion.json')}\nContact sheet: ${path.join(out, 'contact-sheet.html')}${videoFile ? '\nVideo: ' + videoFile : ''}`);
