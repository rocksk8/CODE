#!/usr/bin/env node
// One command: check → crawl → design bundle → SEO health → 3D capture → database → dashboard → handoff package.
//   explore.mjs <url> [--max-pages 12] [--out ./explore-out] [--no-motion] [--no-db] [--wait 4000]
import { _t, LANG } from './i18n.mjs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { stageLimitMs, runLimitMs, watchChild } from './guard.mjs';
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

最常用的三種用法
  site-explorer explore example.com                    一般探索：設計、內容、健檢，產生儀表板與交接包
  site-explorer explore example.com --a11y --archive   另外做無障礙檢查，並每頁存一份離線網頁
  site-explorer explore example.com --compare          和你核准過的樣子比較（要先用 --approve 存一次基準）

【基本】
  --max-pages 12       最多爬幾頁
  --out ./explore-out  輸出資料夾（預設：目前資料夾下的 explore-out；也可設環境變數 SITE_EXPLORER_OUT 一次指定）
  --open | --no-open   完成後是否自動開啟儀表板  --no-standalone  儀表板不內嵌圖片
  --browser firefox    （實驗性）改用 Firefox 或 WebKit 探索；要先執行 site-explorer setup --browser firefox。3D／動畫與行動網路模擬仍只支援 Chromium
  --headed             顯示瀏覽器視窗（可親手點「進入」；對防機器人／整頁 3D 網站較有效）
  --wait 4000          3D 擷取前等待毫秒

【略過不需要的部分】
  --no-motion          不擷取 3D／動畫          --no-health   不做 SEO／索引健檢   --no-crawler-view   不比對爬蟲看到的內容
  --no-link-check      健檢時不檢查連結狀態      --no-handoff  不產生交接包
  --no-db              不存入歷史資料庫

【多做幾項檢查或輸出】
  --a11y               加做無障礙檢查（axe-core，WCAG 2.2 AA）；結果併入健檢分數與報告
  --verify             交接包產生後，順便驗證 starter 骨架和原站像不像（逐區塊相似度＋差異圖，結果進儀表板）
  --framework react    交接包之外，另產生 React／Vue／Astro 專案或 shadcn/ui 主題（react|vue|astro|shadcn|all）
  --motion-pages 30    3D／動畫擷取的頁數上限（含起始頁；預設是爬到的每一頁都擷取；1 = 只擷取起始頁）
  --tech-rules <規則.json> 加入你自己的技術辨識規則（辨識公司內部系統或較冷門的工具）
  --webhook <網址>     跑完後若網站變差，就把摘要（分數、變化、前 3 件事）POST 給這個網址（Slack／Teams／Discord 的 webhook 都可以）；--notify-on drop|issues|always 決定何時送（預設 drop：分數掉了 --max-drop 分以上，或高／緊急問題變多）
  --brand-guide        另外產生可列印的品牌手冊（design-bundle/brand-guide.html 與 .pdf：顏色、字型、間距、對比）
  --tokens <檔案>      用你的設計規範（W3C Design Tokens 的 JSON）檢查網站的顏色、圓角、字級有沒有符合（輸出 token-check.md）
  --max-off-token <百分比> 不符合的比例超過這個值就以結束代碼 4 結束（要搭配 --tokens）
  --perf-runs 3        速度重複量測次數（取中位數，雜訊較小；預設 1）；--throttle mobile 模擬行動網路與較慢的 CPU
  --scenarios <情境.json> 畫面情境：先點、懸停、捲動…再截圖（例如選單展開），和整頁截圖一起存基準、一起比對
  --hide <選擇器>      截圖時隱藏一直在變的區塊（時鐘、廣告…，可重複）
  --archive            每頁另存一個離線可開的單一 HTML（archive.html：CSS 與圖片內嵌、移除腳本；檔案較大）
  --har                每頁另存一份 HAR（所有網路請求與時間，可用瀏覽器開發者工具或 HAR 檢視器開啟；不含 Cookie 與密鑰；登入狀態不錄）
  --warc               每頁另存一份 WARC（標準網頁封存格式，可用 ReplayWeb.page 重播；不含 Cookie；登入狀態不錄）
  --extract <規則.json> 自訂擷取規則：用 CSS 選擇器或 regex 從每頁抽出你要的資料（價格、SKU…），輸出 extractions.csv/json

【和上次比較（改版前後、防止退步）】
  --approve            把這次的設計 token、健檢結果和整頁截圖存成基準（baseline.json；可用 --baseline <檔案> 指定位置）
  --compare            與基準比較，偏移超過容許範圍就以結束代碼 4 結束（--max-drop 5 容許掉幾分；--fail-on-new high 出現這個等級以上的新問題就失敗）
  --approve-visual <名稱,…> 只把指定的截圖更新為新基準（名稱見 visual.md；home:mobile、scenario:menu-open，或 all）
  --visual-threshold P 整頁畫面比對：每張截圖容許 P% 的像素不同（預設 0.5）；--no-visual 不存也不比整頁畫面
  --budget f.json      效能預算（例如 {"totalKB":1500,"lcpMs":{"max":2500,"level":"warn"}}）；超標的項目等級是 fail 時以結束代碼 4 結束
  --fail-on high       健檢有「高」以上問題時，以結束代碼 4 結束（可填 critical／high／medium／low）

【給自動化、CI、其他程式用】
  --json               stdout 只輸出一份機器可讀的 JSON 結果（人看的進度改走 stderr；給程式、CI、MCP 用）
  --sarif <檔案>       另外輸出 SARIF 2.1.0（GitHub code scanning 等工具可讀）
  --junit <檔案>       另外輸出 JUnit XML（Jenkins、GitLab、CircleCI、Azure DevOps 可讀）

