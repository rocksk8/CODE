#!/usr/bin/env node
// site-explorer — one command for everything.   site-explorer <網址>   or   site-explorer <子指令> …
import { _t, LANG } from '../scripts/i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const script = (f) => path.join(root, 'scripts', f);

const HELP = _t`site-explorer ${version} — 探索網站：設計、內容、排版、3D／動畫、SEO／索引健檢，並產生可交接給 AI 與開發者的規格包

用法
  site-explorer <網址> [選項]            一鍵探索（可省略 https://），產生儀表板與交接包
  site-explorer <子指令> [參數]

常用
  explore  <網址>   一鍵：爬取 → 設計包 → 健檢 → 3D → 資料庫 → 儀表板 → 交接包
  health   <網址>   網站健檢（SEO、爬蟲索引、連結、效能、行動版、安全、AI 爬蟲）
  handoff  <網址>   同 explore，重點是交接包（handoff/）
  setup             一次搞定環境：檢查 Node、安裝相依套件、找瀏覽器（經同意才下載）、冒煙測試
  framework <handoff資料夾> --to react|vue|astro|shadcn|all   把 starter 轉成 React／Vue／Astro 專案或 shadcn/ui 主題
  login    <網址>   手動登入一次並存下登入狀態，之後用 --storage-state 探索登入後的頁面
  mcp               以 MCP 伺服器模式執行（讓 Claude Desktop、Cursor 等直接呼叫 explore／health／verify）
  verify   <handoff資料夾>   重建驗證：starter 對照原站逐區塊相似度＋差異圖（--min-score 當門檻）
  diagnose <網址>   這個網頁為什麼抓不到？（用爬蟲身分與瀏覽器預設身分各開一次，回報看到什麼）
  doctor   [網址]   診斷環境（每個問題都附修復指令）

進階
  motion   <網址>   只做 3D／動畫擷取（AI 可讀）
  crawl    <網址>   只爬取
  design   <站點資料夾>      只產生設計包（tokens）
  report   --site <資料夾>   只產生儀表板
  compare  --a <資料夾> --b <資料夾>   並排比較兩個網站
  history|db  list | search --lib three | history <host> | compare <idA> <idB>

選項（explore）
  --max-pages 6   --out ./explore-out   --no-motion   --no-health   --no-handoff   --no-db
  --no-link-check   --open | --no-open   --no-standalone   --wait 4000
  --json   --a11y   --verify   --framework react|vue|astro|shadcn|all   --storage-state f.json
  --fail-on high|critical|medium|low   --motion-pages 5   --headed

全域
  --lang zh|en     輸出語言（預設繁體中文；en = 英文，含報告、儀表板、交接包）

每個子指令都可加 --help 看詳細用法。

更多：https://github.com/rocksk8/code
`;

import { assertNode } from '../scripts/util.mjs';
// --lang en|zh is consumed here: it selects the output language for this process and every child process, and is not passed on to the scripts
process.env.SITE_EXPLORER_LANG = LANG;
const argv = (() => { const a = process.argv.slice(2), o = []; for (let i = 0; i < a.length; i++) { if (a[i] === '--lang') { i++; continue; } if (a[i].startsWith('--lang=')) continue; o.push(a[i]); } return o; })();
const [cmd, ...rest] = argv;
const looksLikeUrl = (s) => !!s && !s.startsWith('-') && /^(https?:\/\/|localhost\b|[\w-]+(\.[\w-]+)+(:\d+)?(\/|$))/i.test(s);

const ROUTES = {
  explore: (a) => [script('explore.mjs'), a], handoff: (a) => [script('explore.mjs'), a],
  health: (a) => (a.some(looksLikeUrl) ? [script('explore.mjs'), [...a, '--no-motion']] : [script('health-check.mjs'), a]),
  motion: (a) => [script('capture-3d.mjs'), a], crawl: (a) => [script('crawl.mjs'), a], design: (a) => [script('export-design.mjs'), a],
  report: (a) => [script('build-report.mjs'), a], compare: (a) => [script('compare-report.mjs'), a], history: (a) => [script('db.mjs'), a], db: (a) => [script('db.mjs'), a],
  verify: (a) => [script('verify.mjs'), a], mcp: (a) => [script('mcp-server.mjs'), a], login: (a) => [script('login.mjs'), a], framework: (a) => [script('frameworks.mjs'), a], diagnose: (a) => [script('diagnose.mjs'), a], doctor: (a) => [script('doctor.mjs'), a], setup: (a) => [script('setup.mjs'), a],
};

if (!cmd || ['-h', '--help', 'help'].includes(cmd)) { console.log(HELP); process.exit(0); }
if (['-v', '--version', 'version'].includes(cmd)) { console.log(version); process.exit(0); }

if (['health', 'handoff'].includes(cmd) && rest.some((a) => a === '--help' || a === '-h')) {
  console.log(cmd === 'health'
    ? _t('用法：site-explorer health <網址> [--max-pages 6] [--out ./explore-out] [--fail-on high] [--no-link-check] [--json]\n  對網站做 SEO／爬蟲索引／連結／效能／行動版／安全健檢。其實是完整探索（不含 3D／動畫），所以也會產生儀表板與交接包。\n  已經爬好的資料夾可改用：site-explorer health --site <含 site.json 的資料夾>')
    : _t('用法：site-explorer handoff <網址> [--max-pages 6] [--out ./explore-out] [--verify] [--framework react|vue|astro|shadcn|all]\n  與 explore 相同（完整探索），重點是產出 handoff/ 交接包：START-HERE.md、PROMPT.md、starter/、SPEC.md…。其他選項見 site-explorer explore --help'));
  process.exit(0);
}
if (!['-h', '--help', 'help', '-v', '--version', 'version'].includes(cmd) && cmd) assertNode();
let target;
if (ROUTES[cmd]) target = ROUTES[cmd](rest);
else if (looksLikeUrl(cmd)) target = [script('explore.mjs'), argv];
else { console.error(_t`未知的指令或網址：「${cmd}」\n\n${HELP}`); process.exit(1); }

// run the script in this process (it reads process.argv like a normal CLI)
process.argv = [process.argv[0], target[0], ...target[1]];
await import(pathToFileURL(target[0]).href);
