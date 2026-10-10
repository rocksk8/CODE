#!/usr/bin/env node
// One command that makes everything ready: Node check -> dependencies -> browser (download only with consent) -> smoke test.
//   site-explorer setup [--yes] [--with-ffmpeg] [--deps-only] [--quiet]
//   --yes          answer "yes" to downloads (needed when there is no terminal, e.g. when run by an AI assistant)
//   --background   detach and return immediately (used by the hook)
//   --deps-only    only make sure playwright-core is installed (what the SessionStart hook runs; silent, never fails loudly)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNode } from './util.mjs';
import { DEPS_DIR, depsInstalled, installDeps, launchBrowser, loadPlaywright, pinnedPlaywright } from './launch.mjs';

const args = process.argv.slice(2), has = (f) => args.includes(f);
const quiet = has('--quiet'), yes = has('--yes') || has('-y');
const say = (...a) => { if (!quiet) console.log(...a); };
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };

if (has('--help') || has('-h')) { console.log('Usage: site-explorer setup [--yes] [--with-ffmpeg] [--deps-only] [--quiet]\n  檢查 Node → 安裝相依套件 → 找瀏覽器（找不到時，經你同意才下載 Chromium）→ 冒煙測試'); process.exit(0); }

assertNode();

// ---- 0. --background: detach and return at once, so a session start is never blocked by a first-time install ----
if (has('--background')) {
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter((a) => a !== '--background')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
}

// ---- 1. dependencies (the part the SessionStart hook runs) ----
if (has('--deps-only')) {
  try { if (!(await depsInstalled())) installDeps({ quiet: true }); } catch (e) { if (!quiet) console.error(e.message); }
  process.exit(0); // never block a session start
}

say('site-explorer setup\n');
const [maj, min] = process.versions.node.split('.').map(Number);
say(`✅ Node.js ${process.version}`);
if (maj < 22 || (maj === 22 && min < 13)) say('⚠️  資料庫（歷史、搜尋、比較）需要 Node ≥ 22.13；目前版本其他功能不受影響。要用歷史功能請升級 Node。');

try {
  if (!(await depsInstalled())) installDeps({ quiet });
  await loadPlaywright({ quiet: true });
  say(`✅ 相依套件 playwright-core ${pinnedPlaywright()}`);
} catch (e) { fail('❌ ' + e.message); }

// ---- 2. browser ----
const ask = (q) => new Promise((resolve) => {
  if (yes) return resolve(true);
  if (!process.stdin.isTTY) return resolve(null); // cannot ask
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q + ' [Y/n] ', (a) => { rl.close(); resolve(!/^n/i.test(a.trim())); });
});
const playwrightCli = () => { for (const base of [() => path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), () => path.join(DEPS_DIR, 'node_modules', 'playwright-core')]) { try { const d = base(); if (fs.existsSync(path.join(d, 'cli.js'))) return path.join(d, 'cli.js'); } catch {} } return null; };
const pwInstall = (what) => { const cli = playwrightCli(); if (!cli) fail('❌ 找不到 playwright-core 的安裝工具，請重新執行 setup'); return spawnSync(process.execPath, [cli, 'install', what], { stdio: quiet ? 'ignore' : 'inherit' }).status === 0; };

let browser = null;
try { browser = await launchBrowser(); } catch {}
if (!browser) {
  say('⚠️  找不到 Chrome／Edge／Chromium。');
  const ok = await ask('要下載 Chromium 嗎？（約 150 MB，只下載一次，不影響你的其他瀏覽器）');
  if (ok === null) fail('需要你的同意才會下載。請在終端機執行：site-explorer setup --yes\n（或自行安裝 Google Chrome，然後再執行 setup）', 2);
  if (!ok) fail('已略過下載。請安裝 Google Chrome，或執行 site-explorer setup --yes。', 2);
  if (!pwInstall('chromium')) fail('❌ 下載 Chromium 失敗（網路或代理問題？）。可改為安裝 Google Chrome 後重跑 setup。');
  try { browser = await launchBrowser(); } catch (e) { fail('❌ 已下載但仍無法啟動瀏覽器：' + e.message.split('\n')[0] + '\n在 Linux 可能缺系統函式庫：npx playwright-core install-deps chromium'); }
}
say(`✅ 瀏覽器 ${browser.version()}`);

// ---- 3. optional ffmpeg (only for recording) ----
if (has('--with-ffmpeg')) { say('下載 ffmpeg（僅供錄影用）…'); say(pwInstall('ffmpeg') ? '✅ ffmpeg' : '⚠️  ffmpeg 下載失敗（沒有錄影也能正常使用）'); }

// ---- 4. smoke test: really open a page and take a screenshot ----
try {
  const page = await browser.newPage();
  await page.setContent('<h1 style="font:40px sans-serif">site-explorer ok</h1>');
  const png = await page.screenshot();
  await browser.close();
  if (png.length < 200) throw new Error('截圖內容異常');
  say('✅ 冒煙測試：開啟頁面並截圖成功');
} catch (e) { await browser.close().catch(() => {}); fail('❌ 冒煙測試失敗：' + e.message); }

say('\n一切就緒。試試看：\n  site-explorer example.com\n');
