#!/usr/bin/env node
// site-explorer — one command for everything.   site-explorer <網址>   or   site-explorer <子指令> …
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const script = (f) => path.join(root, 'scripts', f);

const HELP = `site-explorer ${version} — 探索網站：設計、內容、排版、3D／動畫、SEO／索引健檢，並產生可交接給 AI 與開發者的規格包

用法
  site-explorer <網址> [選項]            一鍵探索（可省略 https://），產生儀表板與交接包
  site-explorer <子指令> [參數]

常用
  explore  <網址>   一鍵：爬取 → 設計包 → 健檢 → 3D → 資料庫 → 儀表板 → 交接包
  health   <網址>   網站健檢（SEO、爬蟲索引、連結、效能、行動版、安全、AI 爬蟲）
  handoff  <網址>   同 explore，重點是交接包（handoff/）
  setup             一次搞定環境：檢查 Node、安裝相依套件、找瀏覽器（經同意才下載）、冒煙測試
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

更多：https://github.com/rocksk8/code
`;

import { assertNode } from '../scripts/util.mjs';
const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;
const looksLikeUrl = (s) => !!s && !s.startsWith('-') && /^(https?:\/\/|localhost\b|[\w-]+(\.[\w-]+)+(:\d+)?(\/|$))/i.test(s);

const ROUTES = {
  explore: (a) => [script('explore.mjs'), a], handoff: (a) => [script('explore.mjs'), a],
  health: (a) => (a.some(looksLikeUrl) ? [script('explore.mjs'), [...a, '--no-motion']] : [script('health-check.mjs'), a]),
  motion: (a) => [script('capture-3d.mjs'), a], crawl: (a) => [script('crawl.mjs'), a], design: (a) => [script('export-design.mjs'), a],
  report: (a) => [script('build-report.mjs'), a], compare: (a) => [script('compare-report.mjs'), a], history: (a) => [script('db.mjs'), a], db: (a) => [script('db.mjs'), a],
  verify: (a) => [script('verify.mjs'), a], mcp: (a) => [script('mcp-server.mjs'), a], diagnose: (a) => [script('diagnose.mjs'), a], doctor: (a) => [script('doctor.mjs'), a], setup: (a) => [script('setup.mjs'), a],
};

if (!cmd || ['-h', '--help', 'help'].includes(cmd)) { console.log(HELP); process.exit(0); }
if (['-v', '--version', 'version'].includes(cmd)) { console.log(version); process.exit(0); }

if (!['-h', '--help', 'help', '-v', '--version', 'version'].includes(cmd) && cmd) assertNode();
let target;
if (ROUTES[cmd]) target = ROUTES[cmd](rest);
else if (looksLikeUrl(cmd)) target = [script('explore.mjs'), argv];
else { console.error(`未知的指令或網址：「${cmd}」\n\n${HELP}`); process.exit(1); }

// run the script in this process (it reads process.argv like a normal CLI)
process.argv = [process.argv[0], target[0], ...target[1]];
await import(pathToFileURL(target[0]).href);