【登入後的頁面】
  --cookie-file f      用 cookie 檔登入（Playwright 登入狀態檔、cookie 陣列 JSON、cookies.txt 或「a=1; b=2」一行）
  --header-file f.json 對網站加上自訂標頭，例如 Authorization（JSON 物件；只會送給起始網站，不會送給第三方；也可用 --header "名稱: 值"，但值會留在 shell 歷史）
  --basic-auth-file f  HTTP 基本驗證（檔案第一行寫 使用者:密碼；或設環境變數 SITE_EXPLORER_BASIC_AUTH）
  --storage-state f.json  用 site-explorer login 產生的登入狀態探索登入後的頁面（輸出可能含個人資料，請勿公開）

結束代碼：0 成功；1 失敗或參數錯誤；4 健檢未達 --fail-on 門檻
`;
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
{ // a misspelled flag must fail loudly: "--fial-on high" silently turning a CI gate off is worse than an error
  const KNOWN = new Set(['--a11y', '--archive', '--warc', '--har', '--fail-on', '--framework', '--headed', '--help', '-h', '--json', '--max-pages', '--motion-pages', '--no-db', '--no-handoff', '--no-health', '--no-crawler-view', '--no-link-check', '--no-motion', '--no-visual', '--no-open', '--no-standalone', '--open', '--out', '--storage-state', '--verify', '--wait', '--yes', '--lang', '--approve', '--compare', '--baseline', '--max-drop', '--visual-threshold', '--sarif', '--junit', '--extract', '--tech-rules', '--perf-runs', '--throttle', '--scenarios', '--hide', '--approve-visual', '--tokens', '--max-off-token', '--brand-guide', '--cookie-file', '--header', '--header-file', '--basic-auth-file', '--browser', '--fail-on-new', '--budget', '--webhook', '--notify-on']); // (--lang=xx is normalised below)
  const unknown = args.filter((a) => a.startsWith('--') && !KNOWN.has(a) && !/^--lang=/.test(a));
  if (unknown.length) { const near = (u) => [...KNOWN].find((k) => k.length > 3 && (k.startsWith(u) || u.startsWith(k) || [...u].filter((c) => k.includes(c)).length >= k.length - 2 && Math.abs(k.length - u.length) <= 2)); console.error(_t`不認得的選項：${unknown.join(' ')}${near(unknown[0]) ? _t`（是不是 ${near(unknown[0])}？）` : ''}\n執行 site-explorer explore --help 看全部選項。`); process.exit(1); }
  if (args.some((a, i) => ['--out', '--storage-state', '--framework', '--fail-on', '--baseline', '--max-drop', '--fail-on-new', '--budget', '--visual-threshold', '--sarif', '--junit', '--extract', '--tech-rules', '--perf-runs', '--throttle', '--scenarios', '--hide', '--approve-visual', '--tokens', '--max-off-token', '--cookie-file', '--header', '--header-file', '--basic-auth-file', '--browser', '--browser'].includes(args[i - 1]) && a === '')) { console.error(_t('選項的值不能是空的。')); process.exit(1); }
}
if (!url) {
  const flagsWithValue = new Set(['--max-pages', '--out', '--wait', '--motion-pages', '--fail-on', '--storage-state', '--framework', '--cookie-file', '--header', '--header-file', '--basic-auth-file', '--browser']);
  const bad = args.find((a, i) => !a.startsWith('-') && !flagsWithValue.has(args[i - 1]));
  if (bad) console.error(_t`「${bad}」不是有效的網址。請給完整網站位址，例如：site-explorer explore https://example.com\n`);
  console.error(USAGE); process.exit(1);
}
let stateFile = opt('storage-state', null); // logged-in exploration: the session file is passed to the crawler, the accessibility check and the 3D capture
{ // other ways in: a cookie file, extra request headers, HTTP basic auth (secrets stay out of every output; headers / basic auth go to the start origin only)
  const cookieFile = opt('cookie-file', null), headerFile = opt('header-file', null), basicFile = opt('basic-auth-file', null);
  const headerArgs = args.flatMap((a, i) => (a === '--header' && args[i + 1] ? [args[i + 1]] : []));
  if (cookieFile || headerFile || basicFile || headerArgs.length || process.env.SITE_EXPLORER_BASIC_AUTH) {
    try {
      const A = await import('./auth-state.mjs'); const u0 = new URL(url);
      if (stateFile && cookieFile) throw new Error(_t('--storage-state 和 --cookie-file 不能一起用。'));
      const cookies = cookieFile ? A.parseCookieFile(fs.readFileSync(path.resolve(cookieFile), 'utf8'), u0.hostname, { secure: u0.protocol === 'https:' }) : [];
      let headers = {}; if (headerFile) { let j; try { j = JSON.parse(fs.readFileSync(path.resolve(headerFile), 'utf8')); } catch (e) { if (e.code === 'ENOENT') throw e; throw new Error(_t('標頭檔必須是 {"標頭名稱": "值"} 的 JSON 物件。')); } if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(_t('標頭檔必須是 {"標頭名稱": "值"} 的 JSON 物件。')); headers = A.parseHeaders(Object.entries(j)); }
      if (headerArgs.length) headers = { ...headers, ...A.parseHeaders(headerArgs) };
      if (basicFile) process.env[A.CRED_ENV.basic] = fs.readFileSync(path.resolve(basicFile), 'utf8').split(/\r?\n/)[0];
      if (process.env[A.CRED_ENV.basic]) A.parseBasicAuth(process.env[A.CRED_ENV.basic]);
      if (Object.keys(headers).length) process.env[A.CRED_ENV.headers] = JSON.stringify(headers);
      if (!stateFile) { const t = A.writeTempStorageState(cookies); stateFile = t.file; process.on('exit', t.cleanup); }
      if (headerArgs.length) console.error(_t('⚠️  直接寫在指令列的 --header 值會留在你的 shell 歷史紀錄裡；有機密時請改用 --header-file。'));
    } catch (e) { console.error(_t('登入設定有問題：') + String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]); process.exit(1); }
  }
}
const authArgs = stateFile ? ['--storage-state', path.resolve(stateFile)] : [];
const noDb = args.includes('--no-db') || !!stateFile; // logged-in content must not be kept in the shared history database
const framework = opt('framework', null);
if (framework && !['react', 'vue', 'astro', 'shadcn', 'all'].includes(framework)) { console.error(_t('--framework 需要 react／vue／astro／shadcn／all 其中之一')); process.exit(1); }
if (framework && args.includes('--no-handoff')) { console.error(_t('--framework 需要交接包，不能和 --no-handoff 一起用。')); process.exit(1); }
const BANNER_DRIFT = () => ''; // drift.md is built from whitelisted values only
const webhookOpt = opt('webhook', null), notifyOn = opt('notify-on', 'drop');
if (webhookOpt && !/^https?:\/\//i.test(webhookOpt)) { console.error(_t('--webhook 要是 http:// 或 https:// 開頭的網址。')); process.exit(1); }
if (!['always', 'drop', 'issues'].includes(notifyOn)) { console.error(_t('--notify-on 只能是 always、drop 或 issues。')); process.exit(1); }
const failOn = opt('fail-on', null);
if (failOn && args.includes('--no-health')) { console.error(_t('--fail-on 需要健檢，不能和 --no-health 一起用。')); process.exit(1); }
if (failOn && !['critical', 'high', 'medium', 'low'].includes(failOn)) { console.error(_t('--fail-on 需要 critical／high／medium／low 其中之一')); process.exit(1); }
const approveFlag = args.includes('--approve'), compareFlag = args.includes('--compare');
if (approveFlag && compareFlag) { console.error(_t('--approve 和 --compare 不能一起用：先 --compare 確認沒問題，再另外 --approve。')); process.exit(1); }
if ((approveFlag || compareFlag) && args.includes('--no-health')) { console.error(_t('--approve／--compare 需要健檢，不能和 --no-health 一起用。')); process.exit(1); }
const visualThresholdOpt = Number(opt('visual-threshold', '0.5')); if (!(visualThresholdOpt >= 0 && visualThresholdOpt <= 100)) { console.error(_t('--visual-threshold 必須是 0–100 的數字（百分比）')); process.exit(1); }
if (opt('tokens', null)) { try { const tf = path.resolve(opt('tokens')); if (fs.statSync(tf).size > 1_000_000) throw new Error(_t('token 檔太大（上限 1 MB）。')); (await import('./token-check.mjs')).parseTokenFile(fs.readFileSync(tf, 'utf8')); } catch (e) { console.error(_t`--tokens 檔案有問題：` + String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]); process.exit(1); } }
if (opt('max-off-token', null) != null && !(Number(opt('max-off-token')) >= 0 && Number(opt('max-off-token')) <= 100)) { console.error(_t('--max-off-token 必須是 0 到 100 的數字。')); process.exit(1); }
if (opt('tech-rules', null)) { try { (await import('./techstack.mjs')).parseTechRules(fs.readFileSync(path.resolve(opt('tech-rules', null)), 'utf8')); } catch (e) { console.error(_t`--tech-rules 規則檔有問題：` + String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]); process.exit(1); } }
if (opt('scenarios', null)) { try { (await import('./scenarios.mjs')).parseScenarios(fs.readFileSync(path.resolve(opt('scenarios', null)), 'utf8')); } catch (e) { console.error(_t`--scenarios 情境檔有問題：` + String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]); process.exit(1); } }
for (let k = 0; k < args.length; k++) if (args[k] === '--hide') { if (!args[k + 1] || !/^[^{};<>@\\]{1,200}$/.test(args[k + 1])) { console.error(_t('--hide 需要一個 CSS 選擇器（不能含 { } ; < > @ \\）。')); process.exit(1); } k++; }
if (opt('extract', null)) { try { const rf = path.resolve(opt('extract', null)); (await import('./custom-extract.mjs')).parseRules(fs.readFileSync(rf, 'utf8')); } catch (e) { console.error(_t`--extract 規則檔有問題：` + String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]); process.exit(1); } }
if (opt('throttle', null) && opt('throttle') !== 'mobile') { console.error(_t('--throttle 目前只支援 mobile。')); process.exit(1); }
if (opt('perf-runs', null) && !(Number.isInteger(Number(opt('perf-runs'))) && Number(opt('perf-runs')) >= 1 && Number(opt('perf-runs')) <= 7)) { console.error(_t('--perf-runs 必須是 1 到 7 的整數。')); process.exit(1); }
if (opt('browser', null)) {
  const b = opt('browser'); if (!['chromium', 'firefox', 'webkit'].includes(b)) { console.error(_t('--browser 只能是 chromium、firefox 或 webkit。')); process.exit(1); }
  process.env.SITE_EXPLORER_BROWSER = b; // child scripts read it
  if (b !== 'chromium') { if (opt('throttle', null)) { console.error(_t('--throttle 只支援 Chromium。')); process.exit(1); } if (!args.includes('--no-motion')) { args.push('--no-motion'); console.log(_t('（實驗性的 Firefox／WebKit：略過 3D／動畫擷取，那部分只支援 Chromium。）')); } }
}
const maxDropOpt = Number(opt('max-drop', '5')); if (!(maxDropOpt >= 0 && maxDropOpt <= 100)) { console.error(_t('--max-drop 必須是 0–100 的數字')); process.exit(1); }
const failOnNewOpt = opt('fail-on-new', 'high'); if (!['critical', 'high', 'medium', 'low'].includes(failOnNewOpt)) { console.error(_t('--fail-on-new 需要 critical／high／medium／low 其中之一')); process.exit(1); }
const budgetFile = opt('budget', null); let budgetCfg = null;
if (budgetFile) { try { const { parseBudget } = await import('./perf-budget.mjs'); budgetCfg = parseBudget(fs.readFileSync(path.resolve(budgetFile), 'utf8')); } catch (e) { console.error(_t`預算檔無法使用：${String(e.code === 'ENOENT' ? _t('找不到檔案') : e.message).split('\n')[0]}`); process.exit(1); } }
const urlsGiven = findUrls(args).filter((u) => { try { return sameSite(u, url); } catch { return false; } }).length; // only URLs the crawler will accept (same site as the first) raise the limits
const maxPages = Math.max(intOpt(args, 'max-pages', 12, { min: 1, max: 500 }), urlsGiven), waitMs = intOpt(args, 'wait', 4000, { min: 0, max: 60000 });

