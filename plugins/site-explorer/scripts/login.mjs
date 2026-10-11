#!/usr/bin/env node
// login — sign in once by hand, in a real browser window, and save the session so later runs can explore pages behind the login.
//   login.mjs <網址> [--out ./auth-state.json]
// Your password is typed into the website's own page; this tool never sees it. What is saved is the browser session (cookies and
// localStorage) — a SECRET equal to being logged in. The file is created readable by you only. Keep it out of git; delete it when done.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { launchBrowser } from './launch.mjs';
import { normalizeUrl } from './args.mjs';
import { guardInternal, isMain } from './util.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

/** Write the file so only the owner can read it, even if it already existed with looser permissions. */
export function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.rmSync(file, { force: true }); } catch {}
  fs.writeFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

if (isMain(import.meta.url)) {
  const url = normalizeUrl(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out'));
  if (!url) { console.error(_t('用法：site-explorer login <網址> [--out ./auth-state.json]\n會開一個瀏覽器視窗讓你自己登入，然後存下登入狀態給 --storage-state 使用。')); process.exit(1); }
  if (!process.stdin.isTTY) { console.error(_t('login 需要在終端機裡互動執行（要你手動登入後按 Enter）。')); process.exit(1); }
  const out = path.resolve(opt('out', './auth-state.json'));
  const browser = await launchBrowser({ headless: false });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await guardInternal(ctx, url);
    const page = await ctx.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.error(_t('開啟頁面時出錯（仍可繼續手動操作）：') + String(e.message).split('\n')[0]));
    console.log(_t`\n請在剛開啟的瀏覽器視窗裡登入 ${new URL(url).host}（含兩步驟驗證）。\n登入完成、看到登入後的頁面之後，回到這裡按 Enter。\n`);
    await new Promise((r) => readline.createInterface({ input: process.stdin }).once('line', r));
    const state = await ctx.storageState();
    if (!state.cookies.length && !state.origins.length) { console.error(_t('沒有取得任何登入資料（cookie 或 localStorage 都是空的）。確定已登入了嗎？沒有存檔。')); process.exit(1); }
    writeSecret(out, JSON.stringify(state, null, 2));
    console.log(_t`✔ 已存到 ${out}（${state.cookies.length} 個 cookie；權限：只有你能讀）\n\n⚠️  這個檔案等於「你已登入」。不要放進 git、不要寄給別人；用完請刪除。\n   使用：site-explorer ${url} --storage-state "${out}"`);
  } finally { await browser.close(); }
}
