// Logged-in crawling: a Playwright "storage state" file (cookies + localStorage of a session you created with `site-explorer login`).
// The file is a SECRET (anyone holding it is you on that site). It is read, handed to the browser, and never copied into any output.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';

const MAX = 10 * 1024 * 1024;

/** Load and validate a storage-state file. Returns { file, cookieKeys, warnings }. Throws a user-readable Error. */
export function loadAuthState(file) {
  const p = path.resolve(String(file || ''));
  let st; try { st = fs.statSync(p); } catch { throw new Error(_t`找不到登入狀態檔：${p}\n先執行：site-explorer login <網址> 產生一個。`); }
  if (!st.isFile() || st.size > MAX) throw new Error(_t`登入狀態檔不是一般檔案，或超過 10 MB：${p}`);
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new Error(_t`登入狀態檔不是有效的 JSON：${p}`); }
  if (!j || typeof j !== 'object' || !Array.isArray(j.cookies) || (j.origins !== undefined && !Array.isArray(j.origins))) throw new Error(_t`這不是 site-explorer login 產生的登入狀態檔（缺少 cookies 欄位）：${p}`);
  const warnings = [];
  if (process.platform !== 'win32' && (st.mode & 0o077)) warnings.push(_t`登入狀態檔的權限太開放（其他使用者讀得到）：請執行 chmod 600 "${p}"`);
  const expired = j.cookies.filter((c) => typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < Date.now()).length;
  if (j.cookies.length && expired === j.cookies.length) warnings.push(_t('登入狀態檔裡的 cookie 全部過期了，登入多半已失效：請重新執行 site-explorer login。'));
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
  if (/(wp-admin|wp-login|\/ghost\/|(^|\/)(admin|administrator|login|logout|signin|sign-in)(\/|\.[a-z]+$|$))/i.test(u.pathname)) return true; // whole path segments: /administration and /login-help are ordinary pages
  // links that change or destroy something when merely visited are never followed, logged in or not (whole path segments only: /cancellation-policy and /blog/delete-your-data are normal pages)
  return /(^|\/)(log-?out|sign-?out|delete|remove|destroy|unsubscribe|deactivate|close-?account|revoke|disconnect|purge|wipe|trash)([_-](account|user|me|all|profile|item|post|comment|order|id))?(\.[a-z]+)?(?=\/|$)/i.test(u.pathname) || /[?&](action|do|op)=(log-?out|sign-?out|delete|remove|destroy|unsubscribe)/i.test(u.search);
}

/** True for a URL that looks like it changes or destroys something when fetched (used by the link checker). */
export function isDestructiveUrl(href) { try { const u = new URL(href); return DESTRUCTIVE_PATH.test(u.pathname) || /[?&](action|do|op)=(log-?out|sign-?out|delete|remove|destroy|unsubscribe)/i.test(u.search); } catch { return false; } }

// ---------------------------------------------------------------- other ways to be "logged in": a cookie file, extra request headers, HTTP basic auth
// None of these secrets is ever written to an output file. Cookies become a temporary 0600 storage-state file (deleted when the run ends); headers and
// basic-auth travel to the child scripts in environment variables (not on the command line) and are attached ONLY to requests to the start origin.
import os from 'node:os';

const HEADER_NAME = /^[A-Za-z0-9-]{1,40}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'upgrade']);

