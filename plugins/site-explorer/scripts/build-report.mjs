#!/usr/bin/env node
// Build a single-page visual dashboard (offline, no CDN) from crawl + motion + design outputs.
//   node build-report.mjs --site ./site-report/<host> [--motion ./motion-report/<host>] [--out ./dashboard.html]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, runsForHost, diffRuns } from './db.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const siteDir = opt('site'), motionDir = opt('motion');
if (!siteDir && !motionDir) { console.error('Usage: build-report.mjs --site <crawl dir> [--motion <motion dir>] [--out dashboard.html]'); process.exit(1); }
const outFile = path.resolve(opt('out', './dashboard.html'));
const outDir = path.dirname(outFile);
const rel = (p) => path.relative(outDir, p).split(path.sep).map(encodeURIComponent).join('/');
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = fs.existsSync;

const data = { generatedAt: new Date().toISOString(), site: null, tokens: null, pages: [], motion: null, history: null, files: [] };

if (siteDir && exists(path.join(siteDir, 'site.json'))) {
  data.site = readJSON(path.join(siteDir, 'site.json'));
  const tok = path.join(siteDir, 'design-bundle', 'tokens.json');
  if (!exists(tok)) spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-design.mjs'), siteDir], { stdio: 'ignore' });
  if (exists(tok)) data.tokens = readJSON(tok);
  for (const p of data.site.pages) {
    const pj = path.join(siteDir, 'pages', p.slug, 'page.json');
    if (!exists(pj)) continue;
    const full = readJSON(pj);
    const shot = (v) => (exists(path.join(siteDir, 'pages', p.slug, v + '.png')) ? rel(path.join(siteDir, 'pages', p.slug, v + '.png')) : null);
    data.pages.push({
      slug: p.slug, url: p.url, title: p.title, status: p.status, docHeight: full.layout.docHeight,
      headings: full.content.headings.slice(0, 60), paragraphs: full.content.paragraphs.slice(0, 6),
      images: full.content.images.slice(0, 24), linkCount: full.content.links.length, forms: full.content.forms,
      sections: full.layout.sections, landmarks: full.layout.landmarks, shots: { desktop: shot('desktop'), tablet: shot('tablet'), mobile: shot('mobile') },
      mobileOverflow: full.layout.mobileOverflow,
      blocks: full.designer?.blocks || [], elements: full.designer?.elements || [],
    });
  }
  for (const f of ['palette.svg', 'tokens.studio.json', 'tokens.css', 'tailwind.config.js', 'tokens.w3c.json', 'tokens.json', 'README.md']) {
    const fp = path.join(siteDir, 'design-bundle', f);
    if (exists(fp)) data.files.push({ name: f, href: rel(fp) });
  }
  if (data.site.assets) data.site.assets = data.site.assets.map((a) => ({ ...a, src: rel(path.join(siteDir, a.file)) }));
}
if (motionDir && exists(path.join(motionDir, 'motion.json'))) {
  const m = readJSON(path.join(motionDir, 'motion.json'));
  const list = (d) => (exists(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort().map((f) => rel(path.join(d, f))) : []);
  for (const t of m.targets) {
    const d = path.join(motionDir, 'frames', t.id);
    t.frames = { idle: list(d).filter((f) => /idle-/.test(f)), hover: list(d).filter((f) => /hover-/.test(f)), drag: list(d).filter((f) => /drag-/.test(f)) };
  }
  m.scroll = list(path.join(motionDir, 'frames', 'scroll'));
  if (m.video) m.video = rel(path.join(motionDir, m.video));
  data.motion = m;
}

// history from the local database (optional)
try {
  const host = data.site ? new URL(data.site.startUrl).host : data.motion ? new URL(data.motion.url).host : null;
  const db = host && (await openDb());
  if (db) {
    const runs = runsForHost(db, host);
    if (runs.length) {
      data.history = { host, runs: runs.map((r) => ({ id: r.id, date: r.crawled_at, pages: r.pages, brand: r.brand, font: r.heading_font, targets: r.motion_targets })),
        changes: runs.length > 1 ? diffRuns(db, runs.at(-2).id, runs.at(-1).id) : [] };
    }
    db.close();
  }
} catch {}

// UI lives in plain files (report/report.css, report/report-client.js) so it is editable without template-literal escaping.
const read = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'report', f), 'utf8');
const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Explorer 報告</title>
<style>
${read('report.css')}
</style></head><body>
<header><h1>🔍 網站探索報告</h1><div class="sub" id="sub"></div></header>
<nav><div class="in" id="tabs"></div></nav>
<main>
<section id="s-overview"></section><section id="s-design"></section><section id="s-layout"></section>
<section id="s-content"></section><section id="s-motion"></section><section id="s-edit"></section><section id="s-history"></section>
</main><div class="toast" id="toast"></div>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
${read('report-client.js').replace(/<\/script/gi, '<\\/script')}
</script></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log('Dashboard:', outFile);
