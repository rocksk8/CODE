// Dependencies + browser, resolved so that "install once" really means once:
//   playwright-core is looked up in (1) the checkout / global install, (2) ~/.site-explorer/deps (survives plugin updates,
//   works when the plugin directory is read-only, shared by the plugin and the standalone CLI), else installed into (2).
//   Browser: CHROMIUM_PATH > Playwright's Chromium > Chrome > Edge > other Chromium-based browsers found on disk.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNode } from './util.mjs';

const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME_DIR = process.env.SITE_EXPLORER_HOME || path.join(os.homedir(), '.site-explorer');
export const DEPS_DIR = path.join(HOME_DIR, 'deps');
const depsEntry = () => path.join(DEPS_DIR, 'node_modules', 'playwright-core', 'index.mjs');
const isWin = process.platform === 'win32';

/** The exact playwright-core version this release was tested with (pinned in package.json). */
export const pinnedPlaywright = () => { try { return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).dependencies['playwright-core']; } catch { return '1.64.0'; } };

async function importPlaywright() {
  try { return await import('playwright-core'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  if (fs.existsSync(depsEntry())) return await import(pathToFileURL(depsEntry()).href);
  return null;
}
export const depsInstalled = async () => !!(await importPlaywright().catch(() => null));

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Install playwright-core into ~/.site-explorer/deps (once). Safe against two processes starting at the same time. */
export function installDeps({ quiet = false } = {}) {
  fs.mkdirSync(DEPS_DIR, { recursive: true });
  const lock = path.join(DEPS_DIR, '.lock');
  for (let i = 0; ; i++) { // another process is installing: wait for it instead of racing it
    try { fs.mkdirSync(lock); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (fs.existsSync(depsEntry())) return;
      let stale = false; try { stale = Date.now() - fs.statSync(lock).mtimeMs > 5 * 60 * 1000; } catch {}
      if (stale || i > 240) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      sleepSync(500);
    }
  }
  try {
    if (fs.existsSync(depsEntry())) return;
    if (!quiet) console.error(`第一次執行：正在安裝相依套件 playwright-core ${pinnedPlaywright()} 到 ${DEPS_DIR}（只需一次，約 14 MB）…`);
    fs.writeFileSync(path.join(DEPS_DIR, 'package.json'), JSON.stringify({ name: 'site-explorer-deps', private: true, dependencies: { 'playwright-core': pinnedPlaywright() } }));
    const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: DEPS_DIR, stdio: quiet ? 'ignore' : ['ignore', 'inherit', 'inherit'], shell: isWin });
    if (r.status !== 0 || !fs.existsSync(depsEntry())) {
      const why = r.error?.code === 'ENOENT' ? '找不到 npm（請從 https://nodejs.org 安裝 Node.js，它會一併安裝 npm）' : '無法連到 npm 套件庫（請檢查網路或公司代理：npm config set proxy …），或磁碟空間不足';
      throw new Error(`相依套件安裝失敗：${why}${r.error ? '（' + r.error.message + '）' : ''}。\n可手動執行：cd "${DEPS_DIR}" && npm install playwright-core@${pinnedPlaywright()}`);
    }
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

export async function loadPlaywright({ quiet = false } = {}) {
  assertNode(); // playwright-core needs Node 20+; fail with a clear message instead of a cryptic one
  let pw = await importPlaywright(); if (pw) return pw;
  if (process.env.SITE_EXPLORER_NO_AUTO_INSTALL) throw new Error('缺少相依套件 playwright-core，且已停用自動安裝。請執行：site-explorer setup');
  installDeps({ quiet });
  pw = await importPlaywright(); if (!pw) throw new Error('安裝後仍找不到 playwright-core，請執行：site-explorer setup');
  return pw;
}

/** Chromium-based browsers worth trying after the standard channels. */
export function browserCandidates() {
  const h = os.homedir(), env = process.env;
  const list = {
    darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', path.join(h, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')],
    win32: [path.join(env['PROGRAMFILES'] || 'C:\\Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe'), path.join(env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'), path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')],
    linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/brave-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium', '/opt/google/chrome/chrome'],
  }[process.platform] || [];
  return list.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

export async function launchBrowser(options = {}) {
  const { chromium } = await loadPlaywright();
  // behind a corporate proxy: SITE_EXPLORER_PROXY=http://host:port (Playwright does not read HTTPS_PROXY by itself)
  // Chromium's OS sandbox stays ON. It is turned off only where it cannot run (root, e.g. in containers) or when asked for explicitly.
  const noSandbox = process.env.SITE_EXPLORER_NO_SANDBOX === '1' || (typeof process.getuid === 'function' && process.getuid() === 0);
  if (noSandbox && !globalThis.__sandboxWarned) { globalThis.__sandboxWarned = true; console.error('⚠️  以無沙箱模式啟動瀏覽器（root／容器環境或 SITE_EXPLORER_NO_SANDBOX=1）；請只探索你信任的網站，或改用一般使用者執行。'); }
  const opts = { headless: true, chromiumSandbox: !noSandbox, ...(process.env.SITE_EXPLORER_PROXY ? { proxy: { server: process.env.SITE_EXPLORER_PROXY } } : {}), ...options };
  if (process.env.CHROMIUM_PATH) return chromium.launch({ ...opts, executablePath: process.env.CHROMIUM_PATH });
  const tried = [];
  const attempt = async (label, extra) => { try { return await chromium.launch({ ...opts, ...extra }); } catch (e) { tried.push(`${label}：${String(e.message).split('\n')[0].slice(0, 90)}`); return null; } };
  let b = await attempt('Playwright 下載的 Chromium', {}); if (b) return b;      // what `site-explorer setup` downloads
  for (const channel of ['chrome', 'msedge']) { b = await attempt(`已安裝的 ${channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`, { channel }); if (b) return b; }
  for (const executablePath of browserCandidates()) { b = await attempt(executablePath, { executablePath }); if (b) return b; }
  throw new Error('找不到可用的瀏覽器（Chrome／Edge／Chromium）。\n試過：\n  - ' + tried.join('\n  - ') + '\n請執行：site-explorer setup（會在你同意後下載 Chromium），或安裝 Google Chrome，或設定 CHROMIUM_PATH。');
}
