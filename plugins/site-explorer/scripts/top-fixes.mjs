// "The 3 things to fix first": the exploration's findings ranked by how much they matter and how many pages they touch, each with a ready-to-paste instruction for an AI or an engineer.
// Reads the JSON files an exploration wrote (health, security, accessibility). Pure and offline; everything that came from the site is length-limited by clean().
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { clean } from './untrusted.mjs';

const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const SEV = { critical: 100, high: 60, medium: 30, low: 10, info: 0 };
const SEV_LABEL = () => ({ critical: _t('緊急'), high: _t('高'), medium: _t('中'), low: _t('低'), info: _t('提示') });

/** Builds the paste-ready instruction. */
export function fixPrompt({ title, why, fix, scope }) {
  return [_t`請幫我修正我網站的這個問題：${title}`, why ? _t`為什麼要修：${why}` : '', fix ? _t`建議做法：${fix}` : '', scope ? _t`影響範圍：${scope}` : '', _t('請直接給出修改後的程式碼或設定，並說明改了哪裡。')].filter(Boolean).join('\n');
}

/** siteDir = the crawl folder of one site. Returns up to n items, most important first: { id, source, severity, title, why, fix, scope, prompt }. */
export function computeTopFixes(siteDir, n = 3) {
  const items = [];
  const health = rd(path.join(siteDir, 'health.json'));
  for (const i of health?.issues || []) {
    const w = SEV[i.severity] ?? 0; if (!w) continue;
    const share = i.total ? Math.min(1, (i.affected || 1) / i.total) : 1;
    const scope = i.total ? _t`${i.affected || 1}／${i.total} 頁` : '';
    items.push({ id: 'health:' + clean(String(i.id), 60), source: 'health', severity: i.severity, score: w * (0.6 + 0.4 * share), title: clean(String(i.title), 160), why: clean(String(i.impact || ''), 300), fix: clean(String(i.fix || ''), 300), scope });
  }
  const sec = rd(path.join(siteDir, 'security.json'));
  for (const t of sec?.headers?.tests || []) {
    if (!(t.points <= -10)) continue;
    const severity = t.points <= -20 ? 'high' : 'medium';
    items.push({ id: 'security:' + clean(String(t.id || t.name), 40), source: 'security', severity, score: SEV[severity] * 0.9, title: _t`安全設定：${clean(String(t.name), 60)}（${clean(String(t.result), 80)}）`, why: _t('缺少這項設定會讓網站更容易被攻擊或被嵌進別人的頁面。'), fix: clean(String(t.fix || ''), 300), scope: '' });
  }
  const a11y = rd(path.join(siteDir, 'a11y.json'));
  for (const r of a11y?.rules || []) {
    if (r.impact !== 'critical' && r.impact !== 'serious') continue;
    const severity = r.impact === 'critical' ? 'high' : 'medium';
    items.push({ id: 'a11y:' + clean(String(r.id), 60), source: 'a11y', severity, score: SEV[severity] * 0.8, title: _t`無障礙：${clean(String(r.help || r.id), 120)}`, why: _t('使用螢幕閱讀器或鍵盤的人可能無法使用這個部分。'), fix: clean(String(r.helpUrl || ''), 200), scope: '' });
  }
  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set(), out = [];
  for (const it of items) { if (seen.has(it.id)) continue; seen.add(it.id); out.push({ ...it, prompt: fixPrompt(it) }); if (out.length >= n) break; }
  return out;
}

export function renderTopFixesConsole(list) {
  if (!list.length) return '';
  const L = SEV_LABEL();
  return [_t('\n最該先處理的事'), ...list.map((f, i) => `  ${i + 1}. [${L[f.severity] || f.severity}] ${f.title}${f.scope ? `${_t('（')}${f.scope}${_t('）')}` : ''}`), _t('  → 每一項附一段可以直接貼給 AI 的指令：top-fixes.md')].join('\n');
}

export function renderTopFixesMd(list) {
  const L = SEV_LABEL();
  const lines = [_t('# 最該先處理的事'), '', _t('依影響大小與影響頁數排序，每一項附一段可以直接貼給 AI 或工程師的指令。這只是挑出最值得先看的幾項，完整清單見 health.md。'), ''];
  if (!list.length) lines.push(_t('沒有發現需要優先處理的問題。'));
  list.forEach((f, i) => { lines.push(`## ${i + 1}. ${f.title}`, '', `- ${_t('重要程度')}${_t('：')}${L[f.severity] || f.severity}${f.scope ? `  ${_t('影響範圍')}${_t('：')}${f.scope}` : ''}`, ...(f.why ? [`- ${_t('為什麼要修')}${_t('：')}${f.why}`] : []), ...(f.fix ? [`- ${_t('怎麼修')}${_t('：')}${f.fix}`] : []), '', _t('可直接貼給 AI 的指令：'), '', '```text', f.prompt.replace(/```/g, "'''"), '```', ''); });
  return lines.join('\n');
}
