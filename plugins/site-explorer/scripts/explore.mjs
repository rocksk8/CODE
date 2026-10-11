#!/usr/bin/env node
// One command: check → crawl → design bundle → SEO health → 3D capture → database → dashboard → handoff package.
//   explore.mjs <url> [--max-pages 6] [--out ./explore-out] [--no-motion] [--no-db] [--wait 4000]
import { _t, LANG } from './i18n.mjs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, printChecks } from './doctor.mjs';
import { warnNoSandboxOnce } from './launch.mjs';
import { openDb, ingest, runsForHost, renderChangesMd, DB_PATH } from './db.mjs';
import { findUrl, findUrls, intOpt, sameSite, normalizeFlags } from './args.mjs';
import { stripControl } from './untrusted.mjs';
import { isInside, checkExploreOut, UnsafeOutputError } from './safe-out.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const __n = normalizeFlags(process.argv.slice(2)); if (__n.error) { console.error(__n.error); process.exit(1); }
const args = __n.args;
const url = findUrl(args);
const JSON_MODE = args.includes('--json');
if (JSON_MODE) { console.log = (...a) => console.error(...a); } // stdout carries ONLY the final JSON object
const __errs = []; let __jsonDone = false;
if (JSON_MODE) { // an early failure (bad flag, unwritable folder…) must still leave one parseable JSON document on stdout
  const __e = console.error; console.error = (...a) => { __errs.push(a.join(' ')); __e(...a); };
  process.on('exit', (code) => { if (!__jsonDone && code !== 0) { try { fs.writeSync(1, JSON.stringify({ ok: false, exitCode: code, error: __errs.filter((x) => x.trim()).slice(-3).join(' | ').slice(0, 600) }) + '\n'); } catch {} } });
}
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const USAGE = _t`用法：site-explorer explore <網址> [更多網址…] [選項]    （網址可省略 https://；可一次給多個頁面，第一個是起點）
  --max-pages 6        最多爬幾頁
  --out ./explore-out  輸出資料夾（預設：目前資料夾下的 explore-out；也可設環境變數 SITE_EXPLORER_OUT 一次指定）
  --no-motion          不擷取 3D／動畫          --no-health   不做 SEO／索引健檢
  --no-link-check      健檢時不檢查連結狀態      --no-handoff  不產生交接包
  --no-db              不存入歷史資料庫          --wait 4000   3D 擷取前等待毫秒
  --json               stdout 只輸出一份機器可讀的 JSON 結果（人看的進度改走 stderr；給程式、CI、MCP 用）
  --storage-state f.json  用 site-explorer login 產生的登入狀態探索登入後的頁面（輸出可能含個人資料，請勿公開）
  --framework react    交接包之外，另產生 React／Vue／Astro 專案或 shadcn/ui 主題（react|vue|astro|shadcn|all）
  --a11y               加做無障礙檢查（axe-core，WCAG 2.2 AA）；結果併入健檢分數與報告
  --verify             交接包產生後，順便驗證 starter 骨架和原站像不像（逐區塊相似度＋差異圖，結果進儀表板）
  --motion-pages 5     3D／動畫擷取的頁數上限（含起始頁；1 = 只擷取起始頁）
  --headed             顯示瀏覽器視窗（可親手點「進入」；對防機器人／整頁 3D 網站較有效）
  --open | --no-open   完成後是否自動開啟儀表板  --no-standalone  儀表板不內嵌圖片
  --fail-on high       健檢有「高」以上問題時，以結束代碼 4 結束（可填 critical／high／medium／low；給自動化／CI 用）
結束代碼：0 成功；1 失敗或參數錯誤；4 健檢未達 --fail-on 門檻`;
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
{ // a misspelled flag must fail loudly: "--fial-on high" silently turning a CI gate off is worse than an error
  const KNOWN = new Set(['--a11y', '--fail-on', '--framework', '--headed', '--help', '-h', '--json', '--max-pages', '--motion-pages', '--no-db', '--no-handoff', '--no-health', '--no-link-check', '--no-motion', '--no-open', '--no-standalone', '--open', '--out', '--storage-state', '--verify', '--wait', '--yes', '--lang']); // (--lang=xx is normalised below)
  const unknown = args.filter((a) => a.startsWith('--') && !KNOWN.has(a) && !/^--lang=/.test(a));
  if (unknown.length) { const near = (u) => [...KNOWN].find((k) => k.length > 3 && (k.startsWith(u) || u.startsWith(k) || [...u].filter((c) => k.includes(c)).length >= k.length - 2 && Math.abs(k.length - u.length) <= 2)); console.error(_t`不認得的選項：${unknown.join(' ')}${near(unknown[0]) ? _t`（是不是 ${near(unknown[0])}？）` : ''}\n執行 site-explorer explore --help 看全部選項。`); process.exit(1); }
  if (args.some((a, i) => ['--out', '--storage-state', '--framework', '--fail-on'].includes(args[i - 1]) && a === '')) { console.error(_t('選項的值不能是空的。')); process.exit(1); }
}
if (!url) {
  const flagsWithValue = new Set(['--max-pages', '--out', '--wait', '--motion-pages', '--fail-on', '--storage-state', '--framework']);
  const bad = args.find((a, i) => !a.startsWith('-') && !flagsWithValue.has(args[i - 1]));
  if (bad) console.error(_t`「${bad}」不是有效的網址。請給完整網站位址，例如：site-explorer explore https://example.com\n`);
  console.error(USAGE); process.exit(1);
}
const stateFile = opt('storage-state', null); // logged-in exploration: the session file is passed to the crawler and the 3D capture only
const authArgs = stateFile ? ['--storage-state', path.resolve(stateFile)] : [];
const noDb = args.includes('--no-db') || !!stateFile; // logged-in content must not be kept in the shared history database
const framework = opt('framework', null);
if (framework && !['react', 'vue', 'astro', 'shadcn', 'all'].includes(framework)) { console.error(_t('--framework 需要 react／vue／astro／shadcn／all 其中之一')); process.exit(1); }
if (framework && args.includes('--no-handoff')) { console.error(_t('--framework 需要交接包，不能和 --no-handoff 一起用。')); process.exit(1); }
const failOn = opt('fail-on', null);
if (failOn && args.includes('--no-health')) { console.error(_t('--fail-on 需要健檢，不能和 --no-health 一起用。')); process.exit(1); }
if (failOn && !['critical', 'high', 'medium', 'low'].includes(failOn)) { console.error(_t('--fail-on 需要 critical／high／medium／low 其中之一')); process.exit(1); }
const urlsGiven = findUrls(args).filter((u) => { try { return sameSite(u, url); } catch { return false; } }).length; // only URLs the crawler will accept (same site as the first) raise the limits
const maxPages = Math.max(intOpt(args, 'max-pages', 6, { min: 1, max: 500 }), urlsGiven), waitMs = intOpt(args, 'wait', 4000, { min: 0, max: 60000 });

