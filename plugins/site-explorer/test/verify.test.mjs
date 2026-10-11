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

test('verify: a corrupt reference image or a hidden section is reported for that section only; inserting a section does not shift the matching', async (t) => {
  if (!haveBrowser || !fs.existsSync(demo)) return t.skip('no browser or demo');
  const d = copyDemo('edge');
  fs.writeFileSync(path.join(d, 'media', 'sections', 'home', '03-features.png'), 'not a png');
  const f = path.join(d, 'starter', 'index.html'); let html = fs.readFileSync(f, 'utf8');
  html = html.replace('<section class="sec sec--cta', '<section data-section="extra" hidden><p>x</p></section><section class="sec sec--cta'); // inserted before cta
  fs.writeFileSync(f, html);
  const r = await verifyHandoff(d, {});
  const by = Object.fromEntries(r.pages[0].sections.map((s) => [s.name, s]));
  assert.match(by.features.status, /PNG/);
  assert.equal(by.cta.status, 'ok'); assert.ok(by.cta.score >= 70, `cta still matched by name: ${by.cta.score}`);
});

test('explore --verify: a real run verifies its own starter and the dashboard shows the result with difference images', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const { spawn } = await import('node:child_process'); const http = await import('node:http');
  const html = '<!doctype html><title>V</title><style>body{margin:0;font-family:Arial}header{background:#111;color:#fff;padding:20px}section{padding:80px 20px}.h{background:#eef}</style><header><nav><a href="/">Home</a> <a href="/a">A</a></nav></header><section class="h"><h1>Big headline for the hero</h1><p>Some long paragraph text for this fixture hero block so it counts as content.</p><button>Go</button></section><section><h2>Features</h2><p>Plenty of words here to describe features of the fixture page properly.</p></section><footer style="background:#222;color:#ccc;padding:40px">Footer text here</footer>';
  const server = http.createServer((q, r) => { r.writeHead(q.url === '/robots.txt' ? 404 : 200, { 'content-type': 'text/html' }); r.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const out = path.join(tmp, 'xv');
  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(root, 'bin', 'site-explorer.mjs'), `http://127.0.0.1:${server.address().port}/`, '--max-pages', '1', '--no-motion', '--no-health', '--no-db', '--no-open', '--verify', '--out', out], { env: { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 'v.db') } });
      let o = ''; const k = setTimeout(() => p.kill(), 200000); p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (s) => { clearTimeout(k); resolve({ s, o }); });
    });
    assert.equal(r.s, 0, r.o);
    const v = JSON.parse(fs.readFileSync(path.join(out, 'handoff', 'verify', 'verify.json'), 'utf8'));
    assert.ok(v.overall > 0 && v.pages[0].sections.length >= 3, JSON.stringify(v.overall));
    const dash = fs.readFileSync(path.join(out, 'dashboard.html'), 'utf8');
    assert.ok(dash.includes('重建驗證') && dash.includes('"verify":{"overall"'), 'dashboard carries the verify result');
    const b = await launchBrowser(); const pg = await b.newPage();
    try {
      const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto('file://' + path.join(out, 'dashboard.html')); await pg.locator('[data-go="export"], button:has-text("匯出給 AI")').first().click();
      assert.ok(await pg.locator('#s-export').innerText().then((x) => /重建驗證/.test(x)));
      assert.ok(await pg.locator('#s-export img[alt$="差異圖"]').count() >= 3, 'difference images are shown');
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  } finally { server.close(); }
});
