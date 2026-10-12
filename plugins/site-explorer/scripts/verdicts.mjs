// "Results at a glance": one plain-language verdict per check (status, one-sentence headline, what to do next, which dashboard tab / file has the detail).
// Used by the dashboard's overview and by the console summary, so both say the same thing. Pure reading of the JSON files an exploration wrote.
// Everything that came from the site is length-limited by clean(); statuses: ok (nothing to do), warn (worth a look), bad (fix this), info (just a fact).
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { clean } from './untrusted.mjs';

const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const GOOD = new Set(['A+', 'A', 'A-', 'B+']), MID = new Set(['B', 'B-', 'C+', 'C']);
const gradeStatus = (g) => (!g ? 'info' : GOOD.has(g) ? 'ok' : MID.has(g) ? 'warn' : 'bad');
const worst = (...s) => (s.includes('bad') ? 'bad' : s.includes('warn') ? 'warn' : s.includes('ok') ? 'ok' : 'info');
export const CWV = { lcpMs: [2500, 4000], cls: [0.1, 0.25], ttfbMs: [800, 1800], fcpMs: [1800, 3000], tbtMs: [200, 600] }; // Google's published "good" / "poor" boundaries

/** siteDir = the crawl folder of one site; outDir = the exploration folder (visual.json lives there). Returns [{ id, title, status, headline, next, tab, file }]. */
export function computeVerdicts(siteDir, outDir = null) {
  const out = [];
  const push = (v) => out.push({ next: '', file: null, ...v });
  const health = rd(path.join(siteDir, 'health.json'));
  if (health) {
    const sev = health.severity || {}; const urgent = (sev.critical || 0) + (sev.high || 0);
    const status = health.verdict?.status === 'fail' ? 'bad' : urgent ? 'warn' : health.score >= 80 ? 'ok' : 'warn';
    push({ id: 'health', title: _t('網站健檢（SEO、連結、行動版）'), status, headline: _t`${health.score} 分（${health.grade}）${urgent ? _t`・${urgent} 項需要優先處理` : _t('・沒有緊急問題')}`, next: urgent ? _t('先看「健檢」分頁最上面的問題，每項都有修正方式。') : _t('可以到「健檢」分頁看中低優先的改善建議。'), tab: 'health', file: 'health.md' });
  }
  const a11y = rd(path.join(siteDir, 'a11y.json'));
  if (a11y) {
    const bad = (a11y.rules || []).filter((r) => r.impact === 'critical' || r.impact === 'serious').length;
    push({ id: 'a11y', title: _t('無障礙（螢幕閱讀器、對比）'), status: bad ? 'bad' : (a11y.rules || []).length ? 'warn' : 'ok', headline: (a11y.rules || []).length ? _t`${(a11y.rules || []).length} 種違規，其中 ${bad} 種嚴重或重要` : _t('自動檢查沒有發現違規'), next: _t('自動檢查只能發現一部分問題，仍需要人工檢查。'), tab: 'health', file: 'health.md' });
  }
  const sec = rd(path.join(siteDir, 'security.json'));
  if (sec) {
    const hs = gradeStatus(sec.headers?.grade), ts = sec.tls ? gradeStatus(sec.tls.grade) : 'info';
    const fixes = (sec.headers?.tests || []).filter((t) => t.points <= -10).sort((a, b) => a.points - b.points).slice(0, 3).map((t) => clean(String(t.name), 40));
    push({ id: 'security', title: _t('安全設定（標頭與加密連線）'), status: sec.headers ? worst(hs, ts === 'info' ? 'ok' : ts, fixes.length ? 'warn' : 'ok') : ts, headline: _t`標頭 ${sec.headers?.grade ?? '—'}${sec.tls ? _t`・加密連線 ${sec.tls.grade ?? '—'}` : _t('・加密連線未檢查')}`, next: fixes.length ? _t`先補：${fixes.join(_t('、'))}` : _t('標頭設定沒有明顯缺口。'), tab: 'security', file: 'security.md' });
  }
  const perf = rd(path.join(siteDir, 'performance.json'));
  if (perf?.medians) {
    const m = perf.medians; const marks = [];
    for (const [k, [good, poor]] of Object.entries(CWV)) if (Number.isFinite(m[k])) marks.push(m[k] <= good ? 'ok' : m[k] <= poor ? 'warn' : 'bad');
    let status = marks.length ? worst(...marks) : 'info'; if (perf.result?.failed) status = 'bad';
    const lcp = Number.isFinite(m.lcpMs) ? _t`最大內容 ${(m.lcpMs / 1000).toFixed(1)} 秒` : '';
    push({ id: 'perf', title: _t('速度與載入'), status, headline: [lcp, Number.isFinite(m.totalKB) ? _t`頁面 ${m.totalKB} KB` : '', Number.isFinite(m.requests) ? _t`${m.requests} 個請求` : ''].filter(Boolean).join(_t('・')) || _t('沒有量到數值'), next: perf.result?.failed ? _t('有效能預算超標。') : status === 'ok' ? _t('速度在 Google 建議範圍內。') : _t('標示紅色、黃色的指標優先改善。'), tab: 'perf', file: 'performance.md' });
  }
  const beh = rd(path.join(siteDir, 'tracking-behaviors.json'));
  if (beh?.flags) {
    const f = beh.flags; const status = f.keystrokeLeak ? 'bad' : f.replay || f.fingerprintThirdParty || f.keyListenerThirdParty ? 'warn' : 'ok';
    const bits = [f.keystrokeLeak && _t('輸入的文字被送到別的網站'), f.replay && _t`有錄製訪客操作的服務（${(beh.replay || []).map((x) => clean(x.name, 20)).slice(0, 3).join(_t('、'))}）`, f.fingerprintThirdParty && _t('第三方腳本在讀取瀏覽器指紋'), f.keyListenerThirdParty && _t('第三方腳本在監聽整頁的鍵盤事件')].filter(Boolean);
    push({ id: 'privacy', title: _t('隱私與追蹤行為'), status, headline: bits.length ? bits.join(_t('；')) : _t('沒有發現錄製、指紋或輸入外流'), next: bits.length ? _t('這是值得查的線索，不是濫用的證據。') : '', tab: 'privacy', file: 'tracking-behaviors.md' });
  }
  const tech = rd(path.join(siteDir, 'techstack.json'));
  if (tech) push({ id: 'tech', title: _t('網站用了什麼技術'), status: 'info', headline: (tech.items || []).length ? (tech.items || []).slice(0, 6).map((i) => clean(i.name + (i.version ? ' ' + i.version : ''), 30)).join(_t('、')) : _t('沒有辨識出已知技術'), next: '', tab: 'tech', file: 'techstack.md' });
  const vis = outDir ? rd(path.join(outDir, 'visual.json')) : null;
  if (vis) {
    const changed = (vis.rows || []).filter((r) => r.status !== 'same').length;
    push({ id: 'visual', title: _t('畫面和基準比對'), status: changed ? 'bad' : 'ok', headline: changed ? _t`${changed} 張截圖和基準不同（共 ${(vis.rows || []).length} 張）` : _t`${(vis.rows || []).length} 張截圖都和基準一致`, next: changed ? _t('逐張看差異；確認是想要的改版後用 --approve 更新基準。') : '', tab: 'visual', file: 'visual.md' });
  }
  const tc = rd(path.join(siteDir, 'token-check.json'));
  if (tc && Number.isFinite(tc.offPct)) push({ id: 'tokens', title: _t('設計規範符合度'), status: tc.failed ? 'bad' : tc.offPct <= 5 ? 'ok' : tc.offPct <= 20 ? 'warn' : 'bad', headline: _t`${(100 - tc.offPct).toFixed(1)}% 的顏色、圓角、字級符合你的 token 檔`, next: tc.offPct > 0 ? _t('看 token-check.md 列出的不符合項目。') : '', tab: 'design', file: 'token-check.md' });
  const ex = outDir || siteDir ? rd(path.join(siteDir, 'extractions.json')) : null;
  if (ex) push({ id: 'extract', title: _t('自訂擷取'), status: 'info', headline: _t`${(ex.rules || []).length} 條規則・${(ex.rows || []).length} 頁`, next: '', tab: 'extract', file: 'extractions.csv' });
  return out;
}

export const STATUS_ICON = { ok: '✅', warn: '🟡', bad: '🔴', info: 'ℹ️' };

/** Console block: one line per check, same wording as the dashboard. */
export function renderVerdictsConsole(list) {
  if (!list.length) return '';
  return [_t('\n結果一覽'), ...list.map((v) => `  ${STATUS_ICON[v.status]} ${v.title}${_t("：")}${v.headline}${v.file ? `  → ${v.file}` : ''}`)].join('\n');
}
