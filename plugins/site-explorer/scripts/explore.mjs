#!/usr/bin/env node
// One command: check → crawl → design bundle → 3D capture → database → dashboard.
//   explore.mjs <url> [--max-pages 6] [--out ./explore-out] [--no-motion] [--no-db] [--wait 4000]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, printChecks } from './doctor.mjs';
import { openDb, ingest, DB_PATH } from './db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
if (!url || args.includes('--help')) { console.log('Usage: explore.mjs <url> [--max-pages 6] [--out ./explore-out] [--no-motion] [--no-db] [--wait 4000]'); process.exit(url ? 0 : 1); }

const out = path.resolve(opt('out', './explore-out'));
const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
const siteRoot = path.join(out, 'site'), motionRoot = path.join(out, 'motion');
const siteDir = path.join(siteRoot, host), motionDir = path.join(motionRoot, host);
const steps = [];
const total = 5 - (args.includes('--no-motion') ? 1 : 0) - (args.includes('--no-db') ? 1 : 0);
let n = 0;

function run(label, script, a) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n[${++n}/${total}] ${label}`);
    const p = spawn(process.execPath, [path.join(here, script), ...a], { env: process.env });
    let tail = '';
    const onData = (d) => { tail = (tail + d).slice(-4000); for (const l of String(d).split('\n')) if (l.trim() && !/ExperimentalWarning|trace-warnings|agent-proxy|android\.clients|For details: curl/.test(l)) console.log('   ' + l); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('close', (code) => { const s = ((Date.now() - t0) / 1000).toFixed(1); steps.push({ label, ok: code === 0, s }); console.log(code === 0 ? `   ✔ ${s}s` : `   ✖ 失敗（${s}s）— 其他階段會繼續`); resolve(code === 0); });
  });
}

console.log(`探索 ${url}\n輸出：${out}\n`);
const checks = await runChecks(url);
printChecks(checks);
if (checks.some((c) => c.level === 'fail')) { console.error('\n環境檢查未通過，請先依上方建議處理。'); process.exit(1); }

const crawlOk = await run('爬取頁面、設計、內容、排版', 'crawl.mjs', [url, '--max-pages', opt('max-pages', '6'), '--out', siteRoot]);
if (crawlOk) await run('整理設計包（tokens、Tailwind、W3C）', 'export-design.mjs', [siteDir]);
let motionOk = false;
if (!args.includes('--no-motion')) motionOk = await run('擷取 3D／動畫畫格', 'capture-3d.mjs', [url, '--out', motionRoot, '--wait', opt('wait', '4000')]);

if (!args.includes('--no-db')) {
  console.log(`\n[${++n}/${total}] 存入資料庫`);
  try {
    const db = await openDb();
    if (!db) console.log('   ⚠️ Node < 22.13，略過資料庫（升級後即可累積歷史）');
    else { const id = ingest(db, { siteDir: crawlOk ? siteDir : null, motionDir: motionOk ? motionDir : null }); console.log(`   ✔ run #${id} → ${DB_PATH}`); }
  } catch (e) { console.log('   ⚠️ 略過：' + e.message); }
}

const dash = path.join(out, 'dashboard.html');
await run('產生圖形化儀表板', 'build-report.mjs', [...(crawlOk ? ['--site', siteDir] : []), ...(motionOk ? ['--motion', motionDir] : []), '--out', dash]);

const failed = steps.filter((s) => !s.ok);
console.log(`\n完成：${steps.length - failed.length}/${steps.length} 階段成功${failed.length ? '，失敗：' + failed.map((f) => f.label).join('、') : ''}`);
if (fs.existsSync(dash)) console.log(`儀表板：${dash}\n  Mac 開啟：open "${dash}"`);
if (fs.existsSync(path.join(siteDir, 'report.md')) && fs.readFileSync(path.join(siteDir, 'report.md'), 'utf8').includes('被擋住')) console.log('\n⚠️ 部分頁面被擋住，結果可能不完整（見儀表板或 report.md）。');
process.exit(crawlOk || motionOk ? 0 : 1);
