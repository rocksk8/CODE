#!/usr/bin/env node
// Local knowledge base of explorations (SQLite via node:sqlite, Node >= 22.13).
//   db.mjs ingest --site DIR [--motion DIR]     store a run
//   db.mjs list                                  all runs
//   db.mjs search [--lib three] [--platform WordPress] [--font Georgia] [--color "#e4572e"] [--has-3d] [--health-below 60]
//   db.mjs history <host>                        runs of one site + what changed
//   db.mjs compare <runId> <runId>               side-by-side diff
//   db.mjs export [--out file.json]              dump everything as JSON
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './util.mjs';
import { requireExtension, UnsafeOutputError } from './safe-out.mjs';
import { BANNER, sanitizeDoc, clean } from './untrusted.mjs';

export const DB_PATH = process.env.SITE_EXPLORER_DB || path.join(os.homedir(), '.site-explorer', 'explorations.db');
const SCHEMA_VERSION = 2;

export async function openDb(file = DB_PATH) {
  let DatabaseSync;
  const warn = process.emitWarning;
  process.emitWarning = (w, ...r) => (String(w).includes('SQLite') ? undefined : warn.call(process, w, ...r));
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { return null; }
  finally { process.emitWarning = warn; }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY AUTOINCREMENT, host TEXT NOT NULL, url TEXT, crawled_at TEXT, out_dir TEXT, motion_dir TEXT,
      pages INTEGER, blocked INTEGER DEFAULT 0, brand TEXT, accent TEXT, background TEXT, text_color TEXT,
      heading_font TEXT, body_font TEXT, base_unit INTEGER, dark_mode INTEGER, breakpoints TEXT, contrast_fail INTEGER,
      motion_targets INTEGER DEFAULT 0, animated_targets INTEGER DEFAULT 0, webgl INTEGER DEFAULT 0, assets3d INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS colors(run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, hex TEXT, role TEXT, uses INTEGER);
    CREATE TABLE IF NOT EXISTS pages(run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, url TEXT, title TEXT, status INTEGER, blocked TEXT, h1 TEXT, doc_height INTEGER);
    CREATE TABLE IF NOT EXISTS platforms(run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, name TEXT, how_to_edit TEXT);
    CREATE TABLE IF NOT EXISTS libs(run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, name TEXT);
    CREATE TABLE IF NOT EXISTS motion(run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, kind TEXT, selector TEXT, animates INTEGER, mouse INTEGER, w INTEGER, h INTEGER);
    CREATE INDEX IF NOT EXISTS idx_runs_host ON runs(host);
    CREATE INDEX IF NOT EXISTS idx_libs_name ON libs(name);
    CREATE INDEX IF NOT EXISTS idx_colors_run ON colors(run_id);
  `);
  // lightweight migration: older databases get the new columns
  const have = new Set(db.prepare("PRAGMA table_info(runs)").all().map((c) => c.name));
  for (const [col, type] of [['health_score', 'INTEGER'], ['health_grade', 'TEXT'], ['health_json', 'TEXT'], ['issues_critical', 'INTEGER'], ['issues_high', 'INTEGER']]) if (!have.has(col)) db.exec(`ALTER TABLE runs ADD COLUMN ${col} ${type}`);
  const havePages = new Set(db.prepare("PRAGMA table_info(pages)").all().map((c) => c.name));
  for (const [col, type] of [['description', 'TEXT'], ['words', 'INTEGER'], ['canonical', 'TEXT'], ['noindex', 'INTEGER'], ['jsonld_types', 'TEXT']]) if (!havePages.has(col)) db.exec(`ALTER TABLE pages ADD COLUMN ${col} ${type}`);
  db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function ingest(db, { siteDir, motionDir }) {
  const site = siteDir && fs.existsSync(path.join(siteDir, 'site.json')) ? readJSON(path.join(siteDir, 'site.json')) : null;
  const tokPath = siteDir && path.join(siteDir, 'design-bundle', 'tokens.json');
  const tok = tokPath && fs.existsSync(tokPath) ? readJSON(tokPath) : null;
  const motion = motionDir && fs.existsSync(path.join(motionDir, 'motion.json')) ? readJSON(path.join(motionDir, 'motion.json')) : null;
  if (!site && !motion) throw new Error(_t('找不到 site.json 或 motion.json'));
  const url = site?.startUrl || motion.url;
  const host = new URL(url).host;
  const t = tok || {};
  const targets = motion?.targets || [];
  const hl = site?.health;
  const info = db.prepare(`INSERT INTO runs(host,url,crawled_at,out_dir,motion_dir,pages,blocked,brand,accent,background,text_color,heading_font,body_font,base_unit,dark_mode,breakpoints,contrast_fail,motion_targets,animated_targets,webgl,assets3d,health_score,health_grade,health_json,issues_critical,issues_high)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    host, url, site?.crawledAt || motion?.capturedAt, siteDir ? path.resolve(siteDir) : null, motionDir ? path.resolve(motionDir) : null,
    site?.pages.length ?? null, site?.blockedPages?.length ?? 0, t.color?.brand ?? null, t.color?.accent ?? null, t.color?.background ?? null, t.color?.text ?? null,
    t.typography?.fontStack?.heading ?? null, t.typography?.fontStack?.body ?? null, t.spacing?.baseUnit ?? null, t.darkMode?.supported ? 1 : 0,
    JSON.stringify(t.breakpoints || []), (t.contrastAudit || []).filter((a) => !a.pass).length,
    targets.length, targets.filter((x) => x.animatesOnItsOwn).length, (motion?.webglContexts || []).length, (motion?.assets3d || []).length,
    hl?.score ?? null, hl?.grade ?? null, hl ? JSON.stringify(hl.categories) : null, hl?.severity?.critical ?? null, hl?.severity?.high ?? null);
  const id = Number(info.lastInsertRowid);
  const q = (sql) => db.prepare(sql);
  for (const [role, hex] of Object.entries(t.color || {})) q('INSERT INTO colors VALUES(?,?,?,?)').run(id, hex, role, null);
  for (const p of t.palette || []) q('INSERT INTO colors VALUES(?,?,?,?)').run(id, p.hex, p.kind, p.uses);
  for (const p of site?.pages || []) {
    let seo = null; try { const f = path.join(siteDir, 'pages', p.slug || '', 'page.json'); if (p.slug && fs.existsSync(f)) seo = readJSON(f).seo || null; } catch {}
    const noindex = seo ? (/noindex/i.test(seo.robotsMeta || '') || /noindex/i.test(seo.http?.headers?.['x-robots-tag'] || '') ? 1 : 0) : null;
    q('INSERT INTO pages(run_id,url,title,status,blocked,h1,doc_height,description,words,canonical,noindex,jsonld_types) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, p.url, p.title ?? null, p.status ?? null, p.blocked ?? null, (p.h1 || []).join(' / '), p.docHeight ?? null, seo?.description ?? null, seo?.words ?? null, seo?.canonical ?? null, noindex, seo ? [...new Set((seo.structuredData?.jsonld || []).flatMap((j) => j.types || []))].join(',') : null);
  }
  for (const p of site?.editing?.platforms || []) q('INSERT INTO platforms VALUES(?,?,?)').run(id, p.platform, p.howToEdit);
  if (motion) for (const [k, v] of Object.entries(motion.libs || {})) if (v && k !== 'threeRevision') q('INSERT INTO libs VALUES(?,?)').run(id, k.replace(/Script$/, ''));
  for (const m of targets) q('INSERT INTO motion VALUES(?,?,?,?,?,?,?)').run(id, m.kind, m.selector, m.animatesOnItsOwn ? 1 : 0, m.reactsToMouse ? 1 : 0, m.box?.w ?? null, m.box?.h ?? null);
  return id;
}

