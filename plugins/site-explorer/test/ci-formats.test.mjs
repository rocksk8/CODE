// SARIF and JUnit output: valid structure, severity mapping, hostile text stays inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toSarif, toJunit, collectFindings } from '../scripts/ci-formats.mjs';

function site() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-fmt-'));
  fs.writeFileSync(path.join(d, 'health.json'), JSON.stringify({ score: 71, grade: 'C', origin: 'https://x.test', verdict: { status: 'conditional' },
    issues: [{ id: 'soft-404', category: 'indexability', severity: 'high', title: 'Soft 404 <b>"x"</b> & more', detail: '', examples: ['https://x.test/missing: returns 200'], fix: 'Return 404.' }, { id: 'og', category: 'onpage', severity: 'low', title: 'No og:image\u0001', examples: [] }, { id: 'info1', category: 'onpage', severity: 'info', title: 'FYI' }],
    passed: [{ category: 'links', title: 'No broken links' }] }));
  fs.writeFileSync(path.join(d, 'performance.json'), JSON.stringify({ result: { violations: [{ url: 'https://x.test/', metric: 'lcpMs', value: 4000, max: 2500, level: 'fail' }] } }));
  fs.writeFileSync(path.join(d, 'security.json'), JSON.stringify({ headers: { tests: [{ id: 'csp', name: 'CSP', points: -25, result: 'not set', fix: 'Add CSP' }, { id: 'nosniff', name: 'nosniff', points: 0, result: 'ok' }] }, tls: { tests: [{ id: 'legacy', name: 'Legacy', result: 'TLS 1.0', cap: 'B', fix: 'Disable' }] } }));
  return d;
}

test('SARIF: 2.1.0 shape, severity → level, location from the example URL, one rule per id', () => {
  const d = site(); const s = toSarif(d, { visual: { rows: [{ slug: 'home', viewport: 'mobile', status: 'changed', changedPct: 3.2 }] } });
  assert.equal(s.version, '2.1.0'); const run = s.runs[0]; assert.equal(run.tool.driver.name, 'site-explorer');
  const by = Object.fromEntries(run.results.map((r) => [r.ruleId, r]));
  assert.equal(by['soft-404'].level, 'error'); assert.equal(by['og'].level, 'note'); assert.equal(by['perf-lcpMs'].level, 'error'); assert.equal(by['security-csp'].level, 'error'); assert.equal(by['tls-legacy'].level, 'warning'); assert.equal(by['visual-changed'].level, 'error');
  assert.equal(by['soft-404'].locations[0].physicalLocation.artifactLocation.uri, 'https://x.test/missing');
  assert.equal(new Set(run.tool.driver.rules.map((r) => r.id)).size, run.tool.driver.rules.length);
  assert.ok(!by['security-nosniff'], 'zero-point tests are not findings');
  JSON.parse(JSON.stringify(s));
});

test('JUnit: well-formed XML, suites per category, failures for real findings, info and passed checks pass, markup escaped', () => {
  const d = site(); const x = toJunit(d);
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>/); assert.match(x, /<testsuite name="indexability" tests="1" failures="1"/);
  assert.match(x, /<testsuite name="links" tests="1" failures="0"/); assert.match(x, /failure type="high"/);
  assert.ok(!/<b>/.test(x) && x.includes('&amp; more') && x.includes('&quot;x&quot;') && !/\u0001/.test(x));
  const tests = Number(/<testsuites[^>]* tests="(\d+)"/.exec(x)[1]); assert.equal((x.match(/<testcase /g) || []).length, tests);
  const failures = Number(/<testsuites[^>]* failures="(\d+)"/.exec(x)[1]); assert.equal((x.match(/<failure /g) || []).length, failures);
  assert.equal(collectFindings(fs.mkdtempSync(path.join(os.tmpdir(), 'se-empty-'))).findings.length, 0, 'a folder without results gives no findings');
});