const out = path.resolve(opt('out', process.env.SITE_EXPLORER_OUT || './explore-out'));
if (isInside(out, path.resolve(here, '..'))) { console.error(_t`輸出資料夾不能放在外掛目錄內（${out}）：外掛更新或重新安裝時會被清掉。請改用你專案裡的資料夾，例如 --out ./explore-out`); process.exit(1); }
try { checkExploreOut(out); fs.mkdirSync(out, { recursive: true }); if (!fs.existsSync(path.join(out, 'ABOUT-THIS-FOLDER.md'))) fs.writeFileSync(path.join(out, 'ABOUT-THIS-FOLDER.md'), _t('# site-explorer 輸出資料夾（探索進行中）\n')); } // marks the folder as ours right away
catch (e) { if (e instanceof UnsafeOutputError) { console.error(e.message); process.exit(1); } console.error(_t`無法建立輸出資料夾「${out}」：${e.code || e.message}。請改用 --out 指定一個你有寫入權限的資料夾。`); process.exit(1); }
if (stateFile) { try { fs.chmodSync(out, 0o700); } catch {} } // logged-in output may hold personal data: only the owner may read the folder
const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, '_');
const siteRoot = path.join(out, 'site'), motionRoot = path.join(out, 'motion');
const siteDir = path.join(siteRoot, host), motionDir = path.join(motionRoot, host);
const steps = [];
const total = 12 - ['--no-motion', '--no-health', '--no-handoff', '--no-crawler-view'].filter((f) => args.includes(f)).length - (noDb ? 1 : 0) + (args.includes('--a11y') ? 1 : 0) + (framework ? 1 : 0) + (args.includes('--tokens') ? 1 : 0) + (args.includes('--brand-guide') ? 1 : 0) + (args.includes('--verify') && !args.includes('--no-handoff') ? 1 : 0);
let n = 0;

