// Machine-readable results for CI systems: SARIF 2.1.0 (GitHub code scanning and other viewers) and JUnit XML (Jenkins, GitLab, CircleCI, Azure DevOps…).
// Built from the files of one exploration folder: health.json, performance.json, security.json, and visual.md's rows when a visual comparison ran.
// Everything the site supplied (titles, URLs, examples) is length-limited and XML/JSON-safe; nothing is executed or interpreted.
import fs from 'node:fs';
import path from 'node:path';
import { clean } from './untrusted.mjs';

const LEVEL = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SECURITY_SEV = (points) => (points <= -20 ? 'high' : points <= -10 ? 'medium' : 'low');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Flat list of findings: { id, category, severity, title, detail, url, fix } */
export function collectFindings(siteDir, { visual = null } = {}) {
  const out = [];
  const h = rd(path.join(siteDir, 'health.json'));
  for (const i of h?.issues || []) out.push({ id: String(i.id), category: i.category, severity: i.severity, title: clean(String(i.title || i.id), 200), detail: clean([i.detail, ...(i.examples || []).slice(0, 3)].filter(Boolean).join(' · '), 400), url: firstUrl(i.examples), fix: clean(String(i.fix || ''), 300) });
  const p = rd(path.join(siteDir, 'performance.json'));
  for (const v of p?.result?.violations || []) out.push({ id: `perf-${v.metric}`, category: 'performance-budget', severity: v.level === 'fail' ? 'high' : 'medium', title: clean(`${v.metric}: ${v.value} > budget ${v.max}`, 200), detail: '', url: /^https?:\/\//.test(v.url || '') ? String(v.url).slice(0, 300) : null, fix: '' });
  const s = rd(path.join(siteDir, 'security.json'));
  for (const t of s?.headers?.tests || []) if (t.points < 0) out.push({ id: `security-${t.id}`, category: 'security-headers', severity: SECURITY_SEV(t.points), title: clean(`${t.name}: ${t.result}`, 200), detail: '', url: null, fix: clean(String(t.fix || ''), 300) });
  for (const t of s?.tls?.tests || []) if (t.cap) out.push({ id: `tls-${t.id}`, category: 'tls', severity: t.cap === 'F' ? 'high' : 'medium', title: clean(`${t.name}: ${t.result}`, 200), detail: '', url: null, fix: clean(String(t.fix || ''), 300) });
  for (const r of visual?.rows || []) if (r.status !== 'same') out.push({ id: `visual-${r.status}`, category: 'visual-regression', severity: 'high', title: clean(`${r.slug} (${r.viewport}): ${r.status}${r.changedPct != null ? ` ${r.changedPct}%` : ''}`, 200), detail: '', url: null, fix: '' });
  return { findings: out, health: h ? { score: h.score, grade: h.grade, verdict: h.verdict?.status ?? null } : null, url: h?.origin || null };
}
function firstUrl(examples) { for (const e of examples || []) { const m = /^(https?:\/\/[^\s]+?)(?::\s|\s|$)/.exec(String(e)); if (m) return m[1].slice(0, 300); } return null; }

export function toSarif(siteDir, opts = {}) {
  const { findings, health, url } = collectFindings(siteDir, opts);
  const rules = [...new Map(findings.map((f) => [f.id, f])).values()].map((f) => ({ id: f.id, name: f.id.replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (m, c) => c.toUpperCase()) || f.id, shortDescription: { text: f.title }, ...(f.fix ? { help: { text: f.fix } } : {}), properties: { category: f.category } }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'site-explorer', informationUri: 'https://github.com/rocksk8/CODE', rules } },
      properties: { healthScore: health?.score ?? null, grade: health?.grade ?? null, site: url },
      results: findings.map((f) => ({ ruleId: f.id, level: LEVEL[f.severity] || 'note', message: { text: f.detail ? `${f.title} — ${f.detail}` : f.title }, locations: [{ physicalLocation: { artifactLocation: { uri: f.url || url || 'site' } } }], properties: { severity: f.severity, category: f.category } })),
    }],
  };
}

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One testsuite per category; every finding is a failing testcase (info-level ones pass but keep their text), each passed check is a passing testcase. */
export function toJunit(siteDir, opts = {}) {
  const { findings, health, url } = collectFindings(siteDir, opts);
  const h = rd(path.join(siteDir, 'health.json'));
  const suites = new Map();
  const suite = (c) => { if (!suites.has(c)) suites.set(c, []); return suites.get(c); };
  for (const p of h?.passed || []) suite(p.category || 'checks').push({ name: clean(String(p.title || ''), 200), ok: true });
  for (const f of findings) suite(f.category || 'checks').push({ name: `${f.id}: ${f.title}`, ok: f.severity === 'info', f });
  let tests = 0, failures = 0; const body = [];
  for (const [cat, cases] of suites) {
    const fails = cases.filter((c) => !c.ok).length; tests += cases.length; failures += fails;
    body.push(`  <testsuite name="${esc(cat)}" tests="${cases.length}" failures="${fails}" errors="0" skipped="0">`);
    for (const c of cases) {
      if (c.ok && !c.f) body.push(`    <testcase classname="${esc(cat)}" name="${esc(c.name)}"/>`);
      else if (c.ok) body.push(`    <testcase classname="${esc(cat)}" name="${esc(c.name)}"><system-out>${esc(c.f.detail || c.f.title)}</system-out></testcase>`);
      else body.push(`    <testcase classname="${esc(cat)}" name="${esc(c.name)}"><failure type="${esc(c.f.severity)}" message="${esc(c.f.title)}">${esc([c.f.detail, c.f.fix && 'Fix: ' + c.f.fix, c.f.url].filter(Boolean).join('\n'))}</failure></testcase>`);
    }
    body.push('  </testsuite>');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="site-explorer" tests="${tests}" failures="${failures}">\n${body.join('\n')}\n</testsuites>\n`;
}
