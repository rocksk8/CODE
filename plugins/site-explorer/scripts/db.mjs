#!/usr/bin/env node
// Local knowledge base of explorations (SQLite via node:sqlite, Node >= 22.13).
//   db.mjs ingest --site DIR [--motion DIR]     store a run
//   db.mjs list                                  all runs
//   db.mjs search [--lib three] [--platform WordPress] [--font Georgia] [--color "#e4572e"] [--has-3d] [--health-below 60]
//   db.mjs history <host>                        runs of one site + what changed
//   db.mjs compare <runId> <runId>               side-by-side diff
//   db.mjs export [--out file.json]              dump everything as JSON
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './util.mjs';

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
  db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function ingest(db, { siteDir, motionDir }) {
  const site = siteDir && fs.existsSync(path.join(siteDir, 'site.json')) ? readJSON(path.join(siteDir, 'site.json')) : null;
  const tokPath = siteDir && path.join(siteDir, 'design-bundle', 'tokens.json');
  const tok = tokPath && fs.existsSync(tokPath) ? readJSON(tokPath) : null;
  const motion = motionDir && fs.existsSync(path.join(motionDir, 'motion.json')) ? readJSON(path.join(motionDir, 'motion.json')) : null;
  if (!site && !motion) throw new Error('找不到 site.json 或 motion.json');
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
  for (const p of site?.pages || []) q('INSERT INTO pages VALUES(?,?,?,?,?,?,?)').run(id, p.url, p.title ?? null, p.status ?? null, p.blocked ?? null, (p.h1 || []).join(' / '), p.docHeight ?? null);
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
  if (!A || !B) throw new Error('找不到指定的 run');
  const changes = [];
  const cmp = (label, x, y) => { if (String(x ?? '') !== String(y ?? '')) changes.push({ label, from: x ?? '—', to: y ?? '—' }); };
  for (const role of new Set([...Object.keys(A.roles), ...Object.keys(B.roles)])) {
    const x = A.roles[role], y = B.roles[role];
    if (x && y && dist(x, y) < 12) continue; // visually identical
    cmp('色彩 ' + role, x, y);
  }
  cmp('標題字型', A.run.heading_font, B.run.heading_font); cmp('內文字型', A.run.body_font, B.run.body_font);
  cmp('間距基準', A.run.base_unit, B.run.base_unit); cmp('深色模式', A.run.dark_mode ? '有' : '無', B.run.dark_mode ? '有' : '無');
  cmp('斷點', A.run.breakpoints, B.run.breakpoints); cmp('頁數', A.run.pages, B.run.pages);
  cmp('平台', A.platforms.join(', '), B.platforms.join(', ')); cmp('對比不足項', A.run.contrast_fail, B.run.contrast_fail);
  if (A.run.health_score != null && B.run.health_score != null) { cmp('健檢分數', `${A.run.health_score}（${A.run.health_grade}）`, `${B.run.health_score}（${B.run.health_grade}）`); cmp('嚴重／高優先問題', (A.run.issues_critical ?? 0) + (A.run.issues_high ?? 0), (B.run.issues_critical ?? 0) + (B.run.issues_high ?? 0)); }
  // only compare motion when both runs actually measured it (a --no-motion run is "unknown", not "zero")
  if (A.run.motion_dir && B.run.motion_dir) { cmp('3D／動畫元素數', A.run.motion_targets, B.run.motion_targets); cmp('3D 函式庫', A.libs.join(', '), B.libs.join(', ')); }
  return changes;
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
  if (!db) { console.error('此功能需要 Node ≥ 22.13（內建 node:sqlite）。目前版本：' + process.version + '。請升級：brew install node'); process.exit(2); }
  const fmt = (r) => `#${String(r.id).padEnd(3)} ${r.host.padEnd(30)} ${String(r.crawled_at || '').slice(0, 10)}  頁${r.pages ?? '-'}  健檢 ${r.health_score ?? '-'}  主色 ${r.brand || '-'}  字型 ${r.heading_font || '-'}  3D/動畫 ${r.motion_targets}`;
  switch (cmd) {
    case 'ingest': { const id = ingest(db, { siteDir: opt('site'), motionDir: opt('motion') }); console.log(`已存入資料庫 run #${id}  (${DB_PATH})`); break; }
    case 'list': { const rows = db.prepare('SELECT * FROM runs ORDER BY id DESC').all(); console.log(rows.length ? rows.map(fmt).join('\n') : '（資料庫是空的）'); break; }
    case 'search': {
      let color = opt('color'); if (color !== undefined) { color = normalizeHex(color); if (!color) { console.error('--color 需要像 #e4572e、e4572e 或 #f60 這樣的色碼'); process.exit(1); } }
      const rows = search(db, { lib: opt('lib'), platform: opt('platform'), font: opt('font'), color, has3d: rest.includes('--has-3d'), healthBelow: opt('health-below') != null ? Number(opt('health-below')) : undefined });
      console.log(rows.length ? rows.map(fmt).join('\n') : '沒有符合的網站'); break;
    }
    case 'history': {
      const runs = runsForHost(db, rest[0]); if (!runs.length) { console.log('沒有此網站的紀錄'); break; }
      runs.forEach((r, i) => { console.log(fmt(r)); if (i) for (const c of diffRuns(db, runs[i - 1].id, r.id)) console.log(`    ↳ ${c.label}: ${c.from} → ${c.to}`); }); break;
    }
    case 'compare': {
      const [a, b] = rest.map(Number); const A = describeRun(db, a), B = describeRun(db, b); if (!A || !B) { console.error('找不到 run'); process.exit(1); }
      console.log(`A: ${fmt(A.run)}\nB: ${fmt(B.run)}\n`);
      const ch = diffRuns(db, a, b); console.log(ch.length ? ch.map((c) => `- ${c.label}: ${c.from} → ${c.to}`).join('\n') : '兩者沒有明顯差異'); break;
    }
    case 'export': {
      const dump = Object.fromEntries(['runs', 'colors', 'pages', 'platforms', 'libs', 'motion'].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
      const out = opt('out'); if (out) { fs.writeFileSync(out, JSON.stringify(dump, null, 2)); console.log('已匯出', out); } else console.log(JSON.stringify(dump, null, 2)); break;
    }
    default: console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).slice(0, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
}