const out = path.resolve(opt('out', process.env.SITE_EXPLORER_OUT || './explore-out'));
if (isInside(out, path.resolve(here, '..'))) { console.error(_t`輸出資料夾不能放在外掛目錄內（${out}）：外掛更新或重新安裝時會被清掉。請改用你專案裡的資料夾，例如 --out ./explore-out`); process.exit(1); }
try { checkExploreOut(out); fs.mkdirSync(out, { recursive: true }); if (!fs.existsSync(path.join(out, 'ABOUT-THIS-FOLDER.md'))) fs.writeFileSync(path.join(out, 'ABOUT-THIS-FOLDER.md'), _t('# site-explorer 輸出資料夾（探索進行中）\n')); } // marks the folder as ours right away
catch (e) { if (e instanceof UnsafeOutputError) { console.error(e.message); process.exit(1); } console.error(_t`無法建立輸出資料夾「${out}」：${e.code || e.message}。請改用 --out 指定一個你有寫入權限的資料夾。`); process.exit(1); }
if (stateFile) { try { fs.chmodSync(out, 0o700); } catch {} } // logged-in output may hold personal data: only the owner may read the folder
const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
const siteRoot = path.join(out, 'site'), motionRoot = path.join(out, 'motion');
const siteDir = path.join(siteRoot, host), motionDir = path.join(motionRoot, host);
const steps = [];
const total = 7 - ['--no-motion', '--no-health', '--no-handoff'].filter((f) => args.includes(f)).length - (noDb ? 1 : 0) + (args.includes('--a11y') ? 1 : 0) + (framework ? 1 : 0) + (args.includes('--verify') && !args.includes('--no-handoff') ? 1 : 0);
let n = 0;

