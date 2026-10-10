// Launch Chromium: CHROMIUM_PATH > Playwright's Chromium > locally installed Chrome/Edge.
// First run (or after a plugin update) has no node_modules: install them once, with a clear message.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  try { return await import('playwright-core'); }
  catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND' || process.env.SITE_EXPLORER_NO_AUTO_INSTALL) throw e;
    console.error('第一次執行：正在安裝相依套件（playwright-core，約數 MB）…');
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--silent', '--no-audit', '--no-fund'], { cwd: pluginRoot, stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) {
      console.error(`安裝失敗。請手動執行：cd "${pluginRoot}" && npm install`);
      process.exit(1);
    }
    return await import('playwright-core');
  }
}

export async function launchBrowser(options = {}) {
  const { chromium } = await loadPlaywright();
  const opts = { headless: true, ...options };
  if (process.env.CHROMIUM_PATH) return chromium.launch({ ...opts, executablePath: process.env.CHROMIUM_PATH });
  try { return await chromium.launch(opts); } catch {}
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ ...opts, channel }); } catch {}
  }
  throw new Error('找不到瀏覽器。請安裝 Google Chrome，或執行：npx playwright-core install chromium（或設定 CHROMIUM_PATH）');
}
