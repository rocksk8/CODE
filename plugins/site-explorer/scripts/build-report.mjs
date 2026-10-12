#!/usr/bin/env node
// Build a single-page visual dashboard (offline, no CDN) from crawl + motion + design outputs.
//   node build-report.mjs --site ./site-report/<host> [--motion ./motion-report/<host>] [--out ./dashboard.html]
import { _t, htmlLang, dictionary, WHY_KEYS } from './i18n.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, runsForHost, diffRuns } from './db.mjs';
import { computeVerdicts } from './verdicts.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const siteDir = opt('site'), motionDir = opt('motion'), handoffDir = opt('handoff');
if (!siteDir && !motionDir) { console.error('Usage: build-report.mjs --site <crawl dir> [--motion <motion dir>] [--handoff <handoff dir>] [--out dashboard.html]'); process.exit(1); }
const standalone = args.includes('--standalone');
const embedBudget = Number(opt('embed-mb', 12)) * 1024 * 1024;
import { requireExtension, UnsafeOutputError } from './safe-out.mjs';
let outFile; try { outFile = requireExtension(opt('out', './dashboard.html'), /\.html?$/i, '*.html'); } catch (e) { if (e instanceof UnsafeOutputError) { console.error(e.message); process.exit(1); } throw e; }
const outDir = path.dirname(outFile);
const rel = (p) => path.relative(outDir, p).split(path.sep).map(encodeURIComponent).join('/');
// Standalone mode: inline files as data: URIs (within a size budget) so one HTML file can be emailed or dropped into Slack.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', css: 'text/css', json: 'application/json', js: 'text/javascript', md: 'text/markdown' };
const embed = { used: 0, embedded: 0, skipped: 0 };
const ref = (file, allowEmbed = true) => {
  const mime = MIME[path.extname(file).slice(1).toLowerCase()];
  if (standalone && allowEmbed && mime && fs.existsSync(file)) {
    const size = fs.statSync(file).size, enc = Math.ceil(size / 3) * 4;
    if (embed.used + enc <= embedBudget) { embed.used += enc; embed.embedded++; return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`; }
    embed.skipped++;
  }
  return rel(file);
};
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = fs.existsSync;

const data = { standalone, embed, generatedAt: new Date().toISOString(), site: null, tokens: null, pages: [], motion: null, history: null, health: null, files: [], motionPages: null, exportKit: null, verify: null, verdicts: [], checks: {} };

if (siteDir && exists(path.join(siteDir, 'site.json'))) {
  data.site = readJSON(path.join(siteDir, 'site.json'));
  if (exists(path.join(siteDir, 'health.json'))) data.health = readJSON(path.join(siteDir, 'health.json'));
  const tok = path.join(siteDir, 'design-bundle', 'tokens.json');
  if (!exists(tok)) spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-design.mjs'), siteDir], { stdio: 'ignore' });
  if (exists(tok)) data.tokens = readJSON(tok);
  for (const p of data.site.pages) {
    const pj = path.join(siteDir, 'pages', p.slug, 'page.json');
    if (!exists(pj)) continue;
    const full = readJSON(pj);
    const shot = (v) => (exists(path.join(siteDir, 'pages', p.slug, v + '.png')) ? ref(path.join(siteDir, 'pages', p.slug, v + '.png')) : null);
    data.pages.push({
      slug: p.slug, url: p.url, title: p.title, status: p.status, docHeight: full.layout.docHeight, emptyPage: !!full.emptyPage,
      headings: full.content.headings.slice(0, 60), paragraphs: full.content.paragraphs.slice(0, 6),
      images: full.content.images.slice(0, 24), linkCount: full.content.links.length, forms: full.content.forms,
      sections: full.layout.sections, landmarks: full.layout.landmarks, shots: { desktop: shot('desktop'), tablet: shot('tablet'), mobile: shot('mobile') },
      mobileOverflow: full.layout.mobileOverflow,
      states: (full.states || []).map((s) => ({ index: s.index, action: s.action, label: s.label, textChars: s.textChars, text: s.text, src: exists(path.join(siteDir, 'pages', p.slug, 'states', s.screenshot)) ? ref(path.join(siteDir, 'pages', p.slug, 'states', s.screenshot)) : null })),
      blocks: full.designer?.blocks || [], elements: full.designer?.elements || [],
    });
  }
  for (const f of ['palette.svg', 'tokens.studio.json', 'tokens.css', 'tailwind.config.js', 'tailwind-v4.css', 'DESIGN.md', 'tokens.w3c.json', 'tokens.json', 'README.md']) {
    const fp = path.join(siteDir, 'design-bundle', f);
    if (exists(fp)) data.files.push({ name: f, href: ref(fp) });
  }
  // the newer checks: raw results for their own tabs, plus one plain-language verdict each for the overview
  data.verdicts = computeVerdicts(siteDir, outDir);
  for (const [k, f] of [['tech', 'techstack.json'], ['perf', 'performance.json'], ['security', 'security.json'], ['privacy', 'tracking-behaviors.json'], ['extract', 'extractions.json']]) { try { const j = readJSON(path.join(siteDir, f)); if (j) data.checks[k] = j; } catch {} }
  try { data.checks.visual = readJSON(path.join(outDir, 'visual.json')); if (data.checks.visual) for (const r of data.checks.visual.rows || []) { r.diff = r.diff && exists(path.join(outDir, r.diff)) ? ref(path.join(outDir, r.diff)) : null; const cur = r.viewport === 'scenario' ? path.join(siteDir, 'scenarios', String(r.slug).replace(/[^a-z0-9_-]/g, '') + '.png') : path.join(siteDir, 'pages', String(r.slug).replace(/[^A-Za-z0-9._-]/g, ''), r.viewport + '.png'); r.now = exists(cur) ? ref(cur) : null; } } catch {}
  data.checks.visualReview = exists(path.join(outDir, 'visual-review.html')) ? 'visual-review.html' : null;
  data.checks.files = [];
  for (const p of data.site.pages) { for (const [k, f, label] of [['archive', 'archive.html', 'archive'], ['figma', null, 'figma']]) { if (k === 'archive' && exists(path.join(siteDir, 'pages', p.slug, f))) data.checks.files.push({ kind: 'archive', slug: p.slug, href: ref(path.join(siteDir, 'pages', p.slug, f), false) }); } if (exists(path.join(siteDir, 'figma', p.slug + '.svg'))) data.checks.files.push({ kind: 'figma', slug: p.slug, href: ref(path.join(siteDir, 'figma', p.slug + '.svg'), false) }); }
  if (data.site.assets) data.site.assets = data.site.assets.map((a) => ({ ...a, src: ref(path.join(siteDir, a.file)) }));
}
if (motionDir && exists(path.join(motionDir, 'motion.json'))) {
  const m = readJSON(path.join(motionDir, 'motion.json'));
  // pick frames by FILE NAME (in standalone mode ref() returns data: URIs, which carry no file name), in natural order (idle-2 before idle-10)
  const list = (d, re = /./) => (exists(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png') && !/filmstrip/.test(f) && re.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => ref(path.join(d, f))) : []);
  for (const t of m.targets) {
    const d = path.join(motionDir, 'frames', t.id);
    t.frames = { idle: list(d, /^idle-/), hover: list(d, /^hover-/), drag: list(d, /^drag-/) };
  }
  m.scroll = list(path.join(motionDir, 'frames', 'scroll'));
  if (m.video) m.video = ref(path.join(motionDir, m.video), false);
  data.motion = m;
}

// 3D / motion of the other crawled pages (explore --motion-pages)
if (motionDir && exists(path.join(motionDir, 'pages.json'))) {
  try {
    data.motionPages = readJSON(path.join(motionDir, 'pages.json')).pages.map((e) => ({ url: e.url, slug: e.slug, title: e.title, targets: e.targets, kinds: e.kinds, three: e.three,
      text: e.md ? fs.readFileSync(path.join(motionDir, e.dir, 'motion.md'), 'utf8').slice(0, 9000) : null, // inlined, so a single-file dashboard still shows it
      md: !standalone && e.md ? ref(path.join(motionDir, e.dir, 'motion.md'), false) : null, sheet: !standalone && e.sheet ? ref(path.join(motionDir, e.dir, 'contact-sheet.html'), false) : null }));
  } catch {}
}

// history from the local database (optional)
try {
  const host = data.site ? new URL(data.site.startUrl).host : data.motion ? new URL(data.motion.url).host : null;
  const db = host && !data.site?.authenticated && (await openDb()); // logged-in captures never touch the shared history database
  if (db) {
    const runs = runsForHost(db, host);
    if (runs.length) {
      data.history = { host, runs: runs.map((r) => ({ id: r.id, date: r.crawled_at, pages: r.pages, brand: r.brand, font: r.heading_font, targets: r.motion_targets })),
        changes: runs.length > 1 ? diffRuns(db, runs.at(-2).id, runs.at(-1).id) : [] };
    }
    db.close();
  }
} catch {}

// Export kit: the handoff package (START-HERE, prompts, single-file AI package, starter files) so the dashboard can copy / download them directly.
if (handoffDir && exists(path.join(handoffDir, 'START-HERE.md'))) {
  const textOf = (rel_) => { const f = path.join(handoffDir, rel_); try { return exists(f) && fs.statSync(f).size <= 1.5 * 1024 * 1024 ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
  const walk = (d) => (exists(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  const promptMd = textOf('PROMPT.md') || '';
  const prompts = {}; for (const key of ['A', 'B', 'C']) { const m = promptMd.match(new RegExp('## ' + key + '\\.[^\\n]*\\n```\\n([\\s\\S]*?)\\n```')); if (m) prompts[key] = m[1]; }
  let budget = 4 * 1024 * 1024; const files = [];
  const add_ = (name, text) => { if (text != null && budget - text.length > 0) { budget -= text.length; files.push({ name, text }); } };
  add_('AI-PACKAGE.md', textOf('AI-PACKAGE.md')); add_('START-HERE.md', textOf('START-HERE.md')); add_('PROMPT.md', promptMd); add_('ai-brief.md', textOf('ai-brief.md')); add_('tokens/tokens.css', textOf('tokens/tokens.css'));
  for (const f of walk(path.join(handoffDir, 'starter')).sort()) add_(path.relative(handoffDir, f).split(path.sep).join('/'), /\.(html|css|js)$/.test(f) ? textOf(path.relative(handoffDir, f)) : null);
  const relOf = (f) => path.relative(handoffDir, f).split(path.sep).join('/'); // judge RELATIVE paths: the output folder's own name must not change the counts
  const imgs = walk(path.join(handoffDir, 'media')).filter((f) => /\.png$/.test(f)).map(relOf);
  try { // optional: verify/verify.json from `site-explorer verify` (rebuilt starter vs the original), with its difference images
    const v = readJSON(path.join(handoffDir, 'verify', 'verify.json'));
    data.verify = { overall: v.overall, grade: v.grade, minScore: v.minScore, passed: v.passed, pages: (v.pages || []).map((p) => ({ page: String(p.page), score: p.score, sections: (p.sections || []).map((x) => ({ name: String(x.name), status: String(x.status), score: x.score, grade: x.grade, layout: x.layout, colour: x.colour, height: x.height, refHeight: x.refHeight, gotHeight: x.gotHeight, diff: x.diff && !/\.\./.test(x.diff) ? ref(path.join(handoffDir, 'verify', x.diff)) : null })) })) };
  } catch {}
  data.exportKit = { dir: handoffDir, prompts, files, hasMotion: exists(path.join(handoffDir, 'starter', 'motion')), starterPages: walk(path.join(handoffDir, 'starter')).map(relOf).filter((f) => /^starter\/[^/]+\.html$/.test(f)).length, images: imgs.length, sectionImages: imgs.filter((f) => /^media\/sections\//.test(f)).length, motionImages: imgs.filter((f) => /^media\/motion\//.test(f)).length };
}

// "About this folder": where things are, what ran here, how to rerun (shown in the dashboard's 關於 tab)
{
  let runs = []; try { runs = JSON.parse(fs.readFileSync(path.join(outDir, 'runs.json'), 'utf8')); } catch {}
  let toolVersion = null; try { toolVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch {}
  data.about = { outputDir: outDir, dashboard: outFile, runs, toolVersion, node: process.version, platform: process.platform, outEnv: process.env.SITE_EXPLORER_OUT || null, homeDir: process.env.SITE_EXPLORER_HOME || null,
    depsDir: path.join(process.env.SITE_EXPLORER_HOME || path.join(os.homedir(), '.site-explorer'), 'deps'), dbFile: process.env.SITE_EXPLORER_DB || path.join(process.env.SITE_EXPLORER_HOME || path.join(os.homedir(), '.site-explorer'), 'explorations.db'),
    hasAboutFile: fs.existsSync(path.join(outDir, 'ABOUT-THIS-FOLDER.md')), hasHandoff: !!(siteDir && fs.existsSync(path.join(siteDir, 'handoff'))) };
}

// UI lives in plain files (report/report.css, report/report-client.js) so it is editable without template-literal escaping.
const read = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'report', f), 'utf8');
const clientSrc = read('report-client.js') + '\n' + read('report-checks.js');
// English dashboards carry the part of the dictionary that the browser-side code uses (keys are the Chinese source strings)
const enDict = Object.fromEntries(Object.entries(dictionary()).filter(([k]) => WHY_KEYS.includes(k) || (() => { const piece = k.split('{}').sort((a, b) => b.length - a.length)[0]; return piece && clientSrc.includes(piece); })()));
const html = `<!doctype html>
<html lang="${htmlLang()}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file: 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src file: 'self' data:"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_t('Site Explorer 報告')}</title>
<style>
${read('report.css')}
</style></head><body>
<header><h1>🔍 ${_t('網站探索報告')}</h1><div class="sub" id="sub"></div></header>
<nav><div class="in" id="tabs"></div></nav>
<main>
<section id="s-overview"></section><section id="s-design"></section><section id="s-layout"></section>
<section id="s-content"></section><section id="s-motion"></section><section id="s-edit"></section><section id="s-health"></section><section id="s-security"></section><section id="s-perf"></section><section id="s-privacy"></section><section id="s-tech"></section><section id="s-visual"></section><section id="s-extract"></section><section id="s-history"></section><section id="s-export"></section><section id="s-data"></section><section id="s-about"></section>
</main><div class="toast" id="toast"></div>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>window.__EN=${JSON.stringify(enDict).replace(/</g, '\\u003c')}</script>
<script>
${clientSrc.replace(/<\/script/gi, '<\\/script')}
</script></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log('Dashboard:', outFile);
