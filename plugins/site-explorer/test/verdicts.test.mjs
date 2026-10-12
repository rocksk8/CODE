// Plain-language verdicts: one status + sentence per check, shared by the dashboard overview and the console summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeVerdicts, renderVerdictsConsole } from '../scripts/verdicts.mjs';

function dir(files) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'se-vd-')); for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(d, n), JSON.stringify(v)); return d; }
const by = (l) => Object.fromEntries(l.map((v) => [v.id, v]));

test('each check gets a status that matches its numbers, with a plain sentence and the tab / file that has the detail', () => {
  const d = dir({
    'health.json': { score: 55, grade: 'D', severity: { critical: 0, high: 2, medium: 3 }, verdict: { status: 'conditional' } },
    'security.json': { headers: { grade: 'F', score: 20, tests: [{ name: 'Content-Security-Policy', points: -25, result: 'x' }, { name: 'HSTS', points: -20, result: 'y' }] }, tls: { grade: 'A' } },
    'performance.json': { medians: { lcpMs: 5200, ttfbMs: 200, totalKB: 3000, requests: 80 }, result: { failed: false } },
    'tracking-behaviors.json': { flags: { replay: false, fingerprintThirdParty: false, keystrokeLeak: true }, replay: [] },
    'techstack.json': { items: [{ name: 'WordPress', version: '6.4' }, { name: 'nginx' }] },
    'extractions.json': { rules: [{ name: 'a' }], rows: [{ url: 'u' }] },
  });
  const o = dir({ 'visual.json': { rows: [{ status: 'same' }, { status: 'changed' }] } });
  const v = by(computeVerdicts(d, o));
  assert.equal(v.health.status, 'warn'); assert.match(v.health.headline, /55/); assert.equal(v.health.tab, 'health');
  assert.equal(v.security.status, 'bad'); assert.match(v.security.next, /Content-Security-Policy/);
  assert.equal(v.perf.status, 'bad'); assert.match(v.perf.headline, /5\.2/);
  assert.equal(v.privacy.status, 'bad'); assert.equal(v.tech.status, 'info'); assert.match(v.tech.headline, /WordPress 6\.4/);
  assert.equal(v.visual.status, 'bad'); assert.match(v.visual.headline, /1/); assert.equal(v.extract.status, 'info');
  const c = renderVerdictsConsole(computeVerdicts(d, o)); assert.ok(c.includes('🔴') && c.includes('security.md'));
});

test('good numbers are green; missing files produce no verdict; hostile names stay short and inert', () => {
  const d = dir({ 'security.json': { headers: { grade: 'A+', score: 105, tests: [] }, tls: { grade: 'A' } }, 'performance.json': { medians: { lcpMs: 1200, ttfbMs: 100, cls: 0.01, fcpMs: 900 } }, 'tracking-behaviors.json': { flags: {}, replay: [] }, 'techstack.json': { items: [{ name: 'X'.repeat(500) + '<script>', version: null }] } });
  const v = by(computeVerdicts(d)); assert.equal(v.security.status, 'ok'); assert.equal(v.perf.status, 'ok'); assert.equal(v.privacy.status, 'ok');
  assert.ok(v.tech.headline.length < 80 && !v.tech.headline.includes('<script>')); assert.equal(v.health, undefined); assert.deepEqual(computeVerdicts(fs.mkdtempSync(path.join(os.tmpdir(), 'se-vd0-'))), []);
});
