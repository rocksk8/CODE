#!/usr/bin/env node
// Environment check with a concrete fix for every problem.  doctor.mjs [url]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './launch.mjs';
import { openDb, DB_PATH } from './db.mjs';

export async function runChecks(url) {
  const out = [];
  const add = (name, level, msg, fix) => out.push({ name, level, msg, fix });
  const [maj, min] = process.versions.node.split('.').map(Number);
  maj >= 18 ? add('Node.js', 'ok', process.version) : add('Node.js', 'fail', `${process.version} 太舊`, '請安裝 Node 18 以上：brew install node');

  let browser = null;
  try { browser = await launchBrowser(); add('瀏覽器', 'ok', browser.version()); }
  catch (e) { add('瀏覽器', 'fail', '找不到可用的 Chromium/Chrome', '安裝 Google Chrome，或執行 npx playwright-core install chromium，或設定 CHROMIUM_PATH'); }

  if (browser) {
    try { const c = await browser.newContext({ recordVideo: { dir: fs.mkdtempSync('/tmp/se-doc-') } }); await c.newPage(); await c.close(); add('錄影 (ffmpeg)', 'ok', '可用'); }
    catch { add('錄影 (ffmpeg)', 'warn', '不可用，3D 擷取仍可產生畫格，只是沒有 recording.webm', '執行 npx playwright-core install ffmpeg'); }
    await browser.close().catch(() => {});
  }

  maj > 22 || (maj === 22 && min >= 13) ? add('資料庫 (node:sqlite)', 'ok', `Node ${process.version}`) : add('資料庫 (node:sqlite)', 'warn', '需要 Node ≥ 22.13；其他功能不受影響，只會略過歷史資料庫', '升級：brew install node');
  try { const db = await openDb(); if (db) { db.close(); add('資料庫檔案', 'ok', DB_PATH); } } catch (e) { add('資料庫檔案', 'warn', '無法寫入 ' + DB_PATH, '設定 SITE_EXPLORER_DB 指向可寫入的路徑'); }

  if (url) {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)' } });
      r.ok ? add('連線', 'ok', `${new URL(url).host} → HTTP ${r.status}`) : add('連線', 'warn', `${new URL(url).host} 回應 HTTP ${r.status}（可能擋爬蟲或需要登入）`, '改用 Playwright MCP 以真實瀏覽器互動，或確認你有權存取');
    } catch (e) { add('連線', 'fail', `無法連到 ${new URL(url).host}：${e.cause?.code || e.message}`, '檢查網路；若在雲端沙盒，請到環境設定的 Network access 放行此網域'); }
  }
  return out;
}

export const printChecks = (rows) => {
  const icon = { ok: '✅', warn: '⚠️ ', fail: '❌' };
  for (const r of rows) console.log(`${icon[r.level]} ${r.name}：${r.msg}${r.fix ? `\n     → ${r.fix}` : ''}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = await runChecks(process.argv.slice(2).find((a) => /^https?:/.test(a)));
  printChecks(rows);
  process.exit(rows.some((r) => r.level === 'fail') ? 1 : 0);
}