/** "#00e", "0000ee", "#0000EE" -> "#0000ee"; anything else -> null */
export const normalizeHex = (c) => { const m = String(c ?? '').trim().replace(/^#/, '').toLowerCase(); if (/^[0-9a-f]{3}$/.test(m)) return '#' + [...m].map((x) => x + x).join(''); return /^[0-9a-f]{6}$/.test(m) ? '#' + m : null; };
// --- color distance (RGB euclid) ---
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

export function runsForHost(db, host) { return db.prepare('SELECT * FROM runs WHERE host=? ORDER BY id').all(host); }

export function describeRun(db, id) {
  const run = db.prepare('SELECT * FROM runs WHERE id=?').get(id);
  if (!run) return null;
  return {
    run,
    roles: Object.fromEntries(db.prepare("SELECT role,hex FROM colors WHERE run_id=? AND uses IS NULL").all(id).map((r) => [r.role, r.hex])),
    platforms: db.prepare('SELECT name FROM platforms WHERE run_id=?').all(id).map((r) => r.name),
    libs: db.prepare('SELECT DISTINCT name FROM libs WHERE run_id=?').all(id).map((r) => r.name),
  };
}

export function diffRuns(db, a, b) {
  const A = describeRun(db, a), B = describeRun(db, b);
  if (!A || !B) throw new Error(_t('找不到指定的 run'));
  const changes = [];
  const cmp = (label, x, y) => { if (String(x ?? '') !== String(y ?? '')) changes.push({ label, from: x ?? '—', to: y ?? '—' }); };
  for (const role of new Set([...Object.keys(A.roles), ...Object.keys(B.roles)])) {
    const x = A.roles[role], y = B.roles[role];
    if (x && y && dist(x, y) < 12) continue; // visually identical
    cmp(_t('色彩 ') + role, x, y);
  }
  cmp(_t('標題字型'), A.run.heading_font, B.run.heading_font); cmp(_t('內文字型'), A.run.body_font, B.run.body_font);
  cmp(_t('間距基準'), A.run.base_unit, B.run.base_unit); cmp(_t('深色模式'), A.run.dark_mode ? _t('有') : _t('無'), B.run.dark_mode ? _t('有') : _t('無'));
  cmp(_t('斷點'), A.run.breakpoints, B.run.breakpoints); cmp(_t('頁數'), A.run.pages, B.run.pages);
  cmp(_t('平台'), A.platforms.join(', '), B.platforms.join(', ')); cmp(_t('對比不足項'), A.run.contrast_fail, B.run.contrast_fail);
  if (A.run.health_score != null && B.run.health_score != null) { cmp(_t('健檢分數'), _t`${A.run.health_score}（${A.run.health_grade}）`, _t`${B.run.health_score}（${B.run.health_grade}）`); cmp(_t('嚴重／高優先問題'), (A.run.issues_critical ?? 0) + (A.run.issues_high ?? 0), (B.run.issues_critical ?? 0) + (B.run.issues_high ?? 0)); }
  // only compare motion when both runs actually measured it (a --no-motion run is "unknown", not "zero")
  if (A.run.motion_dir && B.run.motion_dir) { cmp(_t('3D／動畫元素數'), A.run.motion_targets, B.run.motion_targets); cmp(_t('3D 函式庫'), A.libs.join(', '), B.libs.join(', ')); }
  return changes;
}

const pathKey = (u) => { try { const x = new URL(u); return ((x.pathname.replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/').replace(/\/+$/, '') || '/') + x.search).toLowerCase(); } catch { return String(u); } }; // /About = /about, /index.html = /
/**
 * Page-by-page before/after for a redesign. Pages are matched by PATH, so it also works when the new site
 * lives on another host (staging) — a removed path is a URL that needs a 301 or it becomes a 404.
 */
export function diffPages(db, a, b) {
  const rows = (id) => new Map(db.prepare('SELECT * FROM pages WHERE run_id=?').all(id).map((r) => [pathKey(r.url), r]));
  const A = rows(a), B = rows(b); const out = { added: [], removed: [], changed: [], unchanged: 0 };
  const live = (r) => r.status == null || r.status < 400;
  for (const [k, ra] of A) {
    const rb = B.get(k);
    if (!rb) { if (live(ra)) out.removed.push({ path: k, title: ra.title }); continue; }
    const ch = [];
    const text = (label, x, y) => { if (String(x ?? '').trim() !== String(y ?? '').trim()) ch.push({ field: label, from: x ?? '', to: y ?? '' }); };
    text(_t('標題'), ra.title, rb.title); text('h1', ra.h1, rb.h1);
    if (ra.description != null && rb.description != null) text(_t('描述'), ra.description, rb.description); // NULL = a run stored before this column existed: unknown, not "empty"
    if (ra.canonical != null && rb.canonical != null) text('canonical', pathKey(ra.canonical || ''), pathKey(rb.canonical || ''));
    if (ra.status !== rb.status) ch.push({ field: _t('狀態碼'), from: ra.status ?? '', to: rb.status ?? '' });
    if (ra.noindex != null && rb.noindex != null && ra.noindex !== rb.noindex) ch.push({ field: 'noindex', from: ra.noindex ? _t('是') : _t('否'), to: rb.noindex ? _t('是') : _t('否') });
    if (ra.words > 0 && rb.words != null && Math.abs(rb.words - ra.words) / ra.words >= 0.3) ch.push({ field: _t('字數'), from: ra.words, to: rb.words });
    if (ra.jsonld_types && ra.jsonld_types !== (rb.jsonld_types ?? '')) ch.push({ field: _t('結構化資料'), from: ra.jsonld_types, to: rb.jsonld_types || _t('（無）') });
    if (ch.length) out.changed.push({ path: k, changes: ch }); else out.unchanged++;
  }
  for (const [k, rb] of B) if (!A.has(k) && live(rb)) out.added.push({ path: k, title: rb.title });
  return out;
}

/** Plain-language before/after report: what a redesign lost, kept or changed — SEO risks first. */
export function renderChangesMd(db, a, b) {
  const A = db.prepare('SELECT * FROM runs WHERE id=?').get(a), B = db.prepare('SELECT * FROM runs WHERE id=?').get(b);
  const d = diffPages(db, a, b), settings = diffRuns(db, a, b);
  const q = (x) => clean(String(x ?? '')).replace(/[`\r\n]+/g, ' '); // page text is third-party data: one line, no markdown breakout
  const L = [_t`# 改版前後對照`, '', BANNER, '', _t`- 之前：run #${a}　${A.host}　${String(A.crawled_at || '').slice(0, 10)}`, _t`- 之後：run #${b}　${B.host}　${String(B.crawled_at || '').slice(0, 10)}`, '', _t('> 頁面以「路徑」對應，所以舊站與新站在不同網域（例如測試站）也能比。只比較兩次都有爬到的頁面。'), ''];
  const risk = [];
  if (d.removed.length) risk.push(_t`**${d.removed.length} 個舊網址在新版消失** — 沒有設定 301 就會變 404，搜尋排名與外部連結會流失。`);
  if (d.removed.length && (B.pages ?? 0) < (A.pages ?? 0)) risk.push(_t`（注意：這次只爬了 ${B.pages} 頁，上次是 ${A.pages} 頁。消失的網址可能只是這次沒爬到——先開啟確認，再決定要不要設 301。）`);
  const lostDesc = d.changed.filter((c) => c.changes.some((x) => x.field === _t('描述') && x.from && !x.to)); if (lostDesc.length) risk.push(_t`${lostDesc.length} 頁的 meta description 被拿掉了。`);
  const noidx = d.changed.filter((c) => c.changes.some((x) => x.field === 'noindex' && x.to === _t('是'))); if (noidx.length) risk.push(_t`**${noidx.length} 頁在新版變成 noindex**（不會被搜尋引擎收錄）。`);
  const errs = d.changed.filter((c) => c.changes.some((x) => x.field === _t('狀態碼') && Number(x.to) >= 400)); if (errs.length) risk.push(_t`${errs.length} 頁在新版回應錯誤狀態碼。`);
  const shrunk = d.changed.filter((c) => c.changes.some((x) => x.field === _t('字數') && x.to < x.from)); if (shrunk.length) risk.push(_t`${shrunk.length} 頁的文字量減少 30% 以上。`);
  const lostLd = d.changed.filter((c) => c.changes.some((x) => x.field === _t('結構化資料') && x.to === _t('（無）'))); if (lostLd.length) risk.push(_t`${lostLd.length} 頁的結構化資料不見了。`);
  L.push(_t('## 要先處理的風險'), ...(risk.length ? risk.map((r) => '- ' + r) : [_t('- 沒有發現明顯的 SEO 風險。')]), '');
  if (A.health_score != null && B.health_score != null) L.push(_t`健檢分數：${A.health_score}（${A.health_grade}）→ ${B.health_score}（${B.health_grade}）`, '');
  L.push(_t`## 舊網址消失（${d.removed.length}）— 需要 301 轉址`, ...(d.removed.length ? d.removed.slice(0, 200).map((r) => _t`- \`${q(r.path)}\`　${r.title ? _t('（') + q(r.title).slice(0, 120) + _t('）') : ''}`) : [_t('- 無')]), '');
  L.push(_t`## 新增的頁面（${d.added.length}）`, ...(d.added.length ? d.added.slice(0, 200).map((r) => _t`- \`${q(r.path)}\`　${r.title ? _t('（') + q(r.title).slice(0, 120) + _t('）') : ''}`) : [_t('- 無')]), '');
  L.push(_t`## 內容有變的頁面（${d.changed.length}；沒變 ${d.unchanged}）`);
  for (const c of d.changed.slice(0, 100)) { L.push(`### \`${q(c.path)}\``); for (const x of c.changes) L.push(_t`- ${x.field}：「${q(x.from).slice(0, 80)}」→「${q(x.to).slice(0, 80)}」`); }
  L.push('', _t`## 設計與技術的變化`, ...(settings.length ? settings.map((c) => _t`- ${c.label}：${c.from} → ${c.to}`) : [_t('- 沒有明顯差異')]), '');
  return sanitizeDoc(L.join('\n'));
}

export function search(db, f) {
  let rows = db.prepare('SELECT r.* FROM runs r WHERE r.id IN (SELECT MAX(id) FROM runs GROUP BY host) ORDER BY r.host').all();
  const has = (sql, ...p) => new Set(db.prepare(sql).all(...p).map((r) => r.run_id));
  if (f.lib) { const s = has('SELECT run_id FROM libs WHERE name LIKE ?', f.lib); rows = rows.filter((r) => s.has(r.id)); }
  if (f.platform) { const s = has('SELECT run_id FROM platforms WHERE name LIKE ?', '%' + f.platform + '%'); rows = rows.filter((r) => s.has(r.id)); }
  if (f.healthBelow != null) rows = rows.filter((r) => r.health_score != null && r.health_score < f.healthBelow).sort((a, b) => a.health_score - b.health_score);
  if (f.font) rows = rows.filter((r) => [r.heading_font, r.body_font].some((x) => x && x.toLowerCase().includes(f.font.toLowerCase())));
  if (f.has3d) rows = rows.filter((r) => r.motion_targets > 0 && (r.webgl > 0 || db.prepare("SELECT 1 FROM motion WHERE run_id=? AND kind IN ('webgl','css-3d','webgpu','model-viewer')").get(r.id)));
  if (f.color) rows = rows.filter((r) => [r.brand, r.accent].some((c) => c && dist(c, f.color) < (f.tolerance ?? 70))).sort((a, b) => dist(a.brand || '#000000', f.color) - dist(b.brand || '#000000', f.color));
  return rows;
}

// ---------------- CLI ----------------
if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
  const db = await openDb();
  if (!db) { console.error(_t('此功能需要 Node ≥ 22.13（內建 node:sqlite）。目前版本：') + process.version + _t('。請升級：brew install node')); process.exit(2); }
  const fmt = (r) => _t`#${String(r.id).padEnd(3)} ${r.host.padEnd(30)} ${String(r.crawled_at || '').slice(0, 10)}  頁${r.pages ?? '-'}  健檢 ${r.health_score ?? '-'}  主色 ${r.brand || '-'}  字型 ${r.heading_font || '-'}  3D/動畫 ${r.motion_targets}`;
  try { switch (cmd) {
    case 'ingest': { const id = ingest(db, { siteDir: opt('site'), motionDir: opt('motion') }); console.log(_t`已存入資料庫 run #${id}  (${DB_PATH})`); break; }
    case 'list': { const rows = db.prepare('SELECT * FROM runs ORDER BY id DESC').all(); console.log(rows.length ? rows.map(fmt).join('\n') : _t('（資料庫是空的）')); break; }
    case 'search': {
      let color = opt('color'); if (color !== undefined) { color = normalizeHex(color); if (!color) { console.error(_t('--color 需要像 #e4572e、e4572e 或 #f60 這樣的色碼')); process.exit(1); } }
      const rows = search(db, { lib: opt('lib'), platform: opt('platform'), font: opt('font'), color, has3d: rest.includes('--has-3d'), healthBelow: opt('health-below') != null ? Number(opt('health-below')) : undefined });
      console.log(rows.length ? rows.map(fmt).join('\n') : _t('沒有符合的網站')); break;
    }
    case 'history': {
      const runs = runsForHost(db, rest[0]); if (!runs.length) { console.log(_t('沒有此網站的紀錄')); break; }
      runs.forEach((r, i) => { console.log(fmt(r)); if (i) for (const c of diffRuns(db, runs[i - 1].id, r.id)) console.log(`    ↳ ${c.label}: ${c.from} → ${c.to}`); }); break;
    }
    case 'compare': {
      const [a, b] = rest.map(Number); if (!Number.isInteger(a) || !Number.isInteger(b)) { console.error(_t('用法：site-explorer history compare <runA> <runB> [--md 對照.md]（run 編號見 site-explorer history list）')); process.exit(1); }
      const A = describeRun(db, a), B = describeRun(db, b); if (!A || !B) { console.error(_t('找不到 run')); process.exit(1); }
      console.log(`A: ${fmt(A.run)}\nB: ${fmt(B.run)}\n`);
      const ch = diffRuns(db, a, b); const pd = diffPages(db, a, b);
      console.log(ch.length ? ch.map((c) => `- ${c.label}: ${c.from} → ${c.to}`).join('\n') : _t('設計／技術沒有明顯差異'));
      console.log(_t`\n頁面：消失 ${pd.removed.length}・新增 ${pd.added.length}・內容有變 ${pd.changed.length}・沒變 ${pd.unchanged}`);
      for (const r of pd.removed.slice(0, 10)) console.log(_t`  ✖ ${r.path}（需要 301）`);
      for (const c of pd.changed.slice(0, 10)) console.log(_t`  ✎ ${c.path}：${c.changes.map((x) => x.field).join(_t('、'))}`);
      const md = opt('md'); if (md) { fs.writeFileSync(requireExtension(md, /\.md$/i, '*.md'), renderChangesMd(db, a, b)); console.log(_t('已寫入改版前後對照：') + md); }
      break;
    }
    case 'export': {
      const dump = Object.fromEntries(['runs', 'colors', 'pages', 'platforms', 'libs', 'motion'].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
      const out = opt('out'); if (out) { fs.writeFileSync(requireExtension(out, /\.json$/i, '*.json'), JSON.stringify(dump, null, 2)); console.log(_t('已匯出'), out); } else console.log(JSON.stringify(dump, null, 2)); break;
    }
    default: console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).slice(0, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  } } catch (e) { console.error('✖ ' + String(e.message || e).split('\n')[0]); process.exit(1); } // one line, not a stack trace
}
