// Launch Chromium: CHROMIUM_PATH > Playwright's Chromium > locally installed Chrome/Edge.
import { chromium } from 'playwright-core';

export async function launchBrowser(options = {}) {
  const opts = { headless: true, ...options };
  if (process.env.CHROMIUM_PATH) return chromium.launch({ ...opts, executablePath: process.env.CHROMIUM_PATH });
  try { return await chromium.launch(opts); } catch {}
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ ...opts, channel }); } catch {}
  }
  throw new Error('找不到瀏覽器。請安裝 Google Chrome，或執行：npx playwright-core install chromium（或設定 CHROMIUM_PATH）');
}
