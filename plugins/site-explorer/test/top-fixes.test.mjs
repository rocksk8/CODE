import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeTopFixes, renderTopFixesMd, renderTopFixesConsole, fixPrompt } from '../scripts/top-fixes.mjs';

const mk = (files) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-tf-')); for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(d, k), JSON.stringify(v)); return d; };

test('top fixes: ranked by severity and breadth, at most 3, each with a paste-ready instruction', () => {
  const d = mk({
    'health.json': { issues: [
      { id: 'low-wide', severity: 'low', title: 'Minor thing', affected: 10, total: 10, impact: 'x', fix: 'y' },
      { id: 'crit-one', severity: 'critical', title: 'Site is noindex', affected: 1, total: 10, impact: 'Search engines skip it', fix: 'Remove noindex' },
      { id: 'high-wide', severity: 'high', title: 'No viewport', affected: 10, total: 10, impact: 'Not mobile friendly', fix: 'Add the viewport meta' },
      { id: 'med', severity: 'medium', title: 'Duplicate titles', affected: 5, total: 10, impact: 'z', fix: 'w' },
      { id: 'info', severity: 'info', title: 'Just a note', affected: 1, total: 1 },
    ] },
    'security.json': { headers: { tests: [{ id: 'csp', name: 'Content-Security-Policy', points: -25, result: 'not set', fix: 'Add a CSP' }, { id: 'nosniff', name: 'nosniff', points: -5, result: 'missing' }] } },
    'a11y.json': { rules: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast too low', helpUrl: 'https://dequeuniversity.com/x' }, { id: 'minor', impact: 'minor', help: 'x' }] },
  });
  try {
    const top = computeTopFixes(d);
    assert.equal(top.length, 3);
    assert.deepEqual(top.map((t) => t.id), ['health:crit-one', 'health:high-wide', 'security:csp']);
    for (const t of top) { assert.ok(t.prompt.includes(t.title)); assert.match(t.prompt, /代碼|程式碼/); }
    assert.ok(!computeTopFixes(d, 10).some((t) => /Just a note|nosniff|Minor/.test(t.title) && t.id !== 'health:low-wide'), 'info items and small gaps are not listed');
    const md = renderTopFixesMd(top); assert.match(md, /## 1\. Site is noindex/); assert.match(md, /```text/);
    assert.match(renderTopFixesConsole(top), /1\. \[/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('top fixes: nothing to report gives an empty list and a friendly file; hostile text is bounded', () => {
  const d = mk({ 'health.json': { issues: [{ id: 'x'.repeat(500), severity: 'high', title: 'T'.repeat(5000), affected: 1, total: 1, impact: 'I'.repeat(5000), fix: 'F'.repeat(5000) }] } });
  try {
    const t = computeTopFixes(d)[0]; assert.ok(t.title.length <= 200 && t.why.length <= 320 && t.fix.length <= 320);
    assert.match(fixPrompt({ title: 'a```b', why: '', fix: '', scope: '' }), /a/);
    assert.ok(!renderTopFixesMd([{ ...t, prompt: 'p```q' }]).includes('p```q'), 'a fence inside the prompt cannot break out of the code block');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  assert.deepEqual(computeTopFixes('/nonexistent-folder'), []);
  assert.match(renderTopFixesMd([]), /沒有發現|Nothing/);
});
