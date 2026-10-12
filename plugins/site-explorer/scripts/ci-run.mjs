#!/usr/bin/env node
// Everything the GitHub Action does except talking to GitHub: explore (and optionally a baseline), apply the gate, write the PR comment.
// Inputs come from environment variables (never interpolated into a shell): INPUT_URL, INPUT_BASELINE_URL, INPUT_MAX_PAGES, INPUT_FAIL_ON,
// INPUT_MIN_HEALTH, INPUT_OUT, INPUT_RUN_URL.  Writes comment.md and result.json into the output folder; appends outputs to $GITHUB_OUTPUT.
import './ci-lang.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeUrl } from './args.mjs';
import { isMain } from './util.mjs';
import { renderPrComment } from './pr-comment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'site-explorer.mjs');
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
let lang = 'en'; // the language of the PR comment and the reports (action input `lang`, default English)

const cli = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, SITE_EXPLORER_LANG: lang, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; p.stdout.on('data', (d) => (out += d));
  p.on('close', (status) => { let json = null; try { json = JSON.parse(out.slice(out.indexOf('{'))); } catch {} resolve({ status, json }); });
});

/** Decide pass/fail from a result — pure, so it can be tested without a browser. */
export function gateResult(result, { failOn, minHealth, baseline = null, maxDrop = null, failOnNew = null }) {
  const reasons = []; const h = result?.health;
  if (!h) return { failed: true, reasons: ['health check produced no result'] };
  if (failOn) { const bad = SEV_ORDER.filter((s) => RANK[s] <= RANK[failOn]).reduce((n, s) => n + (h.issueCounts?.[s] || 0), 0); if (bad) reasons.push(`${bad} issue(s) at ${failOn} or above`); }
  if (minHealth != null && h.score < minHealth) reasons.push(`health score ${h.score} is below ${minHealth}`);
  // regression gates compare with the baseline run (the production site): a gate that was asked for but cannot be evaluated is a failure, never a silent pass
  const b = baseline?.health;
  if ((maxDrop != null || failOnNew) && !(b && Number.isFinite(b.score))) reasons.push('the baseline run produced no health result, so max-drop / fail-on-new cannot be evaluated');
  if (maxDrop != null && b && Number.isFinite(b.score) && b.score - h.score > maxDrop) { const d = b.score - h.score; reasons.push(`health score dropped ${d} point${d === 1 ? '' : 's'} (baseline ${b.score} → ${h.score}; allowed drop ${maxDrop})`); }
  if (failOnNew && b && Array.isArray(h.issueList) && Array.isArray(b.issueList)) {
    const known = new Map(b.issueList.map((i) => [i.id, i.severity]));
    // new = an id the baseline does not have, or one that got worse (e.g. medium -> high)
    const fresh = h.issueList.filter((i) => RANK[i.severity] <= RANK[failOnNew] && (!known.has(i.id) || RANK[i.severity] < RANK[known.get(i.id)])).map((i) => i.id);
    if (fresh.length) reasons.push(`${fresh.length} new or worsened issue(s) at ${failOnNew} or above compared with the baseline: ${fresh.slice(0, 5).join(', ')}`);
  }
  return { failed: reasons.length > 0, reasons };
}
const SEV_ORDER = ['critical', 'high', 'medium', 'low'];

export async function main(env = process.env) {
  lang = /^zh/i.test(env.INPUT_LANG || '') ? 'zh' : 'en';
  const url = normalizeUrl(env.INPUT_URL); if (!url) throw new Error('input "url" must be a website address such as https://preview.example.com');
  const baselineUrl = env.INPUT_BASELINE_URL ? normalizeUrl(env.INPUT_BASELINE_URL) : null; if (env.INPUT_BASELINE_URL && !baselineUrl) throw new Error('input "baseline-url" is not a valid website address');
  const maxPages = Number(env.INPUT_MAX_PAGES || 6); if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new Error('input "max-pages" must be 1–50');
  const failOn = env.INPUT_FAIL_ON || null; if (failOn && !Object.hasOwn(RANK, failOn)) throw new Error('input "fail-on" must be critical, high, medium or low');
  const minHealth = env.INPUT_MIN_HEALTH ? Number(env.INPUT_MIN_HEALTH) : null; if (minHealth != null && !(minHealth >= 0 && minHealth <= 100)) throw new Error('input "min-health" must be 0–100');
  const maxDrop = env.INPUT_MAX_DROP && env.INPUT_MAX_DROP.trim() ? Number(env.INPUT_MAX_DROP) : null; if (maxDrop != null && !(maxDrop >= 0 && maxDrop <= 100)) throw new Error('input "max-drop" must be 0–100');
  const failOnNew = env.INPUT_FAIL_ON_NEW || null; if (failOnNew && !Object.hasOwn(RANK, failOnNew)) throw new Error('input "fail-on-new" must be critical, high, medium or low');
  if ((maxDrop != null || failOnNew) && !baselineUrl) throw new Error('inputs "max-drop" and "fail-on-new" compare with a baseline: set "baseline-url" too');
  const out = path.resolve(env.INPUT_OUT || 'site-explorer-out'); fs.mkdirSync(out, { recursive: true });
  const dbEnv = { SITE_EXPLORER_DB: path.join(out, 'history.db') }; // both runs share one database so the before/after report can compare them
  const common = ['--json', '--no-open', '--no-motion', '--max-pages', String(maxPages), ...(env.INPUT_A11Y === 'true' ? ['--a11y'] : [])];

  let baseline = null;
  if (baselineUrl) { const b = await cli([baselineUrl, ...common, '--no-handoff', '--out', path.join(out, 'baseline')], dbEnv); baseline = b.json; if (!baseline) console.error('baseline exploration failed; continuing without a comparison'); }
  const r = await cli([url, ...common, '--out', path.join(out, 'current')], dbEnv);
  const result = r.json || { ok: false, url, health: null };

  let changesMd = null;
  if (baseline?.runId && result.runId) {
    const f = path.join(out, 'changes.md');
    const c = await cli(['db', 'compare', String(baseline.runId), String(result.runId), '--md', f], dbEnv);
    if (c.status === 0 && fs.existsSync(f)) changesMd = fs.readFileSync(f, 'utf8');
  }
  const gate = gateResult(result, { failOn, minHealth, baseline, maxDrop, failOnNew });
  const comment = renderPrComment({ result, baseline, changesMd, minHealth, failOn, gate, runUrl: env.INPUT_RUN_URL || null });
  fs.writeFileSync(path.join(out, 'comment.md'), comment); fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ result, baseline, gate }, null, 2));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, comment + '\n');
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `score=${result.health?.score ?? ''}\nverdict=${result.health?.verdict ?? ''}\nfailed=${gate.failed}\ncomment-file=${path.join(out, 'comment.md')}\nout-dir=${out}\n`);
  return { gate, result, out };
}

if (isMain(import.meta.url)) {
  try { const { gate } = await main(); console.error(gate.failed ? `Gate failed: ${gate.reasons.join('; ')}` : 'Gate passed.'); process.exit(0); } // the action's last step fails the job AFTER the comment is posted
  catch (e) { console.error('✖ ' + e.message); process.exit(2); }
}
