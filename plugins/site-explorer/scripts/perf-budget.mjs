#!/usr/bin/env node
// Performance budgets and a run-to-run history, from the lab numbers the crawl already measured (no extra page loads).
//   explore <url> --budget budget.json     fail (exit code 4) when a page goes over a budget with level "fail"
//   every run appends the median numbers to <out>/perf-history.json and writes performance.md with the trend against the previous run
// Lab numbers (headless browser, no throttling, one load) are noisy: use byte/request budgets for hard gates and timing budgets as "warn".
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

/** metric -> [label, unit, how to read it from page.json] ; all "lower is better" except where noted */
export const METRICS = {
  ttfbMs: ['TTFB', 'ms', (p) => p.seo?.http?.ttfbMs ?? p.seo?.perf?.ttfbMs],
  fcpMs: ['FCP', 'ms', (p) => p.seo?.perf?.fcpMs],
  lcpMs: ['LCP', 'ms', (p) => p.seo?.perf?.lcpMs],
  loadMs: ['load', 'ms', (p) => p.seo?.perf?.loadMs],
  cls: ['CLS', '', (p) => p.seo?.perf?.cls],
  tbtMs: ['TBT', 'ms', (p) => p.seo?.perf?.tbtMs],
  totalKB: ['transfer', 'KB', (p) => (p.seo?.perf?.totalBytes != null ? Math.round(p.seo.perf.totalBytes / 1024) : null)],
  requests: ['requests', '', (p) => p.seo?.perf?.requests],
  thirdPartyRequests: ['third-party hosts', '', (p) => p.seo?.perf?.thirdPartyCount],
  renderBlockingScripts: ['render-blocking scripts', '', (p) => p.seo?.perf?.renderBlockingScripts],
  domNodes: ['DOM nodes', '', (p) => p.seo?.perf?.domNodes],
};

/** Strict parse of a budget file: { "totalKB": 1500, "lcpMs": { "max": 2500, "level": "warn" } } — unknown keys are errors, not silently ignored. */
export function parseBudget(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('預算檔不是有效的 JSON。')); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(_t('預算檔必須是一個 JSON 物件，例如 {"totalKB": 1500}。'));
  const out = {};
  for (const [k, v] of Object.entries(j)) {
    if (!Object.hasOwn(METRICS, k)) throw new Error(_t`預算檔裡有不認得的項目「${clean(k, 40)}」。可用：${Object.keys(METRICS).join(', ')}`);
    const max = typeof v === 'number' ? v : v && typeof v === 'object' ? v.max : NaN; const level = v && typeof v === 'object' && v.level ? v.level : 'fail';
    if (!(Number.isFinite(max) && max >= 0)) throw new Error(_t`預算「${k}」必須是 0 以上的數字（或 {"max": 數字, "level": "warn"}）。`);
    if (!['fail', 'warn'].includes(level)) throw new Error(_t`預算「${k}」的 level 只能是 fail 或 warn。`);
    out[k] = { max, level };
  }
  return out;
}

const live = (pages) => (pages || []).filter((p) => p && (!p.status || p.status < 400));
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };

/** One row per live page with every metric (null when it was not measured). */
export function collectPerf(pages) {
  return live(pages).map((p) => ({ url: String(p.url || ''), metrics: Object.fromEntries(Object.entries(METRICS).map(([k, [, , get]]) => { const v = get(p); return [k, Number.isFinite(v) ? v : null]; })) }));
}
export const medians = (rows) => Object.fromEntries(Object.keys(METRICS).map((k) => [k, med(rows.map((r) => r.metrics[k]))]));

/** violations = every page x metric over its limit. failed = at least one with level "fail". */
export function evaluateBudget(rows, budget) {
  const violations = [];
  for (const r of rows) for (const [k, b] of Object.entries(budget || {})) { const v = r.metrics[k]; if (v != null && v > b.max) violations.push({ url: r.url, metric: k, value: v, max: b.max, level: b.level }); }
  // a budget on a metric that was never measured cannot be "within budget": say so, and a fail-level one fails
  const unmeasured = Object.entries(budget || {}).map(([k, b]) => ({ metric: k, level: b.level, pages: rows.filter((r) => r.metrics[k] == null).length })).filter((u) => u.pages > 0);
  const blind = unmeasured.some((u) => u.level === 'fail' && u.pages === rows.length);
  return { violations, unmeasured, failed: violations.some((v) => v.level === 'fail') || blind, checked: rows.length };
}

/** history: [{ at, url, pages, medians }] newest last, capped. */
export function appendHistory(history, entry, cap = 60) {
  const list = Array.isArray(history) ? history.filter((h) => h && typeof h === 'object' && h.medians) : [];
  list.push(entry); return list.slice(-cap);
}

