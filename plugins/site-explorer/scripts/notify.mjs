// Tell someone when a site got worse: a webhook message (Slack / Teams / Discord style `{ "text": … }` plus the numbers) after a run, and
// `site-explorer schedule` which prints the exact line that makes the run happen every day or week (it never changes your computer itself).
import { _t } from './i18n.mjs';
import { isMain } from './util.mjs';
import { normalizeUrl } from './args.mjs';
import { clean } from './untrusted.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTIFY_MODES = ['always', 'drop', 'issues'];
/** drop = the score fell by at least maxDrop since the previous run of the same site, or a high / critical finding is new; issues = any high / critical finding; always. */
export function shouldNotify(mode, { score, prevScore, maxDrop = 5, urgent = 0, prevUrgent = null }) {
  if (mode === 'always') return true;
  if (mode === 'issues') return urgent > 0;
  const dropped = Number.isFinite(score) && Number.isFinite(prevScore) && prevScore - score >= maxDrop;
  const moreUrgent = prevUrgent != null && urgent > prevUrgent;
  return dropped || moreUrgent;
}
export function buildPayload({ url, score, grade, prevScore, urgent, fixes = [], dashboard = '', notices = [], lang = 'zh' }) {
  const en = lang === 'en'; const delta = Number.isFinite(score) && Number.isFinite(prevScore) ? score - prevScore : null;
  const head = en ? `site-explorer: ${clean(url, 200)} — health ${score ?? '—'}${grade ? ` (${grade})` : ''}${delta != null ? `, ${delta > 0 ? '+' : ''}${delta} since last run` : ''}${urgent ? `, ${urgent} high/critical issue(s)` : ''}`
    : `site-explorer：${clean(url, 200)} — 健檢 ${score ?? '—'} 分${grade ? `（${grade}）` : ''}${delta != null ? `，和上次相比 ${delta > 0 ? '+' : ''}${delta}` : ''}${urgent ? `，${urgent} 項高／緊急問題` : ''}`;
  const lines = [head, ...fixes.slice(0, 3).map((f, i) => `${i + 1}. ${clean(f.title, 160)}`), ...notices.slice(0, 3).map((n) => clean(n, 200))];
  return { text: lines.join('\n'), site: clean(url, 300), score: score ?? null, grade: grade || null, previousScore: prevScore ?? null, delta, urgent: urgent || 0, topFixes: fixes.slice(0, 3).map((f) => ({ title: clean(f.title, 160), severity: clean(f.severity || '', 20) })), dashboard: clean(dashboard, 300) };
}
/** POST the payload as JSON. Only http(s); ten seconds; the answer's body is never read into the report. Returns { ok, status } or { ok:false, error }. */
export async function postWebhook(webhook, payload, { fetchImpl = fetch } = {}) {
  let u; try { u = new URL(webhook); } catch { return { ok: false, error: 'not a URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'only http(s)' };
  try { const r = await fetchImpl(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(10000) }); try { await r.body?.cancel(); } catch {} return { ok: r.status >= 200 && r.status < 300, status: r.status }; }
  catch (e) { return { ok: false, error: String(e.cause?.code || e.message).slice(0, 80) }; }
}

// ---------------------------------------------------------------- schedule helper
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
/** Instructions (text) for running a check every day or week. platform: 'win32' | 'darwin' | 'linux'. */
export function scheduleText({ url, every = 'day', at = '08:30', webhook = null, platform = process.platform, node = process.execPath, bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs'), out = null, lang = 'zh' } = {}) {
  const en = lang === 'en'; const m = /^(\d{1,2}):(\d{2})$/.exec(at); if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(en ? '--at must look like 08:30' : '--at 要像 08:30');
  if (!['day', 'week'].includes(every)) throw new Error(en ? '--every must be day or week' : '--every 要是 day 或 week');
  const target = normalizeUrl(url); if (!target) throw new Error(en ? 'a valid address is required' : '需要有效的網址');
  const outDir = out || (platform === 'win32' ? '%USERPROFILE%\\site-explorer-watch' : '$HOME/site-explorer-watch');
  const args = `check ${q(target)} --no-open --out ${q(outDir)}${webhook ? ` --webhook ${q(webhook)}` : ''}`;
  const L = [];
  if (platform === 'win32') {
    L.push(en ? 'Windows (Task Scheduler) — paste into PowerShell:' : 'Windows（工作排程器）— 貼進 PowerShell：', `schtasks /Create /TN "site-explorer ${new URL(target).host}" /SC ${every === 'day' ? 'DAILY' : 'WEEKLY'} /ST ${String(+m[1]).padStart(2, '0')}:${m[2]} /TR "${q(node)} ${q(bin)} ${args.replace(/"/g, '\\"')}"`, en ? 'Remove later with: schtasks /Delete /TN "site-explorer ' + new URL(target).host + '" /F' : '之後要取消：schtasks /Delete /TN "site-explorer ' + new URL(target).host + '" /F');
  } else {
    const cron = `${+m[2]} ${+m[1]} * * ${every === 'day' ? '*' : '1'} ${q(node)} ${q(bin)} ${args}`;
    L.push(en ? 'macOS / Linux — add this line with `crontab -e`:' : 'macOS／Linux — 用 `crontab -e` 加入這一行：', cron);
  }
  L.push('', en ? 'GitHub Actions (runs in the cloud, no computer needs to stay on):' : 'GitHub Actions（在雲端執行，不用開著電腦）：', `on:\n  schedule:\n    - cron: "${+m[2]} ${(+m[1] + 16) % 24} * * ${every === 'day' ? '*' : '1'}"   # ${en ? 'UTC; assumes your local time is UTC+8, so this is' : 'UTC 時間；以台灣時間（UTC+8）換算，相當於'} ${at}\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: rocksk8/CODE@main\n        with:\n          url: ${target}`);
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const get = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  const url = a.find((x) => !x.startsWith('--') && normalizeUrl(x)); const lang = process.env.SITE_EXPLORER_LANG === 'en' ? 'en' : 'zh';
  try { console.log(scheduleText({ url, every: get('every', 'day'), at: get('at', '08:30'), webhook: get('webhook', null), out: get('out', null), lang })); }
  catch (e) { console.error(e.message + '\n' + _t('用法：site-explorer schedule <網址> [--every day|week] [--at 08:30] [--webhook <網址>]')); process.exit(1); }
}
