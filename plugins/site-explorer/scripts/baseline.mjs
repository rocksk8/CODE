// Local "drift baseline": approve what the site looks like today (design tokens + health), then compare later runs against it.
//   explore <url> --approve               write baseline.json (default: <out>/baseline.json, or --baseline <file>)
//   explore <url> --compare               compare this run with the baseline; exit code 4 when it drifted beyond the allowed limits
//     --max-drop N        allowed health-score drop (default 5)
//     --fail-on-new SEV   fail on a new issue of this severity or worse (default high)
// Design tokens are compared exactly (a colour or font that changed is drift); everything read from the site is whitelisted before it is written.
import { _t } from './i18n.mjs';
import { clean, safe } from './untrusted.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const BASELINE_SCHEMA = 1;
const COLOR_ROLES = ['brand', 'accent', 'background', 'surface', 'text', 'text-inverse', 'surface-dark', 'border'];

/** tokens = design-bundle/tokens.json, health = health.json. Returns the object that is stored. */
export function makeBaseline({ tokens, health, url, crawledAt = new Date().toISOString(), pages = null }) {
  const colors = {}; for (const r of COLOR_ROLES) if (HEX.test(tokens?.color?.[r] || '')) colors[r] = tokens.color[r].toLowerCase();
  const fs = tokens?.typography?.fontStack || {}; const fonts = {}; for (const k of ['heading', 'body', 'mono']) if (fs[k]) fonts[k] = safe(String(fs[k]), 60); // instruction-like text becomes the quarantine marker
  const base = Number(tokens?.spacing?.baseUnit);
  return {
    schema: BASELINE_SCHEMA, createdAt: String(crawledAt).slice(0, 40), url: safe(String(url || ''), 300), pages: Number.isFinite(pages) ? pages : null,
    tokens: { colors, fonts, baseUnit: Number.isFinite(base) ? base : null, radius: (tokens?.radius || []).map(String).filter((r) => /^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(r)).slice(0, 8), breakpoints: (tokens?.breakpoints || []).filter(Number.isFinite).slice(0, 8) },
    health: health ? { score: Number.isFinite(health.score) ? health.score : null, verdict: clean(String(health.verdict?.status ?? ''), 20), issues: (health.issues || []).slice(0, 400).map((i) => ({ id: safe(String(i.id), 60), severity: Object.hasOwn(RANK, i.severity) ? i.severity : 'low' })) } : null,
  };
}

/** Strict parse of a stored baseline (it is a file the user may have edited or fetched from somewhere else). */
export function parseBaseline(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('基準檔不是有效的 JSON。')); }
  if (!j || typeof j !== 'object' || j.schema !== BASELINE_SCHEMA || typeof j.tokens !== 'object' || !j.tokens) throw new Error(_t('這不是 site-explorer 的基準檔（schema 不符）。請用 --approve 重新建立。'));
  return j;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Pure comparison. Returns { failed, reasons[], tokenChanges[], scoreDelta, newIssues[], resolvedIssues[] }. */
