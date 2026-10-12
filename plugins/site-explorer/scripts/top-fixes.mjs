// "The 3 things to fix first": the exploration's findings ranked by how much they matter and how many pages they touch, each with a ready-to-paste instruction for an AI or an engineer.
// Reads the JSON files an exploration wrote (health, security, accessibility). Pure and offline; everything that came from the site is length-limited by clean().
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { clean } from './untrusted.mjs';

const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const SEV = { critical: 100, high: 60, medium: 30, low: 10, info: 0 };
// How much work a fix is: 1 = a line or a setting, 2 = a focused change, 3 = real engineering. By finding id; unknown ids count as 2.
const EASY = new Set(['img-no-dimensions', 'lcp-lazy', 'http1', 'cache-policy', 'img-offscreen-eager', 'title-missing', 'title-short', 'title-long', 'description-missing', 'description-length', 'lang-missing', 'h1-missing', 'h1-multiple', 'viewport-missing', 'canonical-missing', 'robots-missing', 'sitemap-missing', 'sitemap-not-in-robots', 'sitemap-lastmod', 'sitemap-empty', 'og-missing', 'twitter-card', 'favicon', 'blank-noopener', 'llms-txt', 'hsts', 'nosniff', 'referrer-policy', 'clickjack', 'version-disclosure', 'noindex', 'nofollow-page', 'robots-blocks-all', 'robots-blocks-pages', 'robots-blocks-resources', 'robots-syntax', 'robots-crawl-delay', 'anchor-empty', 'anchor-generic', 'img-broken', 'no-compression', 'heading-skips', 'canonical-other', 'canonical-cross-host', 'ai-bots-blocked', 'sitemap-http', 'sitemap-noindex']);
const HARD = new Set(['unused-js', 'unused-css', 'js-dependent', 'ai-js-only', 'head-js-only', 'jsonld-js-only', 'dom-size', 'render-blocking', 'third-party', 'thin-content', 'orphan', 'mobile-overflow', 'small-text', 'tap-targets', 'no-https', 'tls-old', 'no-text-anywhere', 'bot-wall', 'session-replay', 'trackers-no-banner']);
export const effortOf = (id) => (EASY.has(id) ? 1 : HARD.has(id) ? 3 : 2);
const EFFORT_FACTOR = { 1: 1.5, 2: 1, 3: 0.6 };
const EFFORT_LABEL = () => ({ 1: _t('很快（改一行或一個設定）'), 2: _t('需要一點時間'), 3: _t('較費工（要改程式或架構）') });
const SEV_LABEL = () => ({ critical: _t('緊急'), high: _t('高'), medium: _t('中'), low: _t('低'), info: _t('提示') });

/** Builds the paste-ready instruction. */
export function fixPrompt({ title, why, fix, scope }) { // (the instruction does not carry the effort estimate: it is advice for the reader, not for the AI)
  return [_t`請幫我修正我網站的這個問題：${title}`, why ? _t`為什麼要修：${why}` : '', fix ? _t`建議做法：${fix}` : '', scope ? _t`影響範圍：${scope}` : '', _t('請直接給出修改後的程式碼或設定，並說明改了哪裡。')].filter(Boolean).join('\n');
}

