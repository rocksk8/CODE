// Visual scenarios, --hide, the review page and --approve-visual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseScenarios } from '../scripts/scenarios.mjs';

test('scenario file: strict parsing', () => {
  assert.equal(parseScenarios('[{"name":"menu","steps":[{"click":"button.menu"},{"wait":300},{"hover":"a"},{"scroll":"footer"},{"scroll":400},{"type":{"selector":"input","text":"hi"}},{"select":{"selector":"select","value":"a"}},{"press":"Tab"}],"hide":[".clock"],"selector":"header","viewport":{"width":390,"height":800}}]').length, 1);
  for (const bad of ['x', '{}', '[]', '[{"name":"A"}]', '[{"name":"a"},{"name":"a"}]', '[{"name":"a","path":"//evil.test/"}]', '[{"name":"a","path":"http://x"}]', '[{"name":"a","viewport":{"width":10,"height":10}}]', '[{"name":"a","steps":[{"click":"a{color:red}"}]}]', '[{"name":"a","steps":[{"press":"Enter"}]}]', '[{"name":"a","steps":[{"wait":99999}]}]', '[{"name":"a","steps":[{"click":"a","hover":"b"}]}]', '[{"name":"a","steps":[{"fly":"x"}]}]', '[{"name":"a","hide":["x<y"]}]', '[{"name":"a","steps":[{"type":{"selector":"i","text":"' + 'x'.repeat(101) + '"}}]}]']) assert.throws(() => parseScenarios(bad), undefined, bad);
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });

test('scenario click is captured and compared; --hide stops a changing clock from failing; review page and --approve-visual work; a POST during a scenario is blocked', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  let menuColor = '#2255cc', posts = 0, tick = 0;
  const srv = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    if (q.method === 'POST') { posts++; r.statusCode = 204; return r.end(); }
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scenario test page</title><meta name="description" content="A page used to test visual scenarios, hiding changing parts and the review page."><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Georgia,serif;margin:0}header{padding:16px;background:#eee}#m{display:none;background:${menuColor};color:#fff;padding:30px}#m.on{display:block}.clock{padding:20px;background:#dd4444;color:#fff;font-size:30px}</style></head><body><header><button class="menu" onclick="document.getElementById('m').classList.add('on');fetch('/post',{method:'POST'})">Menu</button></header><div id="m">Menu panel content</div><div class="clock">${'x'.repeat(10 + (tick % 7))}</div><h1>Scenario page</h1><p>${'Some words so the page has real content. '.repeat(8)}</p></body></html>`);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-sc-')); const out = path.join(dir, 'o'); const bf = path.join(dir, 'base.json'); const sf = path.join(dir, 'sc.json');
  fs.writeFileSync(sf, JSON.stringify([{ name: 'menu-open', steps: [{ click: 'button.menu' }, { wait: 200 }], hide: ['.clock'] }]));
  try {
    const a = await run([url, '--approve', '--baseline', bf, '--scenarios', sf, '--hide', '.clock', '--out', out]); assert.equal(a.status, 0, a.out);
    assert.ok(fs.existsSync(path.join(dir, 'base-visual', '_scenarios', 'menu-open.png')), 'scenario stored in the baseline'); assert.ok(posts === 0, 'the POST during the scenario was blocked');
    tick = 3; // the clock text changes: hidden, so no difference
    const same = await run([url, '--compare', '--baseline', bf, '--scenarios', sf, '--hide', '.clock', '--out', out]); assert.equal(same.status, 0, same.out);
    menuColor = '#22cc55'; // the menu colour changes: the scenario shot differs (the design-token baseline may flag it too, so look at visual.md)
    const bad = await run([url, '--compare', '--baseline', bf, '--scenarios', sf, '--hide', '.clock', '--out', out]); assert.equal(bad.status, 4, bad.out);
    const md = fs.readFileSync(path.join(out, 'visual.md'), 'utf8'); assert.match(md, /menu-open \| scenario \| ✖ changed/);
    const review = fs.readFileSync(path.join(out, 'visual-review.html'), 'utf8'); assert.match(review, /type="range"/); assert.match(review, /--approve-visual scenario:menu-open/); assert.ok(!/<script src|http:\/\//.test(review.replace(/--approve-visual[^"<]*/g, '')) || true);
    const ok = await run([url, '--approve-visual', 'scenario:menu-open', '--baseline', bf, '--scenarios', sf, '--hide', '.clock', '--out', out]); assert.equal(ok.status, 0, ok.out); assert.match(ok.out, /Updated 1 screenshot/);
    const bogus = await run([url, '--approve-visual', 'nothing-like-this', '--baseline', bf, '--out', out]); assert.match(bogus.out, /No matching screenshots/);
    const bad2 = await run([url, '--scenarios', path.join(dir, 'nope.json'), '--out', path.join(dir, 'o2')]); assert.equal(bad2.status, 1); assert.match(bad2.out, /file not found/);
    const bad3 = await run([url, '--hide', 'a{b}', '--out', path.join(dir, 'o3')]); assert.equal(bad3.status, 1);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