export function compareBaseline(base, cur, { maxDrop = 5, failOnNew = 'high' } = {}) {
  const tokenChanges = [], reasons = [];
  for (const r of new Set([...Object.keys(base.tokens.colors || {}), ...Object.keys(cur.tokens.colors || {})])) {
    const a = base.tokens.colors?.[r], b = cur.tokens.colors?.[r]; if (a !== b) tokenChanges.push({ kind: 'color', name: r, from: a ?? null, to: b ?? null });
  }
  for (const k of new Set([...Object.keys(base.tokens.fonts || {}), ...Object.keys(cur.tokens.fonts || {})])) {
    const a = base.tokens.fonts?.[k], b = cur.tokens.fonts?.[k]; if (a !== b) tokenChanges.push({ kind: 'font', name: k, from: a ?? null, to: b ?? null });
  }
  if ((base.tokens.baseUnit ?? null) !== (cur.tokens.baseUnit ?? null)) tokenChanges.push({ kind: 'spacing', name: 'baseUnit', from: base.tokens.baseUnit ?? null, to: cur.tokens.baseUnit ?? null });
  if (!same(base.tokens.radius, cur.tokens.radius)) tokenChanges.push({ kind: 'radius', name: 'radius', from: (base.tokens.radius || []).join(', ') || null, to: (cur.tokens.radius || []).join(', ') || null });
  if (!same(base.tokens.breakpoints, cur.tokens.breakpoints)) tokenChanges.push({ kind: 'breakpoints', name: 'breakpoints', from: (base.tokens.breakpoints || []).join(', ') || null, to: (cur.tokens.breakpoints || []).join(', ') || null });
  if (tokenChanges.length) reasons.push(_t`設計 token 有 ${tokenChanges.length} 項和基準不同`);

  const bs = base.health?.score, cs = cur.health?.score; const scoreDelta = Number.isFinite(bs) && Number.isFinite(cs) ? cs - bs : null;
  if (scoreDelta != null && -scoreDelta > maxDrop) reasons.push(_t`健檢分數從 ${bs} 降到 ${cs}（降了 ${-scoreDelta}，容許 ${maxDrop}）`);
  const known = new Map((base.health?.issues || []).map((i) => [i.id, i.severity])), now = new Map((cur.health?.issues || []).map((i) => [i.id, i.severity]));
  const newIssues = [...now].filter(([id, sev]) => !known.has(id) || RANK[sev] < RANK[known.get(id)]).map(([id, severity]) => ({ id, severity, worsened: known.has(id) }));
  const resolvedIssues = [...known].filter(([id]) => !now.has(id)).map(([id, severity]) => ({ id, severity }));
  if (failOnNew && Object.hasOwn(RANK, failOnNew)) { const bad = newIssues.filter((i) => RANK[i.severity] <= RANK[failOnNew]); if (bad.length) reasons.push(_t`有 ${bad.length} 個 ${failOnNew} 以上的新問題或惡化的問題：${bad.slice(0, 5).map((i) => i.id).join(', ')}`); }
  if (!base.health || !cur.health) reasons.push(_t('基準或這次沒有健檢結果，無法比較分數與問題（請不要加 --no-health）。'));
  return { failed: reasons.length > 0, reasons, tokenChanges, scoreDelta, newIssues, resolvedIssues };
}

export function renderDriftMd(base, cur, r) {
  const L = [_t('# 與基準的偏移'), '', `${_t`基準建立於`} ${base.createdAt}（${base.url}）`, '', r.failed ? `**${_t('偏移超過容許範圍')}**` : `**${_t('在容許範圍內')}**`, ''];
  if (r.reasons.length) L.push(...r.reasons.map((x) => `- ${x}`), '');
  L.push(_t('## 設計 token'), '', ...(r.tokenChanges.length ? r.tokenChanges.map((c) => `- ${c.kind} \`${clean(String(c.name), 40)}\`: ${c.from ?? '∅'} → ${c.to ?? '∅'}`) : [_t('（沒有變動）')]), '');
  L.push(_t('## 健檢'), '', r.scoreDelta == null ? _t('（無法比較分數）') : `${base.health.score} → ${cur.health.score}（${r.scoreDelta > 0 ? '+' : ''}${r.scoreDelta}）`, '');
  L.push(_t('### 新增或惡化的問題'), '', ...(r.newIssues.length ? r.newIssues.map((i) => `- ${i.severity}: ${i.id}${i.worsened ? _t('（比基準更嚴重）') : ''}`) : [_t('（沒有）')]), '');
  L.push(_t('### 已解決的問題'), '', ...(r.resolvedIssues.length ? r.resolvedIssues.map((i) => `- ${i.severity}: ${i.id}`) : [_t('（沒有）')]), '');
  return L.join('\n');
}
