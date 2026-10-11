#!/usr/bin/env node
// verify — "did the rebuild actually look like the original?"  Closes the loop: explore → starter/ → rebuild → verify.
//   verify.mjs <handoff 資料夾> [--page home] [--min-score 60] [--out <資料夾>]
// Renders every starter page offline (no network at all), screenshots each [data-section] and compares it with the reference crop
// in media/sections/. Text and photos are placeholders, so the score measures LAYOUT: size, light/dark structure, colour — not words.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './launch.mjs';
import { isMain } from './util.mjs';
import { isInside } from './safe-out.mjs';
import { clean } from './untrusted.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

export const SECTION_COMMENT = /<!--\s*(\d+)\.\s*([\w-]+)\s*\|\s*reference image:\s*([^|]+?)\s*\|/g;

/** Sections a starter page declares, in order, with the reference image each points to (only images inside the handoff). */
export function declaredSections(html, starterDir, handoffDir) {
  const out = [];
  for (const m of html.matchAll(SECTION_COMMENT)) {
    const ref = path.resolve(starterDir, m[3].trim());
    out.push({ index: +m[1], name: m[2], ref: isInside(ref, path.join(handoffDir, 'media')) && /\.png$/i.test(ref) && fs.existsSync(ref) ? ref : null });
  }
  return out;
}

/** Runs inside the browser: compares two PNGs (as data URLs) on a canvas and draws original | rebuilt | difference. */
const compareInBrowser = async ({ a, b, W = 48 }) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
  const [A, B] = await Promise.all([load(a), load(b)]);
  const sample = (img, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const H = 32, pa = sample(A, W, H), pb = sample(B, W, H);
  let lum = 0, col = 0, ma = [0, 0, 0], mb = [0, 0, 0]; const cells = W * H;
  const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const heat = new Float32Array(cells);
  for (let k = 0; k < cells; k++) {
    const i = k * 4; const dl = Math.abs(L(pa, i) - L(pb, i)) / 255; lum += dl; heat[k] = dl;
    col += (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 765;
    for (let c = 0; c < 3; c++) { ma[c] += pa[i + c]; mb[c] += pb[i + c]; }
  }
  const mean = (m) => m.map((v) => v / cells);
  const meanDist = mean(ma).reduce((s, v, c) => s + Math.abs(v - mean(mb)[c]), 0) / 765;
  // Draw the evidence: original | rebuilt (both scaled to the same height) | difference heat-map.
  const th = 360, tw = Math.round(th * Math.max(A.width / A.height, B.width / B.height, 1.2)); const cw = Math.min(tw, 640);
  const out = document.createElement('canvas'); out.width = cw * 3 + 20; out.height = th + 4; const g = out.getContext('2d');
  g.fillStyle = '#1b1b24'; g.fillRect(0, 0, out.width, out.height);
  const fit = (img, x) => { const s = Math.min(cw / img.width, th / img.height); g.drawImage(img, x + (cw - img.width * s) / 2, 2 + (th - img.height * s) / 2, img.width * s, img.height * s); };
  fit(A, 0); fit(B, cw + 10);
  const cellW = cw / W, cellH = th / H;
  for (let k = 0; k < cells; k++) { const v = Math.min(1, heat[k] * 2.2); g.fillStyle = `rgba(${Math.round(255 * v)},${Math.round(80 * (1 - v))},${Math.round(60 * (1 - v))},${0.15 + 0.85 * v})`; g.fillRect(2 * cw + 20 + (k % W) * cellW, 2 + Math.floor(k / W) * cellH, cellW + 0.5, cellH + 0.5); }
  return { lum: lum / cells, col: col / cells, meanDist, refW: A.width, refH: A.height, diff: out.toDataURL('image/png') };
};

/** Turns raw differences into 0–100 scores. Layout dominates: placeholder text and photos can never match pixel for pixel. */
export function scoreSection({ lum, col, meanDist, refH, gotH }) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const height = clamp(Math.min(refH, gotH) / Math.max(refH, gotH, 1));
  const layout = clamp(1 - lum / 0.45);
  const colour = clamp(1 - (0.6 * col + 0.4 * meanDist) / 0.35);
  const score = Math.round(100 * (0.4 * layout + 0.3 * colour + 0.3 * height));
  return { score, layout: Math.round(layout * 100), colour: Math.round(colour * 100), height: Math.round(height * 100) };
}

const grade = (s) => (s >= 85 ? '很像' : s >= 70 ? '接近' : s >= 50 ? '有落差' : '差很多');

