// Machine-readable result of an exploration (for --json, the MCP server and CI). Counts, scores, verdicts and file paths only —
// every string that came from the website is sanitised, and no page text, cookie value or secret is ever included.
import fs from 'node:fs';
import path from 'node:path';
import { cleanDeep, BANNER } from './untrusted.mjs';

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sev = ['critical', 'high', 'medium', 'low'];

/** Summarise an output folder written by `explore`. Safe to call on partial results: missing parts are null. */
export function buildSummary({ out, host, steps = [], url = null }) {
  const siteDir = path.join(out, 'site', host), motionDir = path.join(out, 'motion', host), handoff = path.join(out, 'handoff');
  const health = readJSON(path.join(siteDir, 'health.json'));
  const verify = readJSON(path.join(handoff, 'verify', 'verify.json'));
  const site = readJSON(path.join(siteDir, 'site.json'));
  const motionPages = readJSON(path.join(motionDir, 'pages.json'));
  const a11y = readJSON(path.join(siteDir, 'a11y.json'));
  const has = (f) => fs.existsSync(f);
  const raw = {
    schemaVersion: 1, url, host, authenticated: !!site?.authenticated,
    steps: steps.map((s) => ({ name: s.label, ok: !!s.ok, seconds: Number(s.s) })),
    pages: site ? { crawled: (site.pages || []).length, blocked: (site.blockedPages || []).length } : null,
    health: health ? {
      score: health.score, grade: health.grade, verdict: health.verdict?.status ?? null, verdictLabel: health.verdict?.label ?? null,
      issueCounts: Object.fromEntries(sev.map((s) => [s, (health.issues || []).filter((i) => i.severity === s).length])),
      blocking: (health.verdict?.blocking || []).map((b) => ({ id: b.id, severity: b.severity, title: b.title })),
      topIssues: (health.issues || []).slice(0, 10).map((i) => ({ id: i.id, severity: i.severity, category: i.category, title: i.title, affected: i.affected, fix: i.fix })),
    } : null,
    a11y: a11y ? { pagesChecked: a11y.pagesChecked, ruleViolations: a11y.rules.length, byImpact: Object.fromEntries(['critical', 'serious', 'moderate', 'minor'].map((k) => [k, a11y.rules.filter((r) => r.impact === k).length])), top: a11y.rules.slice(0, 5).map((r) => ({ id: r.id, impact: r.impact, help: r.help, pages: r.pages, nodes: r.nodes })) } : null,
    motion: motionPages ? { pages: (motionPages.pages || []).length, elements: (motionPages.pages || []).reduce((n, p) => n + (p.targets || 0), 0) } : null,
    verify: verify ? { overall: verify.overall, grade: verify.grade, passed: verify.passed, weakest: (verify.pages || []).flatMap((p) => (p.sections || []).filter((s) => s.status === 'ok').map((s) => ({ page: p.page, section: s.name, score: s.score }))).sort((a, b) => a.score - b.score).slice(0, 3) } : null,
    files: {
      outputDir: out, dashboard: has(path.join(out, 'dashboard.html')) ? path.join(out, 'dashboard.html') : null,
      handoff: has(handoff) ? handoff : null, specJson: has(path.join(handoff, 'spec.json')) ? path.join(handoff, 'spec.json') : null,
      aiBrief: has(path.join(handoff, 'ai-brief.md')) ? path.join(handoff, 'ai-brief.md') : null,
      starter: has(path.join(handoff, 'starter')) ? path.join(handoff, 'starter') : null,
      healthMd: has(path.join(handoff, 'health.md')) ? path.join(handoff, 'health.md') : null,
    },
  };
  const suspects = [];
  const safe = cleanDeep(raw, 'summary', suspects, { max: 300, skip: ['files'] }); // file paths are ours; everything from the site is cleaned
  safe.files = raw.files;
  safe.untrustedNotice = suspects.length ? `${suspects.length} 段取自網站的文字疑似針對 AI 的指令，已隔離。` : null;
  safe.note = BANNER.replace(/^> /, '').replace(/\*\*/g, '');
  return safe;
}