function run(label, script, a) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n[${++n}/${total}] ${label}`);
    const p = spawn(process.execPath, [path.join(here, script), ...a], { env: { ...process.env, SITE_EXPLORER_LANG: LANG } });
    let tail = '';
    const onData = (d) => { tail = (tail + d).slice(-4000); for (const l of String(d).split('\n').map(stripControl)) if (l.trim() && !/ExperimentalWarning|trace-warnings|agent-proxy|android\.clients|For details: curl/.test(l)) console.log('   ' + l); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('close', (code) => { const s = ((Date.now() - t0) / 1000).toFixed(1); steps.push({ label, ok: code === 0, s }); console.log(code === 0 ? `   ✔ ${s}s` : _t`   ✖ 失敗（${s}s）— 其他階段會繼續`); resolve(code === 0); });
  });
}

console.log(_t`探索 ${url}\n輸出：${out}\n`);
warnNoSandboxOnce(); // once for the whole run: the stages below inherit the flag
const checks = await runChecks(url);
printChecks(checks);
if (checks.some((c) => c.level === 'fail')) {
  try { const left = fs.readdirSync(out); if (left.length === 1 && left[0] === 'ABOUT-THIS-FOLDER.md') fs.rmSync(out, { recursive: true, force: true }); } catch {} // do not leave an empty folder behind
  console.error(_t('\n環境檢查未通過，請先依上方建議處理。')); process.exit(1);
}

{ // results of stages that do not run this time must not be shown as if they were fresh (an old health score, a11y report, verify result or changes.md)
  const rm = (f) => { try { fs.rmSync(f, { recursive: true, force: true }); } catch {} };
  rm(path.join(siteDir, 'changes.md')); rm(path.join(siteDir, 'site.json')); // a failed re-run must not report the previous run's pages
  if (args.includes('--no-health')) { rm(path.join(siteDir, 'health.json')); rm(path.join(siteDir, 'health.md')); }
  if (!args.includes('--a11y')) rm(path.join(siteDir, 'a11y.json'));
  if (!args.includes('--verify')) rm(path.join(out, 'handoff', 'verify'));
}
const crawlRan = await run(_t('爬取頁面、設計、內容、排版'), 'crawl.mjs', [...findUrls(args), '--max-pages', String(maxPages), '--out', siteRoot, ...authArgs, ...(args.includes('--headed') ? ['--headed'] : []), ...(args.includes('--wait') ? ['--wait', String(Math.max(waitMs, 1000))] : [])]);
const crawlOk = crawlRan && (() => { try { return (JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8')).pages || []).length > 0; } catch { return false; } })(); // a crawl that exits 0 but saved no page is a failure
if (crawlOk) await run(_t('整理設計包（tokens、Tailwind、W3C）'), 'export-design.mjs', [siteDir]);
let healthOk = false;
if (crawlOk && args.includes('--a11y')) await run(_t('無障礙檢查（axe-core）'), 'a11y.mjs', ['--site', siteDir, ...authArgs, ...(args.includes('--max-pages') ? ['--max-pages', String(maxPages)] : [])]);
if (crawlOk && !args.includes('--no-health')) healthOk = await run(_t('SEO／爬蟲索引健檢（robots、sitemap、連結、效能、安全）'), 'health-check.mjs', ['--site', siteDir, ...(args.includes('--no-link-check') ? ['--no-link-check'] : [])]);
let motionOk = false;
if (!crawlOk && !args.includes('--no-motion')) console.log(_t`\n沒有任何頁面被爬取，略過其餘階段。請檢查網址有沒有打錯、網路是否正常，或執行：site-explorer doctor ${url}`);
else if (!args.includes('--no-motion')) motionOk = await run(_t('擷取 3D／動畫畫格'), 'capture-3d.mjs', [url, '--out', motionRoot, '--wait', String(waitMs), ...authArgs, ...(args.includes('--headed') ? ['--headed'] : [])]);

// 3D／motion is per page: also capture the other crawled pages (--motion-pages N, default 5 pages in total; 1 = only the start page)
if (!args.includes('--no-motion') && crawlOk) {
  const nPages = Math.max(intOpt(args, 'motion-pages', 5, { min: 1, max: 30 }), urlsGiven);
  const entries = [];
  const addEntry = (pageUrl, slug, title, dir) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'motion.json'), 'utf8')); const t = m.targets || [];
      entries.push({ url: pageUrl, slug, title: title || '', dir: path.relative(motionDir, dir).split(path.sep).join('/'), targets: t.length, kinds: [...new Set(t.map((x) => x.kind))], three: !!(m.libs && m.libs.three), md: fs.existsSync(path.join(dir, 'motion.md')), sheet: fs.existsSync(path.join(dir, 'contact-sheet.html')) });
    } catch {}
  };
  if (motionOk) addEntry(url, '(start)', '', motionDir);
  let pg = []; try { pg = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8')).pages || []; } catch {}
  const extra = pg.filter((p, i) => i > 0 && p.status === 200).slice(0, nPages - 1); // pages[0] is the start page after redirects (naked host -> www)
  if (pg[0] && entries[0]) entries[0].url = pg[0].url;
  for (const p of extra) {
    const dest = path.join(motionRoot, '_pages', p.slug), t0 = Date.now();
    console.log(_t`   3D／動畫：${p.url}`);
    const ok = await new Promise((resolve) => { const c = spawn(process.execPath, [path.join(here, 'capture-3d.mjs'), p.url, '--out', dest, '--wait', String(waitMs), ...(args.includes('--headed') ? ['--headed'] : [])], { env: process.env, stdio: 'ignore' }); c.on('close', (code) => resolve(code === 0)); });
    const hostDir = path.join(dest, new URL(p.url).host.replace(/[^a-z0-9.-]/gi, '_'));
    if (ok) { addEntry(p.url, p.slug, p.title, hostDir); console.log(`     ✔ ${((Date.now() - t0) / 1000).toFixed(1)}s`); } else console.log(_t('     ✖ 略過（失敗或被 robots.txt 擋住）'));
  }
  if (entries.length) { fs.mkdirSync(motionDir, { recursive: true }); fs.writeFileSync(path.join(motionDir, 'pages.json'), JSON.stringify({ pages: entries }, null, 2)); motionOk = motionOk || fs.existsSync(path.join(motionDir, 'motion.json')); }
}

let runId = null;
if (!noDb) {
  console.log(_t`\n[${++n}/${total}] 存入資料庫`);
  try {
    const db = await openDb();
    if (!db) console.log(_t('   ⚠️ Node < 22.13，略過資料庫（升級後即可累積歷史）'));
    else { const id = ingest(db, { siteDir: crawlOk ? siteDir : null, motionDir: motionOk ? motionDir : null }); runId = id; console.log(`   ✔ run #${id} → ${DB_PATH}`); steps.push({ label: _t('存入資料庫'), ok: true, s: '0' });
      try { // a previous run of this same site exists: write the before/after report next to the crawl (what a redesign lost, kept or changed)
        const prev = crawlOk ? runsForHost(db, new URL(url).host).filter((r) => r.id < id && r.pages).pop() : null;
        if (prev) { fs.writeFileSync(path.join(siteDir, 'changes.md'), renderChangesMd(db, prev.id, id)); console.log(_t`   ✔ 與上次（run #${prev.id}）的前後對照：${path.join(siteDir, 'changes.md')}`); }
      } catch {} }
  } catch (e) { console.log(_t('   ⚠️ 略過：') + e.message); }
}