export async function verifyHandoff(handoffDir, { page: only, outDir, minScore = 0 } = {}) {
  const starterDir = path.join(handoffDir, 'starter');
  if (!fs.existsSync(starterDir)) throw new Error(`找不到 ${starterDir}。請先產生交接包（site-explorer <網址>）。`);
  const files = fs.readdirSync(starterDir).filter((f) => /\.html$/i.test(f)).sort();
  if (!files.length) throw new Error('starter/ 裡沒有 HTML 頁面。');
  outDir = outDir || path.join(handoffDir, 'verify');
  fs.mkdirSync(path.join(outDir, 'diff'), { recursive: true });
  const browser = await launchBrowser();
  const pages = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
    await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort())); // starter is checked offline
    const cmp = await ctx.newPage(); await cmp.goto('about:blank');
    for (const f of files) {
      const slug = f.replace(/\.html$/i, '');
      if (only && slug !== only && !(only === 'home' && slug === 'index')) continue;
      const html = fs.readFileSync(path.join(starterDir, f), 'utf8');
      const declared = declaredSections(html, starterDir, handoffDir);
      const pg = await ctx.newPage();
      await pg.goto(pathToFileURL(path.join(starterDir, f)).href, { waitUntil: 'load', timeout: 20000 });
      await pg.evaluate(() => document.fonts?.ready).catch(() => {});
      const sections = []; const seen = {};
      for (const d of declared) {
        const row = { name: d.name, index: d.index };
        const nth = seen[d.name] = (seen[d.name] ?? -1) + 1; // match by section name (the 2nd "cta" comment ↔ the 2nd cta), so inserting a section does not shift everything
        const loc = pg.locator(`[data-section="${d.name}"]`).nth(nth);
        if (!d.ref || !(await loc.count())) { row.status = d.ref ? '重建頁面少了這個區塊' : '沒有參考圖'; sections.push(row); continue; }
        const got = await loc.screenshot({ timeout: 10000 }).catch(() => null);
        if (!got) { row.status = '無法截圖'; sections.push(row); continue; }
        const refBuf = fs.readFileSync(d.ref);
        const r = await cmp.evaluate(compareInBrowser, { a: 'data:image/png;base64,' + refBuf.toString('base64'), b: 'data:image/png;base64,' + got.toString('base64') }).catch(() => null);
        if (!r) { row.status = '參考圖無法讀取（不是有效的 PNG）'; sections.push(row); continue; }
        const gotH = (await loc.boundingBox())?.height ?? 0;
        const s = scoreSection({ ...r, refH: r.refH, gotH: Math.round(gotH * (r.refW / 1440)) || r.refH });
        const diffFile = path.join('diff', `${slug}-${String(d.index).padStart(2, '0')}-${d.name}.png`);
        fs.writeFileSync(path.join(outDir, diffFile), Buffer.from(r.diff.split(',')[1], 'base64'));
        Object.assign(row, s, { refHeight: r.refH, gotHeight: Math.round(gotH), grade: grade(s.score), diff: diffFile.split(path.sep).join('/'), status: 'ok', weight: r.refH });
        sections.push(row);
      }
      await pg.close();
      const ok = sections.filter((s) => s.status === 'ok'); const w = ok.reduce((t, s) => t + s.weight, 0) || 1;
      pages.push({ page: f, sections, score: ok.length ? Math.round(ok.reduce((t, s) => t + s.score * s.weight, 0) / w) : 0, missing: sections.length - ok.length });
    }
  } finally { await browser.close(); }
  const scored = pages.filter((p) => p.sections.length);
  const overall = scored.length ? Math.round(scored.reduce((t, p) => t + p.score, 0) / scored.length) : 0;
  const result = { schemaVersion: 1, overall, grade: grade(overall), minScore, passed: overall >= minScore && scored.length > 0 && scored.every((p) => !p.missing), pages };
  fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'verify.md'), renderMd(result));
  return { ...result, outDir };
}

export function renderMd(r) {
  const L = ['# 重建驗證（verify）', '', `**整體相似度：${r.overall}／100（${r.grade}）**${r.minScore ? ` · 門檻 ${r.minScore}：${r.passed ? '通過' : '未通過'}` : ''}`, '',
    '分數衡量「版面」：區塊高度、明暗結構、顏色。文字與照片是佔位內容，所以不比對字句。差異圖（原站｜重建｜差異熱圖）在 `diff/`。', ''];
  for (const p of r.pages) {
    L.push(`## ${clean(p.page)} — ${p.score}／100`, '', '| # | 區塊 | 分數 | 版面 | 顏色 | 高度（原站→重建） | 差異圖 |', '|---|---|---|---|---|---|---|');
    for (const s of p.sections) L.push(s.status === 'ok' ? `| ${s.index} | ${clean(s.name)} | ${s.score}（${s.grade}） | ${s.layout} | ${s.colour} | ${s.refHeight}→${s.gotHeight}px | [${path.basename(s.diff)}](${s.diff}) |` : `| ${s.index} | ${clean(s.name)} | — | | | | ${s.status} |`);
    L.push('');
  }
  const worst = r.pages.flatMap((p) => p.sections.filter((s) => s.status === 'ok').map((s) => ({ ...s, page: p.page }))).sort((a, b) => a.score - b.score).slice(0, 3).filter((s) => s.score < 85);
  if (worst.length) { L.push('## 先修這幾個', ''); for (const s of worst) L.push(`- ${clean(s.page)} 的「${clean(s.name)}」（${s.score}）：${s.height < 85 ? `高度差 ${s.refHeight}→${s.gotHeight}px；` : ''}${s.colour < 70 ? '顏色偏離；' : ''}${s.layout < 70 ? '明暗結構不同；' : ''}看 ${s.diff}`); L.push(''); }
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const dir = args.find((a, i) => !a.startsWith('--') && !['--page', '--min-score', '--out'].includes(args[i - 1]));
  if (!dir) { console.error('用法：site-explorer verify <交接包資料夾（handoff）> [--page home] [--min-score 60] [--out <資料夾>] [--json]'); process.exit(1); }
  const min = Number(opt('min-score', 0));
  if (!Number.isFinite(min) || min < 0 || min > 100) { console.error('--min-score 必須是 0–100 的數字'); process.exit(1); }
  try {
    const r = await verifyHandoff(path.resolve(dir), { page: opt('page'), outDir: opt('out') && path.resolve(opt('out')), minScore: min });
    if (args.includes('--json')) { process.stdout.write(JSON.stringify({ ok: r.passed || !min, ...r }, null, 2) + '\n'); console.error(`已寫入 ${r.outDir}`); }
    else { console.log(renderMd(r)); console.log(`\n已寫入 ${r.outDir}/verify.md、verify.json 與 diff/`); }
    process.exit(r.passed || !min ? 0 : 2);
  } catch (e) { console.error('✖ ' + e.message); process.exit(1); }
}