let current = null; // the stage that is running: Ctrl-C / SIGTERM (CI timeout, MCP kill) must stop it too, not leave a browser crawling
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { current?.kill('SIGTERM'); } catch {} process.exit(sig === 'SIGINT' ? 130 : 143); });
const RUN_T0 = Date.now(), RUN_LIMIT = runLimitMs(); const notices = [];
function run(label, script, a) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n[${++n}/${total}] ${label}`);
    if (Date.now() - RUN_T0 > RUN_LIMIT) { const m = _t`⏱ 超時通知：整個探索已超過 ${Math.round(RUN_LIMIT / 60000)} 分鐘，略過這個階段。`; console.log('   ' + m); notices.push(m); steps.push({ label, ok: false, s: '0.0' }); return resolve(false); }
    const p = spawn(process.execPath, [path.join(here, script), ...a], { env: { ...process.env, SITE_EXPLORER_LANG: LANG } });
    current = p;
    let tail = '', lastOut = Date.now();
    const stopWatch = watchChild(p, { limitMs: stageLimitMs(script), lang: LANG, getLastOutputAt: () => lastOut, notify: (kind, text) => { console.log('   ' + text); if (kind === 'timeout' || kind === 'memory') notices.push(text); } });
    p.on('close', stopWatch); p.on('error', stopWatch);
    const onData = (d) => { lastOut = Date.now(); tail = (tail + d).slice(-4000); for (const l of String(d).split('\n').map(stripControl)) if (l.trim() && !/ExperimentalWarning|trace-warnings|agent-proxy|android\.clients|For details: curl/.test(l)) console.log('   ' + l); };
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
  rm(path.join(siteDir, 'changes.md')); rm(path.join(siteDir, 'site.json')); rm(path.join(siteDir, 'health.json')); rm(path.join(siteDir, 'health.md')); rm(path.join(siteDir, 'techstack.json')); rm(path.join(siteDir, 'tracking-behaviors.json')); rm(path.join(siteDir, 'security.json')); rm(path.join(siteDir, 'figma')); rm(path.join(siteDir, 'scenarios')); rm(path.join(siteDir, 'extractions.json')); rm(path.join(siteDir, 'extractions.csv')); rm(path.join(siteDir, 'security.md')); rm(path.join(siteDir, 'tracking-behaviors.md')); rm(path.join(siteDir, 'performance.json')); rm(path.join(siteDir, 'performance.md')); rm(path.join(siteDir, 'top-fixes.json')); rm(path.join(siteDir, 'crawler-view.json')); rm(path.join(siteDir, 'crawler-view.md')); rm(path.join(siteDir, 'token-check.json')); rm(path.join(siteDir, 'token-check.md')); rm(path.join(siteDir, 'top-fixes.md')); rm(path.join(siteDir, 'techstack.md')); // a failed re-run must not report the previous run's pages
  if (args.includes('--no-health')) { rm(path.join(siteDir, 'health.json')); rm(path.join(siteDir, 'health.md')); }
  if (!args.includes('--a11y')) rm(path.join(siteDir, 'a11y.json'));
  if (!compareFlag && !opt('approve-visual', null)) for (const f of ['visual.json', 'visual.md', 'visual-review.html', 'visual-diff', 'drift.md']) rm(path.join(out, f)); // a comparison from an earlier run must not be shown as this run's result
  if (!args.includes('--verify')) rm(path.join(out, 'handoff', 'verify'));
}
const crawlRan = await run(_t('爬取頁面、設計、內容、排版'), 'crawl.mjs', [...findUrls(args), '--max-pages', String(maxPages), '--out', siteRoot, ...authArgs, ...(args.includes('--headed') ? ['--headed'] : []), ...(args.includes('--archive') ? ['--archive'] : []), ...(args.includes('--warc') ? ['--warc'] : []), ...(args.includes('--har') ? ['--har'] : []), ...(opt('scenarios', null) ? ['--scenarios', path.resolve(opt('scenarios'))] : []), ...args.flatMap((a, i) => (a === '--hide' && args[i + 1] ? ['--hide', args[i + 1]] : [])), ...(opt('perf-runs', null) ? ['--perf-runs', opt('perf-runs')] : []), ...(opt('throttle', null) ? ['--throttle', opt('throttle')] : []), ...(opt('extract', null) ? ['--extract', path.resolve(opt('extract', null))] : []), ...(args.includes('--wait') ? ['--wait', String(Math.max(waitMs, 1000))] : [])]);
const crawlOk = crawlRan && (() => { try { return (JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8')).pages || []).length > 0; } catch { return false; } })(); // a crawl that exits 0 but saved no page is a failure
if (crawlOk) await run(_t('整理設計包（tokens、Tailwind、W3C）'), 'export-design.mjs', [siteDir]);
if (crawlOk && args.includes('--brand-guide')) await run(_t('品牌手冊（HTML 與 PDF）'), 'brand-guide.mjs', ['--site', siteDir, '--pdf']);
let tokenCheckFailed = false;
if (crawlOk && opt('tokens', null)) { await run(_t('對照你的設計規範（token 檔）'), 'token-check.mjs', ['--site', siteDir, '--tokens', path.resolve(opt('tokens')), ...(opt('max-off-token', null) != null ? ['--max-off-token', String(opt('max-off-token'))] : [])]); try { tokenCheckFailed = !!JSON.parse(fs.readFileSync(path.join(siteDir, 'token-check.json'), 'utf8')).failed; } catch {} }
if (opt('max-off-token', null) != null && !opt('tokens', null)) { console.error(_t('--max-off-token 要搭配 --tokens 使用。')); process.exit(1); }
let healthOk = false;
if (crawlOk && args.includes('--a11y')) await run(_t('無障礙檢查（axe-core）'), 'a11y.mjs', ['--site', siteDir, ...authArgs, ...(args.includes('--max-pages') ? ['--max-pages', String(maxPages)] : [])]);
if (crawlOk && !args.includes('--no-crawler-view') && !authArgs.length) await run(_t('爬蟲看到的 vs 訪客看到的（原始 HTML、不同爬蟲身分、結構化資料、canonical）'), 'crawler-view.mjs', ['--site', siteDir]);
if (crawlOk && !args.includes('--no-health')) healthOk = await run(_t('SEO／爬蟲索引健檢（robots、sitemap、連結、效能、安全）'), 'health-check.mjs', ['--site', siteDir, ...(args.includes('--no-link-check') ? ['--no-link-check'] : [])]);
if (crawlOk) await run(_t('技術堆疊（CMS、框架、函式庫、主機／CDN）'), 'techstack.mjs', ['--site', siteDir, ...(opt('tech-rules', null) ? ['--rules', path.resolve(opt('tech-rules', null))] : [])]);
if (crawlOk) await run(_t('Figma 匯入檔（版面草稿 SVG）'), 'figma-export.mjs', ['--site', siteDir]);
if (crawlOk) await run(_t('安全標頭與 TLS 評等'), 'security-grade.mjs', ['--site', siteDir]);
if (crawlOk) await run(_t('追蹤行為（錄製、指紋、輸入外流）'), 'tracking-behaviors.mjs', ['--site', siteDir]);
if (crawlOk) await run(_t('效能預算與歷次紀錄'), 'perf-budget.mjs', ['--site', siteDir, ...(budgetFile ? ['--budget', path.resolve(budgetFile)] : [])]);
let motionOk = false;
if (!crawlOk && !args.includes('--no-motion')) console.log(_t`\n沒有任何頁面被爬取，略過其餘階段。請檢查網址有沒有打錯、網路是否正常，或執行：site-explorer doctor ${url}`);
else if (!args.includes('--no-motion')) motionOk = await run(_t('擷取 3D／動畫畫格'), 'capture-3d.mjs', [url, '--out', motionRoot, '--wait', String(waitMs), ...authArgs, ...(args.includes('--headed') ? ['--headed'] : [])]);

// 3D／motion is per page: every crawled page is captured (--motion-pages N caps it, default 30 in total; 1 = only the start page). Two pages are captured at a time and one that hangs is stopped after PAGE_LIMIT_MS.
if (!args.includes('--no-motion') && crawlOk) {
  const nPages = Math.max(intOpt(args, 'motion-pages', 30, { min: 1, max: 30 }), urlsGiven);
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
  const PAGE_LIMIT_MS = 240000, workers = process.platform === 'win32' ? 1 : Math.max(1, Math.min(2, (os.cpus() || []).length >> 1)); let done = 0; // (Windows: one at a time; two software-rendered browsers there starve each other)
  const captureOne = async (p) => {
    const dest = path.join(motionRoot, '_pages', p.slug), t0 = Date.now();
    console.log(_t`   3D／動畫 [${++done}/${extra.length}]：${p.url}`);
    fs.mkdirSync(dest, { recursive: true }); const logFile = path.join(dest, 'capture.log'), logFd = fs.openSync(logFile, 'a'); // what the capture says is kept: a page that fails shows its last lines
    const ok = await new Promise((resolve) => { const c = spawn(process.execPath, [path.join(here, 'capture-3d.mjs'), p.url, '--out', dest, '--wait', String(waitMs), ...authArgs, ...(args.includes('--headed') ? ['--headed'] : [])], { env: process.env, stdio: ['ignore', logFd, logFd], windowsHide: true }); const stopW = watchChild(c, { limitMs: PAGE_LIMIT_MS, lang: LANG, quietMs: 1e9, notify: (k, t) => { console.log('     ' + t); if (k === 'timeout' || k === 'memory') notices.push(t); } }); c.on('close', (code) => { stopW(); resolve(code === 0); }); c.on('error', () => { stopW(); resolve(false); }); });
    try { fs.closeSync(logFd); } catch {}
    const hostDir = path.join(dest, new URL(p.url).host.replace(/[^a-z0-9.-]/gi, '_'));
    if (ok) { addEntry(p.url, p.slug, p.title, hostDir); const took = (Date.now() - t0) / 1000; console.log(`     ✔ ${p.slug} ${took.toFixed(1)}s`); if (took > 60) { try { const marks = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /\[t\+/.test(l)).map((l) => l.trim()); if (marks.length) console.log(marks.map((l) => '        | ' + l.slice(0, 120)).join('\n')); } catch {} } } else { console.log(_t`     ✖ 略過 ${p.slug}（失敗、逾時或被 robots.txt 擋住）`); try { const tail = fs.readFileSync(logFile, 'utf8').split('\n').map(stripControl).filter((l) => l.trim()).slice(-4); if (tail.length) console.log(tail.map((l) => '        | ' + l.slice(0, 160)).join('\n')); } catch {} }
  };
  { const queue = [...extra]; await Promise.all(Array.from({ length: workers }, async () => { while (queue.length) await captureOne(queue.shift()); })); }
  entries.sort((a, b) => (a.slug === '(start)' ? -1 : b.slug === '(start)' ? 1 : pg.findIndex((x) => x.slug === a.slug) - pg.findIndex((x) => x.slug === b.slug))); // crawl order, whatever finished first
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
    ...(() => { // a plain-language map of the files that exist in this run
      const has = (f) => fs.existsSync(path.join(siteDir, f)) || fs.existsSync(path.join(out, f)); const pageHas = (f) => { try { return fs.readdirSync(path.join(siteDir, 'pages')).some((d) => fs.existsSync(path.join(siteDir, 'pages', d, f))); } catch { return false; } };
      const rows = [[true, '`dashboard.html`', _t('圖形化總覽：先看這個，雙擊就能開，每項檢查都有一句白話結論')], [has('health.md'), '`site/<site>/health.md`', _t('SEO、連結、行動版健檢：每個問題都有影響與修法')], [has('security.md'), '`site/<site>/security.md`', _t('安全標頭與加密連線評等（A+～F），每項附修正方式')], [has('performance.md'), '`site/<site>/performance.md`', _t('載入速度與頁面大小（對照 Google 建議值）')], [has('tracking-behaviors.md'), '`site/<site>/tracking-behaviors.md`', _t('有沒有錄製訪客操作、讀取瀏覽器指紋、輸入文字外流')], [has('techstack.md'), '`site/<site>/techstack.md`', _t('網站用了什麼技術（平台、框架、伺服器…），附證據')], [pageHas('content.md'), '`site/<site>/pages/<page>/content.md`', _t('每頁的可讀文字（Markdown）')], [pageHas('archive.html'), '`site/<site>/pages/<page>/archive.html`', _t('每頁的離線單檔網頁，雙擊就能開')], [has('figma'), '`site/<site>/figma/`', _t('給 Figma 的圖層化版面草稿（SVG）')], [has('extractions.csv'), '`site/<site>/extractions.csv`', _t('你的自訂擷取規則抽出的資料（可用試算表開啟）')], [has('visual.md'), '`visual.md`', _t('整頁畫面和基準的比對結果（差異圖在 visual-diff/）')], [has('drift.md'), '`drift.md`', _t('和基準相比，設計與健檢哪裡變了')], [has('handoff'), '`handoff/`', _t('交給 AI 或工程師的整包資料：先讀 START-HERE.md')]].filter((r) => r[0]);
      return ['', _t('## 每個檔案是做什麼的'), '', ...rows.map((r) => `- ${r[1]} — ${r[2]}`), ''];
    })(),
    _t('## 探索過的網站'), ...runs.map((r) => _t`- ${r.url}（${r.at.slice(0, 10)}，site-explorer ${r.version}）`), '',
    _t('## 重新產生'), '```bash', _t('site-explorer <網址> --out ') + JSON.stringify(path.relative(process.cwd(), out) || '.'), '```', '',
    _t('工具說明與安裝：https://github.com/rocksk8/code'), ''].join('\n'));
} catch {}
if (crawlOk) { try { const { computeTopFixes, renderTopFixesConsole, renderTopFixesMd } = await import('./top-fixes.mjs'); const tf = computeTopFixes(siteDir); fs.writeFileSync(path.join(siteDir, 'top-fixes.json'), JSON.stringify(tf, null, 2)); fs.writeFileSync(path.join(siteDir, 'top-fixes.md'), renderTopFixesMd(tf) + '\n'); if (!JSON_MODE) { const b = renderTopFixesConsole(tf.slice(0, 3)); if (b) console.log(b); } } catch {} }
let handoffOk = false;
const handoffDir = path.join(out, 'handoff');
if ((crawlOk || motionOk) && crawlOk && !args.includes('--no-handoff')) handoffOk = await run(_t('產生交接包（AI 簡報、完整規格、決策紀錄、圖片）'), 'build-handoff.mjs', ['--site', siteDir, ...(motionOk ? ['--motion', motionDir] : []), '--out', handoffDir]);
if (handoffOk && args.includes('--verify')) await run(_t('驗證重建（starter 對照原站，逐區塊相似度）'), 'verify.mjs', [handoffDir]);
if (handoffOk && framework) await run(_t`轉成 ${framework} 專案（handoff/frameworks/）`, 'frameworks.mjs', [handoffDir, '--to', framework]);
const dash = path.join(out, 'dashboard.html');
const dashArgs = () => [...(crawlOk ? ['--site', siteDir] : []), ...(motionOk ? ['--motion', motionDir] : []), '--out', dash, ...(handoffOk ? ['--handoff', handoffDir] : []), ...(args.includes('--no-standalone') ? [] : ['--standalone'])];
if (!crawlOk && !motionOk) console.log(_t('\n探索沒有成功，略過儀表板與交接包。請先處理上面的錯誤（可執行 site-explorer doctor 檢查環境），再重新執行。'));
else await run(_t('產生圖形化儀表板'), 'build-report.mjs', dashArgs());

const failed = steps.filter((s) => !s.ok);
console.log(_t`\n完成：${steps.length - failed.length}/${steps.length} 階段成功${failed.length ? _t('，失敗：') + failed.map((f) => f.label).join(_t('、')) : ''}`);
if (notices.length) console.log(_t('\n⚠️ 本次執行的超時／資源通知：') + '\n' + [...new Set(notices)].map((x) => '  - ' + x).join('\n'));
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
if ((crawlOk || motionOk) && fs.existsSync(dash)) { // after a failed run an old dashboard is not this run's result
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
if (budgetCfg && crawlOk) { try { const pj = JSON.parse(fs.readFileSync(path.join(siteDir, 'performance.json'), 'utf8')); if (pj.result?.failed) { failCode = failCode || 4; console.error(_t`效能預算有 ${pj.result.violations.filter((v) => v.level === 'fail').length} 項超標，以結束代碼 4 結束（見 performance.md）。`); } } catch { failCode = failCode || 1; console.error(_t('--budget 需要效能檢查成功，但沒有拿到結果。')); } }
let drift = null;
if (tokenCheckFailed) { failCode = failCode || 4; console.error(_t('設計規範不符合比例超過門檻，以結束代碼 4 結束（見 token-check.md）。')); }
if (opt('approve-visual', null)) { // accept some screenshots as the new baseline (named in visual.md / the review page), leaving the rest as they are
  try {
    const { approveVisualItems, visualDirFor } = await import('./visual-regression.mjs');
    if (!crawlOk) throw new Error(_t('這次探索沒有完成，不能更新視覺基準。'));
    const bf = path.resolve(opt('baseline', path.join(out, 'baseline.json')));
    const done = approveVisualItems(siteDir, visualDirFor(bf), String(opt('approve-visual')).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200));
    console.log(done.length ? _t`✔ 已把 ${done.length} 張截圖更新為新的視覺基準：${done.slice(0, 8).join(', ')}${done.length > 8 ? '…' : ''}` : _t('沒有符合的截圖可更新（名稱要和 visual.md 裡的一致，或用 all）。'));
  } catch (e) { failCode = 1; console.error('✖ ' + String(e.message).split('\n')[0]); }
}
if (approveFlag || compareFlag) {
  try {
    const { makeBaseline, parseBaseline, compareBaseline, renderDriftMd } = await import('./baseline.mjs');
    const { requireExtension } = await import('./safe-out.mjs');
    const bf = approveFlag ? requireExtension(opt('baseline', path.join(out, 'baseline.json')), /\.json$/i, '*.json') : path.resolve(opt('baseline', path.join(out, 'baseline.json')));
    if (!crawlOk || !healthOk) throw new Error(_t('這次探索或健檢沒有完成，不能建立或比較基準。'));
    const tokens = JSON.parse(fs.readFileSync(path.join(siteDir, 'design-bundle', 'tokens.json'), 'utf8'));
    const health = JSON.parse(fs.readFileSync(path.join(siteDir, 'health.json'), 'utf8'));
    const siteJ = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
    const cur = makeBaseline({ tokens, health, url, pages: (siteJ.pages || []).length });
    if (approveFlag) {
      { // check the visual folder BEFORE touching baseline.json, so a refusal leaves the old baseline whole
        const { removeVisualBaseline, visualDirFor, countVisualShots } = await import('./visual-regression.mjs'); const vd = visualDirFor(bf);
        removeVisualBaseline(vd, true);
        if (!args.includes('--no-visual') && !countVisualShots(siteDir) && fs.existsSync(vd) && fs.readdirSync(vd).length) throw new Error(_t('這次沒有任何整頁截圖，不會用空的內容覆蓋原有的視覺基準（不需要視覺基準的話可加 --no-visual）。'));
      }
      fs.mkdirSync(path.dirname(bf), { recursive: true }); fs.writeFileSync(bf, JSON.stringify(cur, null, 2) + '\n'); console.log(_t`✔ 已把這次的結果存成基準：${bf}`);
      if (args.includes('--no-visual')) { const { removeVisualBaseline, visualDirFor } = await import('./visual-regression.mjs'); removeVisualBaseline(visualDirFor(bf)); } // a stale visual baseline must not outlive the approval it belonged to
      else { const { saveVisualBaseline, visualDirFor } = await import('./visual-regression.mjs'); const n = saveVisualBaseline(siteDir, visualDirFor(bf)); console.log(_t`✔ 已存下 ${n} 張整頁截圖作為視覺基準：${visualDirFor(bf)}`); }
    }
    else {
      if (!fs.existsSync(bf)) throw new Error(_t`找不到基準檔 ${bf}。請先用 --approve 建立。`);
      const base = parseBaseline(fs.readFileSync(bf, 'utf8'));
      drift = compareBaseline(base, cur, { maxDrop: maxDropOpt, failOnNew: failOnNewOpt });
      fs.writeFileSync(path.join(out, 'drift.md'), BANNER_DRIFT() + renderDriftMd(base, cur, drift) + '\n');
      console.log(drift.failed ? _t`✖ 與基準相比偏移過大：\n  - ${drift.reasons.join('\n  - ')}` : _t('✔ 與基準相比在容許範圍內'));
      console.log(_t`   詳情：${path.join(out, 'drift.md')}`);
      const vdir = (await import('./visual-regression.mjs')).visualDirFor(bf);
      if (!args.includes('--no-visual') && fs.existsSync(path.join(vdir, 'index.json'))) {
        const { compareVisual, renderVisualMd, renderVisualReviewHtml } = await import('./visual-regression.mjs'); const { launchBrowser } = await import('./launch.mjs');
        const br = await launchBrowser();
        try {
          const pg = await br.newPage(); const vr = await compareVisual(pg, { siteDir, baseDir: vdir, outDir: out, threshold: visualThresholdOpt });
          fs.writeFileSync(path.join(out, 'visual.md'), renderVisualMd(vr)); drift.visual = vr; try { fs.writeFileSync(path.join(out, 'visual-review.html'), renderVisualReviewHtml(vr, { baseDir: vdir, siteDir, outDir: out, url, baselineFile: opt('baseline', null) ? bf : null })); console.log(_t`   逐張審核頁（拖曳比較改版前後）：${path.join(out, 'visual-review.html')}`); } catch {} fs.writeFileSync(path.join(out, 'visual.json'), JSON.stringify({ threshold: vr.threshold, rows: vr.rows.map((r) => ({ slug: r.slug, viewport: r.viewport, status: r.status, changedPct: r.changedPct ?? null, diff: r.diff ?? null })) }, null, 2)); if (fs.existsSync(dash)) spawnSync(process.execPath, [path.join(here, 'build-report.mjs'), ...dashArgs()], { stdio: 'ignore' }); // the dashboard shows this comparison too
          console.log(vr.failed ? _t`✖ 整頁畫面和基準不同：\n  - ${vr.reasons.join('\n  - ')}` : _t('✔ 整頁畫面都在容許範圍內')); console.log(_t`   詳情：${path.join(out, 'visual.md')}`);
          if (vr.failed) { drift.failed = true; drift.reasons.push(...vr.reasons); }
        } finally { await br.close(); }
      } else if (!args.includes('--no-visual')) console.log(_t('（這份基準沒有視覺基準；用 --approve 重新建立即可啟用整頁畫面比對。）'));
      if (drift.failed) { failCode = 4; console.error(_t('偏移超過容許範圍，以結束代碼 4 結束。')); }
    }
  } catch (e) { failCode = 1; console.error('✖ ' + String(e.message).split('\n')[0]); }
}
if (crawlOk && (opt('sarif', null) || opt('junit', null))) {
  try {
    const { toSarif, toJunit } = await import('./ci-formats.mjs'); const { requireExtension } = await import('./safe-out.mjs');
    const vis = drift?.visual || null;
    if (opt('sarif', null)) { const f = requireExtension(opt('sarif', null), /\.(sarif|json)$/i, '*.sarif'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(toSarif(siteDir, { visual: vis }), null, 2) + '\n'); console.log(_t`SARIF 結果：${f}`); }
    if (opt('junit', null)) { const f = requireExtension(opt('junit', null), /\.xml$/i, '*.xml'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, toJunit(siteDir, { visual: vis })); console.log(_t`JUnit 結果：${f}`); }
  } catch (e) { failCode = failCode || 1; console.error('✖ ' + String(e.message).split('\n')[0]); }
}
if (crawlOk && !JSON_MODE) { try { const { computeVerdicts, renderVerdictsConsole } = await import('./verdicts.mjs'); const block = renderVerdictsConsole(computeVerdicts(siteDir, out)); if (block) console.log(block); } catch {} }
if ((crawlOk || motionOk) && fs.existsSync(dash)) console.log(_t('\n👉 下一步：先雙擊 dashboard.html 看總覽；要交給 AI 或工程師，就把 handoff 資料夾整個給對方。'));
if (fs.existsSync(path.join(siteDir, 'report.md')) && fs.readFileSync(path.join(siteDir, 'report.md'), 'utf8').includes(_t('被擋住'))) console.log(_t('\n⚠️ 部分頁面被擋住，結果可能不完整（見儀表板或 report.md）。'));
if (JSON_MODE) { __jsonDone = true; const { buildSummary } = await import('./summary.mjs'); process.stdout.write(JSON.stringify({ ok: !!(crawlOk || motionOk) && failCode === 0, exitCode: crawlOk || motionOk ? failCode : 1, ...buildSummary({ out, host, steps, url, fresh: !!(crawlOk || motionOk) }), drift: drift ? { failed: drift.failed, reasons: drift.reasons, scoreDelta: drift.scoreDelta, tokenChanges: drift.tokenChanges, newIssues: drift.newIssues } : null, runId }, null, 2) + '\n'); }
if (webhookOpt && crawlOk) { // tell someone when the site got worse (or always, with --notify-on always)
  try {
    const { shouldNotify, buildPayload, postWebhook } = await import('./notify.mjs');
    const hj = path.join(siteDir, 'health.json'); const h = fs.existsSync(hj) ? JSON.parse(fs.readFileSync(hj, 'utf8')) : null;
    const urgent = (h?.issues || []).filter((i) => ['critical', 'high'].includes(i.severity)).length;
    let prevScore = null, prevUrgent = null;
    if (!noDb) { try { const db2 = await openDb(); if (db2) { const prev = runsForHost(db2, new URL(url).host).filter((r) => (runId == null || r.id < runId) && Number.isFinite(r.health_score)).pop(); if (prev) { prevScore = prev.health_score; prevUrgent = (prev.issues_critical || 0) + (prev.issues_high || 0); } db2.close?.(); } } catch {} }
    if (shouldNotify(notifyOn, { score: h?.score, prevScore, maxDrop: maxDropOpt, urgent, prevUrgent })) {
      let fixes = []; try { fixes = JSON.parse(fs.readFileSync(path.join(siteDir, 'top-fixes.json'), 'utf8')); } catch {}
      const r = await postWebhook(webhookOpt, buildPayload({ url, score: h?.score, grade: h?.grade, prevScore, urgent, fixes, dashboard: fs.existsSync(dash) ? dash : '', notices, lang: LANG }));
      console.log(r.ok ? _t`📣 已送出通知（${new URL(webhookOpt).host}）` : _t`⚠️ 通知沒有送出：${r.error || r.status}`);
    } else console.log(_t('📣 沒有需要通知的變化，未送出。'));
  } catch (e) { console.log(_t`⚠️ 通知沒有送出：${String(e.message).split('\n')[0]}`); }
}
process.exit(crawlOk || motionOk ? failCode : 1);
