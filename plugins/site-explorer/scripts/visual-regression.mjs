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
const NAME_OK = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_ROWS = 6000; // pixel rows compared per screenshot (very long pages: the top part is compared and the report says so)

export function visualDirFor(baselineFile) { return baselineFile.replace(/\.json$/i, '') + '-visual'; }

/** Remove a visual baseline folder, but only one this tool wrote (it has our index.json) or an empty one: never a folder that merely has the same name. */
export function removeVisualBaseline(dest, dry = false) {
  if (!fs.existsSync(dest)) return;
  if (fs.lstatSync(dest).isSymbolicLink() || !fs.statSync(dest).isDirectory()) throw new Error(_t`${dest} 已存在但不是資料夾，不會覆蓋。`);
  const entries = fs.readdirSync(dest);
  let ours = false; try { ours = JSON.parse(fs.readFileSync(path.join(dest, 'index.json'), 'utf8')).schema === 1; } catch {}
  if (entries.length && !ours) throw new Error(_t`${dest} 已存在而且不是 site-explorer 建立的視覺基準資料夾，不會覆蓋（請改用 --baseline 指定別的位置，或自行移走它）。`);
  if (!dry) fs.rmSync(dest, { recursive: true, force: true });
}

/** How many screenshots this run has that a visual baseline would store. */
export function countVisualShots(siteDir) {
  let n = 0; try { const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
    for (const p of site.pages || []) { if (!SLUG.test(p.slug || '') || (p.status && p.status >= 400)) continue; for (const vp of VIEWPORTS) if (fs.existsSync(path.join(siteDir, 'pages', p.slug, `${vp}.png`))) n++; }
    for (const sc of site.scenarios || []) if (sc?.file && NAME_OK.test(sc.name || '') && fs.existsSync(path.join(siteDir, 'scenarios', sc.name + '.png'))) n++;
  } catch {}
  return n;
}

/** Copy this run's full-page screenshots into dest/<slug>/<viewport>.png. Returns how many were stored. */
export function saveVisualBaseline(siteDir, dest) {
  removeVisualBaseline(dest); let n = 0;
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
  const scenarios = [];
  for (const sc of site.scenarios || []) {
    if (!sc?.file || !NAME_OK.test(sc.name || '')) continue; const src = path.join(siteDir, 'scenarios', sc.name + '.png'); if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.join(dest, '_scenarios'), { recursive: true }); fs.copyFileSync(src, path.join(dest, '_scenarios', sc.name + '.png')); scenarios.push(sc.name); n++;
  }
  fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'index.json'), JSON.stringify({ schema: 1, pages: index, scenarios }, null, 2) + '\n');
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
      const pct = (r.changed / Math.max(r.total, 1)) * 100; row.changedPct = Math.round(pct * 10000) / 10000; row.baseSize = r.aSize; row.newSize = r.bSize; row.truncated = r.truncated;
      row.status = pct > threshold ? 'changed' : 'same';
      if (row.status === 'changed') { fs.mkdirSync(diffDir, { recursive: true }); const f = `${slug}-${vp}.png`; fs.writeFileSync(path.join(diffDir, f), Buffer.from(r.diff.split(',')[1], 'base64')); row.diff = `visual-diff/${f}`; }
      rows.push(row);
    }
  }
  const nowScen = new Set((site.scenarios || []).filter((x) => x && x.file && NAME_OK.test(x.name || '')).map((x) => x.name));
  for (const name of (idx.scenarios || []).filter((x) => NAME_OK.test(String(x)))) {
    const ref = path.join(baseDir, '_scenarios', name + '.png'); if (!fs.existsSync(ref)) continue;
    const row = { slug: name, viewport: 'scenario', url: 'scenario' }; const cur = path.join(siteDir, 'scenarios', name + '.png');
    if (!nowScen.has(name) || !fs.existsSync(cur)) { row.status = 'missing'; rows.push(row); continue; }
    const r = await page.evaluate(diffInBrowser, { a: 'data:image/png;base64,' + fs.readFileSync(ref).toString('base64'), b: 'data:image/png;base64,' + fs.readFileSync(cur).toString('base64'), tol: tolerance, maxRows: MAX_ROWS }).catch(() => null);
    if (!r) { row.status = 'error'; rows.push(row); continue; }
    const pct = (r.changed / Math.max(r.total, 1)) * 100; row.changedPct = Math.round(pct * 10000) / 10000; row.baseSize = r.aSize; row.newSize = r.bSize; row.truncated = r.truncated; row.status = pct > threshold ? 'changed' : 'same';
    if (row.status === 'changed') { fs.mkdirSync(diffDir, { recursive: true }); const f = `scenario-${name}.png`; fs.writeFileSync(path.join(diffDir, f), Buffer.from(r.diff.split(',')[1], 'base64')); row.diff = `visual-diff/${f}`; }
    rows.push(row);
  }
  const added = [...nowSlugs].filter((s) => !(s in (idx.pages || {})));
  const bad = rows.filter((r) => r.status !== 'same');
  return { threshold, tolerance, rows, added, failed: bad.length > 0, reasons: bad.slice(0, 8).map((r) => r.status === 'changed' ? _t`${r.slug}（${r.viewport}）有 ${r.changedPct}% 的像素不同（容許 ${threshold}%）` : r.status === 'missing' ? _t`${r.slug}（${r.viewport}）這次沒有截圖` : _t`${r.slug}（${r.viewport}）無法比對`) };
}