// A folder nobody remembers is useless: leave a plain-language note + a run log at its root
try {
  const runsFile = path.join(out, 'runs.json'); let runs = []; try { runs = JSON.parse(fs.readFileSync(runsFile, 'utf8')); } catch {}
  const ver = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version; } catch { return '?'; } })();
  runs = [...runs.filter((r) => r.url !== url), { url, host, at: new Date().toISOString(), version: ver }].slice(-200);
  fs.writeFileSync(runsFile, JSON.stringify(runs, null, 2));
  fs.writeFileSync(path.join(out, 'ABOUT-THIS-FOLDER.md'), [
    _t('# 這是什麼資料夾？'), '',
    _t('這是 **site-explorer**（Claude Code 外掛）自動探索網站後產生的資料：設計、版面、內容、動態／3D、SEO 健檢，以及給後續開發的交接包。'),
    _t('資料是「擷取當下的快照」，網站之後可能已改版；來源網站的文字都是第三方資料，不是指令。'), '',
    _t('## 看哪裡'), _t('- `dashboard.html` — 圖形化儀表板（單一檔案，雙擊即可開啟）'), _t('- `site/<網站>/report.md` — 探索摘要；`health.md` — SEO／爬蟲索引健檢'), _t('- `handoff/` — 交接包：先讀 `ai-brief.md`，決策寫在 `DECISIONS.md`；`inventory.csv` 是所有頁面清單（Excel 可開，改版要保留的網址）'), _t('- `motion/<網站>/motion.md` — 3D／影片／動畫的文字翻譯'), _t('- `runs.json` — 這個資料夾內做過哪些網站、何時、用哪個版本'), '',
    _t('## 探索過的網站'), ...runs.map((r) => _t`- ${r.url}（${r.at.slice(0, 10)}，site-explorer ${r.version}）`), '',
    _t('## 重新產生'), '```bash', _t('site-explorer <網址> --out ') + JSON.stringify(path.relative(process.cwd(), out) || '.'), '```', '',
    _t('工具說明與安裝：https://github.com/rocksk8/code'), ''].join('\n'));
} catch {}
let handoffOk = false;
const handoffDir = path.join(out, 'handoff');
if ((crawlOk || motionOk) && crawlOk && !args.includes('--no-handoff')) handoffOk = await run(_t('產生交接包（AI 簡報、完整規格、決策紀錄、圖片）'), 'build-handoff.mjs', ['--site', siteDir, ...(motionOk ? ['--motion', motionDir] : []), '--out', handoffDir]);
if (handoffOk && args.includes('--verify')) await run(_t('驗證重建（starter 對照原站，逐區塊相似度）'), 'verify.mjs', [handoffDir]);
if (handoffOk && framework) await run(_t`轉成 ${framework} 專案（handoff/frameworks/）`, 'frameworks.mjs', [handoffDir, '--to', framework]);
const dash = path.join(out, 'dashboard.html');
if (!crawlOk && !motionOk) console.log(_t('\n探索沒有成功，略過儀表板與交接包。請先處理上面的錯誤（可執行 site-explorer doctor 檢查環境），再重新執行。'));
else await run(_t('產生圖形化儀表板'), 'build-report.mjs', [...(crawlOk ? ['--site', siteDir] : []), ...(motionOk ? ['--motion', motionDir] : []), '--out', dash, ...(handoffOk ? ['--handoff', handoffDir] : []), ...(args.includes('--no-standalone') ? [] : ['--standalone'])]);

