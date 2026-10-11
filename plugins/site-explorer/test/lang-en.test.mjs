// --lang en: the whole product speaks English — console, reports, handoff, dashboard — with no Chinese left over and no untranslated string.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'site-explorer.mjs');
const CJK = /[　-〿一-鿿＀-￯]+/g;
let tmp, haveBrowser = true;
before(async () => { try { (await launchBrowser()).close(); } catch { haveBrowser = false; } tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-en-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const cjkIn = (text) => [...new Set((text.match(CJK) || []))];

test('--help, errors and usage texts are English with --lang en and Chinese by default', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, SITE_EXPLORER_LANG: '', ...env } });
  for (const args of [['--help', '--lang', 'en'], ['explore', '--help', '--lang', 'en'], ['nonsense', '--lang', 'en'], ['verify', '--lang=en'], ['framework', '--lang', 'en'], ['explore', '--lang', 'en'], ['login', '--lang', 'en']]) {
    const r = run(args); const out = r.stdout + r.stderr;
    assert.deepEqual(cjkIn(out), [], `${args.join(' ')} → ${cjkIn(out).join(' ')}`);
    assert.ok(out.length > 20, args.join(' '));
  }
  assert.match(run(['--help', '--lang', 'en']).stdout, /explore a website/); assert.match(run(['--help']).stdout, /探索網站/);
  assert.match(run(['nonsense', '--lang', 'en']).stderr, /Unknown command or URL: "nonsense"/);
  assert.match(run(['--help'], { SITE_EXPLORER_LANG: 'en' }).stdout, /explore a website/, 'the environment variable works too');
});

test('a full English run (accessibility, verify, React, two runs for the before/after) leaves no Chinese and no untranslated string', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const page = (n) => `<!doctype html><html lang="en"><head><title>Acme ${n}</title><meta name="description" content="Acme builds things for the web."><style>body{margin:0;font-family:Georgia}header{background:#111;color:#fff;padding:20px}.hero{padding:80px 20px;background:#eef}.btn{background:#e4572e;color:#fff;border:0;border-radius:8px;padding:12px 24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px}.card{border-radius:8px;box-shadow:0 2px 6px #0003;padding:16px}</style></head><body><header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header><section class="hero"><h1>We build for the web</h1><p>Plenty of text here so that this block counts as real content for the checks.</p><button class="btn">Get started</button></section><div class="grid"><div class="card">A</div><div class="card">B</div><div class="card">C</div></div><footer style="padding:30px">Footer text</footer></body></html>`;
  const server = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(page(q.url)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`, out = path.join(tmp, 'o'), trace = path.join(tmp, 'untranslated.txt');
  const env = { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 'h.db'), SITE_EXPLORER_I18N_TRACE: trace };
  const run = () => new Promise((resolve) => { const p = spawn(process.execPath, [bin, url, '--lang', 'en', '--no-open', '--no-motion', '--max-pages', '2', '--a11y', '--verify', '--framework', 'react', '--out', out], { env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (s) => resolve({ s, o })); });
  try {
    const first = await run(); assert.equal(first.s, 0, first.o); const second = await run(); assert.equal(second.s, 0, second.o);
    for (const r of [first, second]) assert.deepEqual(cjkIn(r.o), [], 'console: ' + cjkIn(r.o).join(' '));
    assert.match(first.o, /Health: \d+\/100/); assert.match(first.o, /Rebuild verification|Verify the rebuild/);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    const files = walk(out).filter((f) => /\.(md|json|csv|txt|jsx|js|css|svg)$/.test(f));
    assert.ok(files.length > 30);
    const bad = files.map((f) => [path.relative(out, f), cjkIn(fs.readFileSync(f, 'utf8'))]).filter(([, c]) => c.length);
    assert.deepEqual(bad, [], 'Chinese left in: ' + JSON.stringify(bad).slice(0, 600));
    let sqlite = true; try { await import('node:sqlite'); } catch { sqlite = false; } // the history database (and so changes.md) needs Node >= 22.13
    if (sqlite) assert.ok(files.some((f) => /changes\.md$/.test(f)), 'the second run wrote the before/after report');
    else assert.match(first.o, /Node < 22\.13|database skipped/, 'Node 20 says (in English) that the database was skipped');
    const spec = fs.readFileSync(path.join(out, 'handoff', 'SPEC.md'), 'utf8'); assert.match(spec, /^# .* — design and development spec/m); assert.match(spec, /## 5\. Page specs/);
    const health = fs.readFileSync(path.join(out, 'site', fs.readdirSync(path.join(out, 'site'))[0], 'health.md'), 'utf8'); assert.match(health, /## Verdict:/); assert.match(health, /Accessibility \(axe-core\)/);
    const dash = fs.readFileSync(path.join(out, 'dashboard.html'), 'utf8'); assert.match(dash, /<html lang="en">/); assert.match(dash, /<title>Site Explorer report<\/title>/);
    // what a person sees in the dashboard, tab by tab
    const b = await launchBrowser(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); await pg.goto('file://' + path.join(out, 'dashboard.html')); await pg.evaluate(() => document.querySelector('#dtsw')?.click());
      const tabs = await pg.locator('#tabs button').evaluateAll((x) => x.map((e) => e.dataset.k)); assert.ok(tabs.includes('export') && tabs.includes('health') && tabs.includes('data'));
      const seen = new Set();
      for (const k of ['__initial', ...tabs]) { if (k !== '__initial') await pg.locator(`#tabs button[data-k="${k}"]`).click(); const text = await pg.evaluate(() => document.body.innerText + [...document.querySelectorAll('[title],[alt]')].map((e) => e.title + e.alt).join(' ')); for (const c of cjkIn(text)) seen.add(`${k}:${c}`); }
      assert.deepEqual([...seen], [], 'Chinese visible in the dashboard'); assert.deepEqual(errs, []);
    } finally { await b.close(); }
    const missed = fs.existsSync(trace) ? [...new Set(fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))] : [];
    assert.deepEqual(missed, [], 'strings without an English translation:\n' + missed.slice(0, 20).join('\n'));
  } finally { server.close(); }
});

test('Chinese output is unchanged by the language plumbing (a Chinese run has no English-only text from the dictionary)', () => {
  const r = spawnSync(process.execPath, [bin, 'explore', '--help'], { encoding: 'utf8', env: { ...process.env, SITE_EXPLORER_LANG: '' } });
  assert.match(r.stdout, /用法：site-explorer explore/); assert.doesNotMatch(r.stdout, /Usage: site-explorer explore/);
});