/** Accept some of the current screenshots as the new baseline without touching the rest. items: "all", "slug", "slug:viewport", "scenario:name". Returns the list of updated files. */
export function approveVisualItems(siteDir, dest, items) {
  if (!fs.existsSync(path.join(dest, 'index.json'))) throw new Error(_t`還沒有視覺基準（${dest}）。請先用 --approve 建立。`);
  const idx = JSON.parse(fs.readFileSync(path.join(dest, 'index.json'), 'utf8')); const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8')); const done = [];
  const want = (key) => items.includes('all') || items.includes(key);
  for (const p of site.pages || []) {
    if (!SLUG.test(p.slug || '') || (p.status && p.status >= 400)) continue;
    for (const vp of VIEWPORTS) {
      const src = path.join(siteDir, 'pages', p.slug, `${vp}.png`); if (!fs.existsSync(src) || !(want(p.slug) || want(`${p.slug}:${vp}`))) continue;
      fs.mkdirSync(path.join(dest, p.slug), { recursive: true }); fs.copyFileSync(src, path.join(dest, p.slug, `${vp}.png`)); idx.pages[p.slug] = String(p.url || '').slice(0, 300); done.push(`${p.slug}:${vp}`);
    }
  }
  idx.scenarios = idx.scenarios || [];
  for (const sc of site.scenarios || []) {
    if (!sc?.file || !NAME_OK.test(sc.name || '') || !want(`scenario:${sc.name}`)) continue; const src = path.join(siteDir, 'scenarios', sc.name + '.png'); if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.join(dest, '_scenarios'), { recursive: true }); fs.copyFileSync(src, path.join(dest, '_scenarios', sc.name + '.png')); if (!idx.scenarios.includes(sc.name)) idx.scenarios.push(sc.name); done.push(`scenario:${sc.name}`);
  }
  fs.writeFileSync(path.join(dest, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
  return done;
}

export function renderVisualMd(r) {
  const L = [BANNER, '', _t('# 整頁視覺比對'), '', _t`比對 ${r.rows.length} 張整頁截圖；每張容許 ${r.threshold}% 的像素不同（單一色版差距超過 ${r.tolerance}/255 才算不同）。`, ''];
  L.push(r.failed ? `**${_t('有畫面和基準不同')}**` : `**${_t('畫面都在容許範圍內')}**`, '');
  L.push(`| ${_t('頁面')} | ${_t('裝置')} | ${_t('結果')} | ${_t('不同的像素')} | ${_t('尺寸（基準 → 現在）')} | ${_t('差異圖')} |`, '|---|---|---|---|---|---|');
  for (const x of r.rows) L.push(`| ${clean(x.slug, 60)} | ${x.viewport} | ${x.status === 'same' ? '✔' : x.status === 'changed' ? '✖' : '?'} ${x.status} | ${x.changedPct ?? '—'}% | ${x.baseSize ? `${x.baseSize.join('×')} → ${x.newSize.join('×')}${x.truncated ? _t('（只比對最上方）') : ''}` : '—'} | ${x.diff ? `[${x.diff}](${x.diff})` : '—'} |`);
  if (r.added.length) L.push('', _t('## 基準裡沒有的新頁面'), '', ...r.added.map((s) => `- ${clean(s, 60)}`));
  return L.join('\n') + '\n';
}

const hx = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One self-contained HTML page for reviewing a comparison: before / after with a slider, the difference, and the exact command that approves each change. */
export function renderVisualReviewHtml(vr, { baseDir, siteDir, outDir, url, baselineFile }) {
  let budget = 14 * 1024 * 1024;
  const img = (file) => { try { if (!file || !fs.existsSync(file)) return null; const b = fs.readFileSync(file); const enc = Math.ceil(b.length / 3) * 4; if (enc > budget) return null; budget -= enc; return 'data:image/png;base64,' + b.toString('base64'); } catch { return null; } };
  const VPN = { desktop: _t('桌機'), tablet: _t('平板'), mobile: _t('手機'), scenario: _t('情境') };
  const sq = (v) => (/^[\w:/.@%+=,-]+$/.test(String(v)) ? String(v) : `'${String(v).replace(/'/g, `'\\''`)}'`); // POSIX single-quote quoting: nothing in a URL or path can run as a command
  const cmd = (items) => `site-explorer explore ${sq(url)} --approve-visual ${sq(items)}${baselineFile ? ` --baseline ${sq(baselineFile)}` : ''}`;
  const keyOf = (r) => (r.viewport === 'scenario' ? `scenario:${r.slug}` : `${r.slug}:${r.viewport}`);
  const changed = vr.rows.filter((r) => r.status !== 'same'), same = vr.rows.length - changed.length;
  const cards = changed.map((r, i) => {
    const ref = r.viewport === 'scenario' ? path.join(baseDir, '_scenarios', r.slug + '.png') : path.join(baseDir, r.slug, r.viewport + '.png');
    const now = r.viewport === 'scenario' ? path.join(siteDir, 'scenarios', r.slug + '.png') : path.join(siteDir, 'pages', r.slug, r.viewport + '.png');
    const a = img(ref), b = img(now), d = r.diff ? img(path.join(outDir, r.diff)) : null;
    const title = `${hx(r.slug)} · ${hx(VPN[r.viewport] || r.viewport)} · ${r.status === 'changed' ? hx(r.changedPct) + '% ' + hx(_t('不同')) : r.status === 'missing' ? hx(_t('這次沒有截圖')) : hx(_t('無法比對'))}`;
    return `<section class="c" data-i="${i}"><h2>${title}</h2>` + (a && b ? `<div class="sl" style="--p:50%"><img src="${a}" alt=""><div class="top"><img src="${b}" alt=""></div><input type="range" min="0" max="100" value="50" aria-label="${hx(_t('拖曳比較'))}"><span class="lb l">${hx(_t('基準'))}</span><span class="lb r">${hx(_t('現在'))}</span></div>` : `<p class="hint">${hx(_t('圖片太大或不存在，沒有內嵌。'))}</p>`) +
      (d ? `<details><summary>${hx(_t('只看差異（紅色＝變動處）'))}</summary><img class="df" src="${d}" alt=""></details>` : '') +
      `<div class="act"><button data-cmd="${hx(cmd(keyOf(r)))}">${hx(_t('複製「核准這張」指令'))}</button><code>${hx(cmd(keyOf(r)))}</code></div></section>`;
  }).join('');
  return `<!doctype html><html lang="${hx(_t('zh-Hant'))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${hx(_t('畫面比對審核'))}</title>
<style>:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#667085;--line:#e4e7ec;--acc:#4f46e5}@media(prefers-color-scheme:dark){:root{--bg:#0d0f13;--card:#171a21;--ink:#eef0f4;--mute:#98a2b3;--line:#272b35;--acc:#8b85ff}}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,"PingFang TC","Noto Sans TC",sans-serif}main{max-width:1100px;margin:auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}.hint{color:var(--mute)}.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0}.c h2{font-size:16px;margin:0 0 10px}.sl{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#888;line-height:0}.sl img{width:100%;display:block}.sl .top{position:absolute;inset:0;clip-path:inset(0 0 0 var(--p))}.sl input{position:absolute;left:0;right:0;bottom:6px;width:100%;margin:0}.lb{position:absolute;top:6px;background:#000a;color:#fff;font-size:12px;padding:1px 8px;border-radius:99px;line-height:1.5}.lb.l{left:6px}.lb.r{right:6px}.df{width:100%;border:1px solid var(--line);border-radius:8px;margin-top:8px}.act{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}.act button,.all button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer}.act code,.all code{font-size:12px;color:var(--mute);word-break:break-all}.all{background:var(--card);border:1px solid var(--acc);border-radius:12px;padding:12px 16px;margin:14px 0}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:99px;display:none}</style></head><body><main>
<h1>${hx(_t('畫面比對審核'))}</h1><p class="hint">${hx(_t`和你核准過的基準比對：${vr.rows.length} 張中有 ${changed.length} 張不同、${same} 張一致。拖曳滑桿比較改版前後；是想要的改動就複製指令核准，不是就修好網站再比對。`)}</p>
${changed.length ? `<div class="all"><button data-cmd="${hx(cmd('all'))}">${hx(_t('複製「全部核准」指令'))}</button> <code>${hx(cmd('all'))}</code></div>` : `<p>${hx(_t('所有畫面都和基準一致。'))}</p>`}
${cards}</main><div class="toast" id="t">${hx(_t('已複製'))}</div>
<script>document.querySelectorAll('.sl input').forEach(function(i){i.oninput=function(){i.parentNode.style.setProperty('--p',i.value+'%')}});document.querySelectorAll('[data-cmd]').forEach(function(b){b.onclick=function(){var c=b.getAttribute('data-cmd');var d=function(){var t=document.getElementById('t');t.style.display='block';setTimeout(function(){t.style.display='none'},1400)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(c).then(d,d)}else{d()}}})</script></body></html>`;
}
