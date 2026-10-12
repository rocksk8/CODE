// Whole-page visual regression (BackstopJS-style): the full-page screenshots of an approved run are stored; later runs are compared pixel by pixel.
//   explore <url> --approve   also stores desktop/tablet/mobile screenshots next to the baseline file (<baseline>-visual/)
//   explore <url> --compare   compares them; --visual-threshold P = percent of changed pixels allowed per screenshot (default 0.5); --no-visual skips this
// A changed screenshot gets a difference image (changed pixels in red over the new page) in <out>/visual-diff/.
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { clean, BANNER } from './untrusted.mjs';

export const VIEWPORTS = ['desktop', 'tablet', 'mobile'];
const SLUG = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_ROWS = 6000; // pixel rows compared per screenshot (very long pages: the top part is compared and the report says so)

export function visualDirFor(baselineFile) { return baselineFile.replace(/\.json$/i, '') + '-visual'; }

/** Copy this run's full-page screenshots into dest/<slug>/<viewport>.png. Returns how many were stored. */
export function saveVisualBaseline(siteDir, dest) {
  fs.rmSync(dest, { recursive: true, force: true }); let n = 0;
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
  const index = {};
  for (const p of site.pages || []) {
    if (!SLUG.test(p.slug || '') || (p.status && p.status >= 400)) continue;
    for (const vp of VIEWPORTS) {
      const src = path.join(siteDir, 'pages', p.slug, `${vp}.png`);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(dest, p.slug), { recursive: true }); fs.copyFileSync(src, path.join(dest, p.slug, `${vp}.png`)); n++;
      index[p.slug] = String(p.url || '').slice(0, 300);
    }
  }
  fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'index.json'), JSON.stringify({ schema: 1, pages: index }, null, 2) + '\n');
  return n;
}

/** Runs inside the browser: counts pixels that differ (any channel by more than `tol`) and draws them in red over the new image. */
const diffInBrowser = async ({ a, b, tol, maxRows }) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
  const [A, B] = await Promise.all([load(a), load(b)]);
  const W = Math.max(A.width, B.width), H = Math.min(Math.max(A.height, B.height), maxRows);
  const px = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, W, H).data; };
  const da = px(A), db = px(B);
  const inA = (x, y) => x < A.width && y < A.height, inB = (x, y) => x < B.width && y < B.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d'); const od = g.createImageData(W, H); let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; let diff = false;
    if (inA(x, y) !== inB(x, y)) diff = true; else if (inA(x, y)) diff = Math.abs(da[i] - db[i]) > tol || Math.abs(da[i + 1] - db[i + 1]) > tol || Math.abs(da[i + 2] - db[i + 2]) > tol;
    if (diff) { changed++; od.data[i] = 255; od.data[i + 1] = 40; od.data[i + 2] = 60; od.data[i + 3] = 255; }
    else { const v = inB(x, y) ? 1 : 0; od.data[i] = db[i] * 0.35 + 165 * v; od.data[i + 1] = db[i + 1] * 0.35 + 165 * v; od.data[i + 2] = db[i + 2] * 0.35 + 165 * v; od.data[i + 3] = 255; }
  }
  g.putImageData(od, 0, 0);
  // a very large diff image is scaled down so the file stays small
  const s = Math.min(1, 1600 / W); let img = out;
  if (s < 1) { img = document.createElement('canvas'); img.width = Math.round(W * s); img.height = Math.round(H * s); img.getContext('2d').drawImage(out, 0, 0, img.width, img.height); }
  return { changed, total: W * H, aSize: [A.width, A.height], bSize: [B.width, B.height], truncated: Math.max(A.height, B.height) > maxRows, diff: img.toDataURL('image/png') };
};