const failed = steps.filter((s) => !s.ok);
console.log(_t`\n完成：${steps.length - failed.length}/${steps.length} 階段成功${failed.length ? _t('，失敗：') + failed.map((f) => f.label).join(_t('、')) : ''}`);
try { const hj = path.join(siteDir, 'health.json'); if (healthOk && fs.existsSync(hj)) { const h = JSON.parse(fs.readFileSync(hj, 'utf8')); console.log(_t`健檢：${h.score}/100（${h.grade}）— 嚴重 ${h.severity.critical}・高 ${h.severity.high}・中 ${h.severity.medium}　詳見 ${path.join(siteDir, 'health.md')}`); } } catch {}
if (!args.includes('--no-motion')) { // always say what happened to 3D / animation, so its absence from the summary never looks like the feature vanished
  try {
    const pj = path.join(motionDir, 'pages.json'); const pgs = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, 'utf8')).pages : [];
    const mj = path.join(motionDir, 'motion.json'); const m = fs.existsSync(mj) ? JSON.parse(fs.readFileSync(mj, 'utf8')) : null;
    if (!motionOk || (!m && !pgs.length)) console.log(_t('3D／動畫：這次沒有擷取成功（看上面「擷取 3D／動畫畫格」那一段的原因；可試 --headed 或 --wait 8000）'));
    else {
      const total = pgs.length ? pgs.reduce((n, x) => n + (x.targets || 0), 0) : (m.targets || []).length;
      const withAny = pgs.filter((x) => x.targets).length;
      console.log(_t`3D／動畫：${total ? _t`偵測到 ${total} 個元素${pgs.length ? _t`（${withAny}/${pgs.length} 頁有）` : ''}，AI 可讀的文字說明：${path.join(motionDir, 'motion.md')}${handoffOk ? _t('（也複製在 handoff/motion.md，畫格序列圖在 handoff/media/motion/）') : ''}` : _t('沒有偵測到 3D 或動畫元素（若網站其實有，常見原因是整頁 3D 要先點「進入」、或需要顯示卡：可試 --headed）')}`);
    }
  } catch {}
}
const hasMotionLine = fs.existsSync(path.join(handoffDir, 'starter', 'motion')) ? _t('、B=做動態／3D') : '';
if (handoffOk) console.log(_t`交接包：${handoffDir}\n  要交給 AI：把整個資料夾給它，再貼 PROMPT.md 裡的提示（A=做頁面${hasMotionLine}）；可直接開跑的骨架在 starter/（動態在 starter/motion/index.html）；沒辦法附檔就貼 AI-PACKAGE.md\n  人先看 START-HERE.md；完整規格 SPEC.md；決策紀錄 DECISIONS.md`);
if (fs.existsSync(dash)) {
  const mb = (fs.statSync(dash).size / 1048576).toFixed(1);
  console.log(_t`儀表板：${dash}（${mb} MB${args.includes('--no-standalone') ? _t('，需連同資料夾一起搬移') : _t('，單一檔案，可直接寄送或丟進聊天室')}）\n  開啟：${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} "${dash}"`);
  // open it for humans at a terminal; never when driven by another program (e.g. Claude Code)
  if (args.includes('--open') || (process.stdout.isTTY && !args.includes('--no-open'))) {
    const [cmd, a] = process.platform === 'darwin' ? ['open', [dash]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', dash]] : ['xdg-open', [dash]];
    try { spawn(cmd, a, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
  }
}
let failCode = 0;
if (failOn && !healthOk) { failCode = 1; console.error(_t`--fail-on ${failOn} 需要這次健檢成功，但健檢${args.includes('--no-health') ? _t('被 --no-health 略過') : _t('沒有完成')}；為避免用舊結果誤判，以結束代碼 1 結束。`); }
try { const hj = path.join(siteDir, 'health.json'); if (healthOk && fs.existsSync(hj)) { const h = JSON.parse(fs.readFileSync(hj, 'utf8')); console.log(_t`驗收結論：${h.verdict?.label ?? '—'}`); if (failOn) { const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }; if (h.issues.some((i) => rank[i.severity] <= rank[failOn])) { failCode = 4; console.error(_t`健檢有 ${failOn} 以上的問題，依 --fail-on ${failOn} 以結束代碼 4 結束。`); } } } } catch {}
if (fs.existsSync(dash)) console.log(_t('\n👉 下一步：先雙擊 dashboard.html 看總覽；要交給 AI 或工程師，就把 handoff 資料夾整個給對方。'));
if (fs.existsSync(path.join(siteDir, 'report.md')) && fs.readFileSync(path.join(siteDir, 'report.md'), 'utf8').includes(_t('被擋住'))) console.log(_t('\n⚠️ 部分頁面被擋住，結果可能不完整（見儀表板或 report.md）。'));
if (JSON_MODE) { __jsonDone = true; const { buildSummary } = await import('./summary.mjs'); process.stdout.write(JSON.stringify({ ok: !!(crawlOk || motionOk) && failCode === 0, exitCode: crawlOk || motionOk ? failCode : 1, ...buildSummary({ out, host, steps, url, fresh: !!(crawlOk || motionOk) }), runId }, null, 2) + '\n'); }
process.exit(crawlOk || motionOk ? failCode : 1);
