// verify: the rebuilt starter is compared with the original's section crops. A good rebuild must score high, a wrecked one low,
// the check must run offline, and it must never read a reference image from outside the handoff.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { verifyHandoff, declaredSections, scoreSection } from '../scripts/verify.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, '..', '..', 'docs', 'demo', 'acme-studio', 'handoff');
let haveBrowser = true, tmp;
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-verify-'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const copyDemo = (name) => { const d = path.join(tmp, name); fs.cpSync(demo, d, { recursive: true }); return d; };

test('scoreSection: identical is 100, wrong height and colours score low, never outside 0–100', () => {
  assert.equal(scoreSection({ lum: 0, col: 0, meanDist: 0, refH: 500, gotH: 500 }).score, 100);
  const bad = scoreSection({ lum: 0.6, col: 0.5, meanDist: 0.5, refH: 200, gotH: 1200 });
  assert.ok(bad.score >= 0 && bad.score < 20, String(bad.score));
});

test('declaredSections: only reference images inside media/ are accepted', () => {
  const d = path.join(tmp, 'h'); fs.mkdirSync(path.join(d, 'media'), { recursive: true }); fs.mkdirSync(path.join(d, 'starter'), { recursive: true });
  fs.writeFileSync(path.join(d, 'media', 'a.png'), 'x'); fs.writeFileSync(path.join(d, 'secret.png'), 'x');
  const html = '<!-- 1. hero | reference image: ../media/a.png | h -->\n<!-- 2. cta | reference image: ../secret.png | h -->\n<!-- 3. x | reference image: /etc/passwd | h -->';
  const s = declaredSections(html, path.join(d, 'starter'), d);
  assert.ok(s[0].ref && s[1].ref === null && s[2].ref === null);
});

test('verify: a faithful starter scores high, a wrecked one scores clearly lower, runs offline, writes evidence', async (t) => {
  if (!haveBrowser || !fs.existsSync(demo)) return t.skip('no browser or demo');
  const good = copyDemo('good');
  const g = await verifyHandoff(good, { minScore: 60 });
  assert.ok(g.overall >= 75, `faithful rebuild scored ${g.overall}`);
  assert.equal(g.passed, true);
  for (const f of ['verify.md', 'verify.json']) assert.ok(fs.existsSync(path.join(good, 'verify', f)));
  assert.ok(g.pages[0].sections.every((s) => s.status === 'ok' && fs.existsSync(path.join(good, 'verify', s.diff))), 'every section has a difference image');

  const bad = copyDemo('bad');
  const cssFile = path.join(bad, 'starter', 'styles.css');
  fs.appendFileSync(cssFile, '\n.sec,.site-header,.site-footer{background:#ff00aa !important;color:#00ff66 !important;min-height:1400px !important}\n');
  const b = await verifyHandoff(bad, { minScore: 60 });
  assert.ok(b.overall < g.overall - 25, `wrecked ${b.overall} vs good ${g.overall}`);
  assert.equal(b.passed, false);
});

test('verify: a starter that makes network requests cannot reach the network; the CLI exits 2 under --min-score and 1 on a missing folder', async (t) => {
  if (!haveBrowser || !fs.existsSync(demo)) return t.skip('no browser or demo');
  const d = copyDemo('net');
  fs.appendFileSync(path.join(d, 'starter', 'index.html'), '<img src="http://203.0.113.9/p.png"><script>fetch("http://203.0.113.9/x")</script>');
  const r = await verifyHandoff(d, {}); assert.ok(r.overall > 0); // would hang on the connect timeout if not blocked
  const bin = path.join(root, 'bin', 'site-explorer.mjs');
  const fail = spawnSync(process.execPath, [bin, 'verify', d, '--min-score', '100'], { encoding: 'utf8' });
  assert.equal(fail.status, 2, fail.stderr);
  const none = spawnSync(process.execPath, [bin, 'verify', path.join(tmp, 'nope')], { encoding: 'utf8' });
  assert.equal(none.status, 1);
});