/** Cookies from a file: Playwright storage-state JSON, a JSON array [{name,value,domain?,path?}], a Netscape cookies.txt, or one "a=1; b=2" line. */
export function parseCookieFile(text, host, { secure = true } = {}) {
  const base = (c) => ({ name: String(c.name), value: String(c.value ?? ''), domain: String(c.domain || host) || host, path: String(c.path || '/'), expires: Number.isFinite(c.expires) ? c.expires : -1, httpOnly: !!c.httpOnly, secure: c.secure ?? secure, sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax' });
  const ok = (c) => /^[^\s=;,"\\\x00-\x1f]{1,100}$/.test(c.name) && c.value.length <= 4000 && !/[\r\n\x00]/.test(c.value);
  const t = String(text).trim(); let list = null;
  if (t.startsWith('{') || t.startsWith('[')) { let j; try { j = JSON.parse(t); } catch { throw new Error(_t('cookie 檔不是有效的 JSON。')); } const arr = Array.isArray(j) ? j : Array.isArray(j?.cookies) ? j.cookies : null; if (!arr) throw new Error(_t('cookie 檔必須是 cookie 陣列，或含 cookies 欄位的登入狀態檔。')); list = arr.filter((c) => c && typeof c.name === 'string').map(base); }
  else if (/^\S+\t(TRUE|FALSE)\t/im.test(t)) list = t.split(/\r?\n/).filter((l) => l && !l.startsWith('# ') && l !== '#').map((l) => (l.startsWith('#HttpOnly_') ? l.slice(10) : l).split('\t')).filter((p) => p.length >= 7).map((p) => base({ domain: p[0], path: p[2], secure: p[3] === 'TRUE', expires: Number(p[4]) || -1, name: p[5], value: p.slice(6).join('\t') }));
  else list = t.split(/;\s*/).map((kv) => { const i = kv.indexOf('='); return i > 0 ? base({ name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim() }) : null; }).filter(Boolean);
  list = list.filter(ok).slice(0, 200); if (!list.length) throw new Error(_t('cookie 檔裡沒有可用的 cookie。'));
  return list;
}

/** Validate "Name: value" header specs (from --header / a JSON object file). Returns an object. */
export function parseHeaders(specs) {
  const out = {};
  for (const s of specs) {
    const [name, value] = typeof s === 'string' ? [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1).trim()] : s;
    if (!HEADER_NAME.test(String(name || '').trim()) || FORBIDDEN_HEADERS.has(String(name).trim().toLowerCase())) throw new Error(_t`標頭名稱「${String(name).slice(0, 30)}」不可用（只能用英數字與連字號；Host、Cookie、Content-Length 等不能自訂，cookie 請用 --cookie-file）。`);
    if (typeof value !== 'string' || !value || value.length > 2000 || /[\r\n\x00]/.test(value)) throw new Error(_t`標頭「${String(name).trim()}」的值不可為空、超過 2000 字或含換行。`);
    out[String(name).trim()] = value;
  }
  if (Object.keys(out).length > 20) throw new Error(_t('自訂標頭最多 20 個。'));
  return out;
}

export function parseBasicAuth(line) {
  const s = String(line || '').split(/\r?\n/)[0]; const i = s.indexOf(':');
  if (i < 1 || s.length > 400 || /[\x00]/.test(s)) throw new Error(_t('basic auth 必須是「使用者:密碼」。'));
  return { username: s.slice(0, i), password: s.slice(i + 1) };
}

/** A temporary storage-state file (mode 0600, in a private temp folder). Returns { file, cleanup }. */
export function writeTempStorageState(cookies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-session-')); try { fs.chmodSync(dir, 0o700); } catch {}
  const file = path.join(dir, 'state.json'); fs.writeFileSync(file, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
  return { file, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

export const CRED_ENV = { headers: 'SITE_EXPLORER_HEADERS_JSON', basic: 'SITE_EXPLORER_BASIC_AUTH' };

/** Extra Playwright context options for the start origin (HTTP basic auth). Read from the environment the parent process set. */
export function credContextOptions(startUrl, env = process.env) {
  if (!env[CRED_ENV.basic]) return {};
  try { const b = parseBasicAuth(env[CRED_ENV.basic]); return { httpCredentials: { ...b, origin: new URL(startUrl).origin, send: 'unauthorized' } }; } catch { return {}; }
}

/** Attach the custom headers to requests that go to the start origin — and to nothing else. */
export async function applyCredentialRoutes(ctx, startUrl, env = process.env) {
  if (!env[CRED_ENV.headers]) return false;
  let headers; try { headers = parseHeaders(Object.entries(JSON.parse(env[CRED_ENV.headers]))); } catch { return false; }
  const origin = new URL(startUrl).origin;
  // Chromium keeps a header override across a redirect, even to another origin. So every request is fetched here WITHOUT following redirects and handed back to the page as it is:
  // the browser then follows a redirect as a NEW request, which gets the headers only if it is still on the start origin. (Requests that are not fetched here but continued cannot be mixed with fetched
  // ones: Chromium stalls them, so third-party requests are fetched too, just without the headers.)
  let basic = null; try { if (env[CRED_ENV.basic]) { const b = parseBasicAuth(env[CRED_ENV.basic]); basic = 'Basic ' + Buffer.from(`${b.username}:${b.password}`).toString('base64'); } } catch {}
  const extra = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  await ctx.route('**/*', async (route) => {
    const rq = route.request(); let same = false; try { same = new URL(rq.url()).origin === origin; } catch {}
    try { const resp = await route.fetch({ headers: same ? { ...rq.headers(), ...(basic ? { authorization: basic } : {}), ...extra } : rq.headers(), maxRedirects: 0, timeout: 30000 }); return await route.fulfill({ response: resp }); }
    catch { return route.abort('failed').catch(() => {}); }
  });
  return true;
}
