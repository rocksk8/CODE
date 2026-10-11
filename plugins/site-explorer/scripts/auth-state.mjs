// Logged-in crawling: a Playwright "storage state" file (cookies + localStorage of a session you created with `site-explorer login`).
// The file is a SECRET (anyone holding it is you on that site). It is read, handed to the browser, and never copied into any output.
import fs from 'node:fs';
import path from 'node:path';

const MAX = 10 * 1024 * 1024;

/** Load and validate a storage-state file. Returns { file, cookieKeys, warnings }. Throws a user-readable Error. */
export function loadAuthState(file) {
  const p = path.resolve(String(file || ''));
  let st; try { st = fs.statSync(p); } catch { throw new Error(`找不到登入狀態檔：${p}\n先執行：site-explorer login <網址> 產生一個。`); }
  if (!st.isFile() || st.size > MAX) throw new Error(`登入狀態檔不是一般檔案，或超過 10 MB：${p}`);
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new Error(`登入狀態檔不是有效的 JSON：${p}`); }
  if (!j || typeof j !== 'object' || !Array.isArray(j.cookies) || (j.origins !== undefined && !Array.isArray(j.origins))) throw new Error(`這不是 site-explorer login 產生的登入狀態檔（缺少 cookies 欄位）：${p}`);
  const warnings = [];
  if (process.platform !== 'win32' && (st.mode & 0o077)) warnings.push(`登入狀態檔的權限太開放（其他使用者讀得到）：請執行 chmod 600 "${p}"`);
  const expired = j.cookies.filter((c) => typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < Date.now()).length;
  if (j.cookies.length && expired === j.cookies.length) warnings.push('登入狀態檔裡的 cookie 全部過期了，登入多半已失效：請重新執行 site-explorer login。');
  return { file: p, cookieKeys: new Set(j.cookies.map((c) => `${c.name}|${String(c.domain || '').replace(/^\./, '')}`)), warnings };
}

/** Paths that change or destroy things when merely visited. A logged-in crawler must never follow them. */
export const DESTRUCTIVE_PATH = /(log-?out|sign-?out|signoff|delete|remove|destroy|unsubscribe|deactivate|close-?account|cancel|revoke|reset|disconnect|purge|wipe|trash|\/ghost\/)/i;
const ASSET = /\.(pdf|zip|jpe?g|png|gif|svg|webp|mp4|css|js)(\?|$)/i;

/** Should the crawler skip this link? Anonymous mode keeps its old rules; logged-in mode keeps /account, /dashboard, /admin pages but never destructive links. */
export function skipLink(href, { authed = false } = {}) {
  let u; try { u = new URL(href); } catch { return true; }
  if (ASSET.test(href)) return true;
  if (authed) return DESTRUCTIVE_PATH.test(u.pathname) || /[?&](action|do|op)=(log-?out|sign-?out|delete|remove|destroy)/i.test(u.search);
  return /(wp-admin|wp-login|\/admin|\/login|\/ghost\/|\/administrator|logout|signin|sign-in)/i.test(u.pathname);
}

/** True for a URL that looks like it changes or destroys something when fetched (used by the link checker). */
export function isDestructiveUrl(href) { try { const u = new URL(href); return DESTRUCTIVE_PATH.test(u.pathname) || /[?&](action|do|op)=(log-?out|sign-?out|delete|remove|destroy|unsubscribe)/i.test(u.search); } catch { return false; } }