/** page = a Playwright page (about:blank is enough). Compares every stored screenshot with the new run's. */
export async function compareVisual(page, { siteDir, baseDir, outDir, threshold = 0.5, tolerance = 16 }) {
  const idx = JSON.parse(fs.readFileSync(path.join(baseDir, 'index.json'), 'utf8'));
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
  const nowSlugs = new Set((site.pages || []).filter((p) => SLUG.test(p.slug || '')).map((p) => p.slug));
  const rows = []; const diffDir = path.join(outDir, 'visual-diff'); fs.rmSync(diffDir, { recursive: true, force: true });
  for (const slug of Object.keys(idx.pages || {}).filter((s) => SLUG.test(s))) {
    for (const vp of VIEWPORTS) {
      const ref = path.join(baseDir, slug, `${vp}.png`); if (!fs.existsSync(ref)) continue;
      const row = { slug, viewport: vp, url: clean(idx.pages[slug], 120) };
      const cur = path.join(siteDir, 'pages', slug, `${vp}.png`);
      if (!nowSlugs.has(slug) || !fs.existsSync(cur)) { row.status = 'missing'; rows.push(row); continue; }
      const r = await page.evaluate(diffInBrowser, { a: 'data:image/png;base64,' + fs.readFileSync(ref).toString('base64'), b: 'data:image/png;base64,' + fs.readFileSync(cur).toString('base64'), tol: tolerance, maxRows: MAX_ROWS }).catch(() => null);
      if (!r) { row.status = 'error'; rows.push(row); continue; }
      row.changedPct = Math.round((r.changed / Math.max(r.total, 1)) * 10000) / 100; row.baseSize = r.aSize; row.newSize = r.bSize; row.truncated = r.truncated;
      row.status = row.changedPct > threshold ? 'changed' : 'same';
      if (row.status === 'changed') { fs.mkdirSync(diffDir, { recursive: true }); const f = `${slug}-${vp}.png`; fs.writeFileSync(path.join(diffDir, f), Buffer.from(r.diff.split(',')[1], 'base64')); row.diff = `visual-diff/${f}`; }
      rows.push(row);
    }
  }
  const added = [...nowSlugs].filter((s) => !(s in (idx.pages || {})));
  const bad = rows.filter((r) => r.status !== 'same');
  return { threshold, tolerance, rows, added, failed: bad.length > 0, reasons: bad.slice(0, 8).map((r) => r.status === 'changed' ? _t`${r.slug}（${r.viewport}）有 ${r.changedPct}% 的像素不同（容許 ${threshold}%）` : r.status === 'missing' ? _t`${r.slug}（${r.viewport}）這次沒有截圖` : _t`${r.slug}（${r.viewport}）無法比對`) };
}

export function renderVisualMd(r) {
  const L = [BANNER, '', _t('# 整頁視覺比對'), '', _t`比對 ${r.rows.length} 張整頁截圖；每張容許 ${r.threshold}% 的像素不同（單一色版差距超過 ${r.tolerance}/255 才算不同）。`, ''];
  L.push(r.failed ? `**${_t('有畫面和基準不同')}**` : `**${_t('畫面都在容許範圍內')}**`, '');
  L.push(`| ${_t('頁面')} | ${_t('裝置')} | ${_t('結果')} | ${_t('不同的像素')} | ${_t('尺寸（基準 → 現在）')} | ${_t('差異圖')} |`, '|---|---|---|---|---|---|');
  for (const x of r.rows) L.push(`| ${clean(x.slug, 60)} | ${x.viewport} | ${x.status === 'same' ? '✔' : x.status === 'changed' ? '✖' : '?'} ${x.status} | ${x.changedPct ?? '—'}% | ${x.baseSize ? `${x.baseSize.join('×')} → ${x.newSize.join('×')}${x.truncated ? _t('（只比對最上方）') : ''}` : '—'} | ${x.diff ? `[${x.diff}](${x.diff})` : '—'} |`);
  if (r.added.length) L.push('', _t('## 基準裡沒有的新頁面'), '', ...r.added.map((s) => `- ${clean(s, 60)}`));
  return L.join('\n') + '\n';
}