const fmt = (k, v) => (v == null ? '–' : `${v}${METRICS[k][1] ? ' ' + METRICS[k][1] : ''}`);

export function renderPerfMd({ rows, budget, result, history }) {
  const L = [BANNER, '', _t('# 效能預算與歷次紀錄'), '', _t('這些是實驗室數據（無頭瀏覽器、無節流、單次載入），拿來看趨勢與設門檻，不等於真實使用者體驗。'), ''];
  const m = medians(rows), prev = history.length > 1 ? history[history.length - 2].medians : null;
  L.push(_t('## 這次（各頁中位數）'), '', _t('| 指標 | 這次 | 上次 | 變化 |'), '|---|---|---|---|');
  for (const k of Object.keys(METRICS)) { const a = m[k], b = prev ? prev[k] : null; const d = a != null && b != null ? a - b : null; L.push(`| ${METRICS[k][0]} | ${fmt(k, a)} | ${fmt(k, b)} | ${d == null ? '–' : (d > 0 ? '+' : '') + (Math.round(d * 1000) / 1000)} |`); }
  L.push('');
  if (budget && Object.keys(budget).length) {
    if (result.unmeasured?.length) L.push(_t('## 沒有量到的指標'), '', ...result.unmeasured.map((u) => '- ' + _t`${METRICS[u.metric][0]}：${u.pages} 頁沒有量到數值，無法判斷是否在預算內${u.level === 'fail' ? _t('（fail 等級，視為未通過）') : ''}`), '');
    L.push(_t('## 預算'), '', result.violations.length ? _t('| 頁面 | 指標 | 實際 | 上限 | 等級 |') : _t('（所有頁面都在預算內）'));
    if (result.violations.length) { L.push('|---|---|---|---|---|'); for (const v of result.violations.slice(0, 60)) L.push(`| ${clean(v.url, 80)} | ${METRICS[v.metric][0]} | ${fmt(v.metric, v.value)} | ${fmt(v.metric, v.max)} | ${v.level === 'fail' ? _t('失敗') : _t('警告')} |`); }
    L.push('');
  }
  L.push(_t('## 歷次紀錄（最近 10 次）'), '', _t('| 時間 | LCP | 傳輸量 | 請求數 | TTFB |'), '|---|---|---|---|---|');
  for (const h of history.slice(-10).reverse()) L.push(`| ${clean(String(h.at), 25)} | ${fmt('lcpMs', h.medians.lcpMs)} | ${fmt('totalKB', h.medians.totalKB)} | ${fmt('requests', h.medians.requests)} | ${fmt('ttfbMs', h.medians.ttfbMs)} |`);
  L.push('');
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--site'), budgetFile = arg('--budget'), histFile = arg('--history');
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：perf-budget.mjs --site <含 site.json 的爬取資料夾> [--budget budget.json] [--history perf-history.json]')); process.exit(1); }
  try {
    const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
    const pages = (site.pages || []).map((p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
    const rows = collectPerf(pages);
    const budget = budgetFile ? parseBudget(fs.readFileSync(budgetFile, 'utf8')) : null;
    const result = budget ? evaluateBudget(rows, budget) : { violations: [], failed: false, checked: rows.length };
    const hf = histFile || path.join(path.dirname(path.dirname(dir)), 'perf-history.json'); // <out>/perf-history.json (dir = <out>/site/<host>)
    let old = []; try { old = JSON.parse(fs.readFileSync(hf, 'utf8')); } catch {}
    const history = appendHistory(old, { at: new Date().toISOString(), url: clean(String(site.startUrl || ''), 200), pages: rows.length, medians: medians(rows) });
    fs.writeFileSync(hf, JSON.stringify(history, null, 2));
    fs.writeFileSync(path.join(dir, 'performance.json'), JSON.stringify({ rows, medians: medians(rows), budget, result, historyFile: hf }, null, 2));
    fs.writeFileSync(path.join(dir, 'performance.md'), renderPerfMd({ rows, budget, result, history }) + '\n');
    console.log(budget ? (result.failed ? _t`✖ 效能預算：${result.violations.filter((v) => v.level === 'fail').length} 項超標` : result.violations.length ? _t`⚠ 效能預算：${result.violations.length} 項警告，沒有失敗項` : _t('✔ 效能預算：全部在預算內')) : _t('效能紀錄已更新（沒有指定 --budget）'));
    console.log(_t`   詳情：${path.join(dir, 'performance.md')}`);
  } catch (e) { console.error('✖ ' + String(e.message).split('\n')[0]); process.exit(1); }
}