/** siteDir = the crawl folder of one site. Returns up to n items, most important first: { id, source, severity, title, why, fix, scope, prompt }. */
export function computeTopFixes(siteDir, n = 10) {
  const items = [];
  const health = rd(path.join(siteDir, 'health.json'));
  for (const i of health?.issues || []) {
    const w = SEV[i.severity] ?? 0; if (!w) continue;
    const share = i.total ? Math.min(1, (i.affected || 1) / i.total) : 1;
    const scope = i.total ? _t`${i.affected || 1}／${i.total} 頁` : '';
    const effort = effortOf(String(i.id)); items.push({ id: 'health:' + clean(String(i.id), 60), source: 'health', severity: i.severity, effort, score: w * (0.6 + 0.4 * share) * EFFORT_FACTOR[effort], title: clean(String(i.title), 160), why: clean(String(i.impact || ''), 300), fix: clean(String(i.fix || ''), 300), scope });
  }
  const cv = rd(path.join(siteDir, 'crawler-view.json'));
  for (const i of cv?.issues || []) {
    const w = SEV[i.severity] ?? 0; if (!w) continue;
    const share = cv.checked ? Math.min(1, (i.affected || 1) / cv.checked) : 1; const effort = /js-only|js-partial/.test(i.id) ? 3 : 2;
    items.push({ id: 'crawler:' + clean(String(i.id), 60), source: 'crawler', severity: i.severity, effort, score: w * (0.6 + 0.4 * share) * EFFORT_FACTOR[effort], title: clean(String(i.title), 160), why: clean(String(i.why || ''), 300), fix: clean(String(i.fix || ''), 300), scope: cv.checked ? _t`${i.affected || 1}／${cv.checked} 頁` : '' });
  }
  const sec = rd(path.join(siteDir, 'security.json'));
  for (const t of sec?.headers?.tests || []) {
    if (!(t.points <= -10)) continue;
    const severity = t.points <= -20 ? 'high' : 'medium';
    const effort = t.id === 'csp' ? 2 : 1; items.push({ id: 'security:' + clean(String(t.id || t.name), 40), source: 'security', severity, effort, score: SEV[severity] * 0.9 * EFFORT_FACTOR[effort], title: _t`安全設定：${clean(String(t.name), 60)}（${clean(String(t.result), 80)}）`, why: _t('缺少這項設定會讓網站更容易被攻擊或被嵌進別人的頁面。'), fix: clean(String(t.fix || ''), 300), scope: '' });
  }
  const a11y = rd(path.join(siteDir, 'a11y.json'));
  for (const r of a11y?.rules || []) {
    if (r.impact !== 'critical' && r.impact !== 'serious') continue;
    const severity = r.impact === 'critical' ? 'high' : 'medium';
    items.push({ id: 'a11y:' + clean(String(r.id), 60), source: 'a11y', severity, effort: 2, score: SEV[severity] * 0.8, title: _t`無障礙：${clean(String(r.help || r.id), 120)}`, why: _t('使用螢幕閱讀器或鍵盤的人可能無法使用這個部分。'), fix: clean(String(r.helpUrl || ''), 200), scope: '' });
  }
  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set(), out = [];
  for (const it of items) { if (seen.has(it.id)) continue; seen.add(it.id); out.push({ ...it, prompt: fixPrompt(it) }); if (out.length >= n) break; }
  return out;
}

export function renderTopFixesConsole(list) {
  if (!list.length) return '';
  const L = SEV_LABEL(), E = { 1: _t('很快'), 2: _t('需要一點時間'), 3: _t('較費工') };
  return [_t('\n最該先處理的事'), ...list.map((f, i) => `  ${i + 1}. [${L[f.severity] || f.severity}] ${f.title}${f.scope ? `${_t('（')}${f.scope}${_t('）')}` : ''}${_t('；')}${E[f.effort] || ''}`), _t('  → 每一項附一段可以直接貼給 AI 的指令：top-fixes.md')].join('\n');
}

export function renderTopFixesMd(list) {
  const L = SEV_LABEL();
  const lines = [_t('# 最該先處理的事'), '', _t('依「影響大小 × 影響頁數 ÷ 修起來的難度」排序：影響大又容易修的排在前面。每一項附一段可以直接貼給 AI 或工程師的指令。這只是挑出最值得先看的幾項，完整清單見 health.md。'), ''];
  const E = EFFORT_LABEL();
  if (list.length) lines.push(`| # | ${_t('問題')} | ${_t('重要程度')} | ${_t('難度')} |`, '|---|---|---|---|', ...list.map((f, i) => `| ${i + 1} | ${String(f.title).replace(/\|/g, '/')} | ${L[f.severity] || f.severity} | ${E[f.effort] || ''} |`), '');
  if (!list.length) lines.push(_t('沒有發現需要優先處理的問題。'));
  list.forEach((f, i) => { lines.push(`## ${i + 1}. ${f.title}`, '', `- ${_t('難度')}${_t('：')}${E[f.effort] || ''}`, `- ${_t('重要程度')}${_t('：')}${L[f.severity] || f.severity}${f.scope ? `  ${_t('影響範圍')}${_t('：')}${f.scope}` : ''}`, ...(f.why ? [`- ${_t('為什麼要修')}${_t('：')}${f.why}`] : []), ...(f.fix ? [`- ${_t('怎麼修')}${_t('：')}${f.fix}`] : []), '', _t('可直接貼給 AI 的指令：'), '', '```text', f.prompt.replace(/```/g, "'''"), '```', ''); });
  return lines.join('\n');
}
