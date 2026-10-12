// Performance budgets (explore --budget) and the run-to-run history (perf-history.json / performance.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBudget, collectPerf, medians, evaluateBudget, appendHistory, renderPerfMd } from '../scripts/perf-budget.mjs';

const pg = (url, perf, extra = {}) => ({ url, status: 200, seo: { http: { ttfbMs: perf.ttfbMs }, perf }, ...extra });

test('parseBudget: numbers or {max, level}; unknown metrics and bad values are errors, never silently ignored', () => {
  const b = parseBudget('{"totalKB":1500,"lcpMs":{"max":2500,"level":"warn"}}');
  assert.deepEqual(b, { totalKB: { max: 1500, level: 'fail' }, lcpMs: { max: 2500, level: 'warn' } });
  for (const bad of ['nope', '[]', '{"lcp":1}', '{"totalKB":-1}', '{"totalKB":"big"}', '{"cls":{"max":1,"level":"maybe"}}', '{"__proto__":1}']) assert.throws(() => parseBudget(bad), undefined, bad);
});

test('evaluate: per page and metric, fail vs warn, pages without a measurement are not violations; error pages are not measured', () => {
  const rows = collectPerf([pg('https://x.test/a', { totalBytes: 3_000_000, lcpMs: 3000, requests: 40, cls: 0.02 }), pg('https://x.test/b', { totalBytes: 500_000, lcpMs: 1200, requests: 10 }), { ...pg('https://x.test/c', { totalBytes: 9e9 }), status: 500 }]);
  assert.equal(rows.length, 2); assert.equal(rows[0].metrics.totalKB, 2930);
  const r = evaluateBudget(rows, parseBudget('{"totalKB":2000,"lcpMs":{"max":2500,"level":"warn"},"cls":0.1}'));
  assert.equal(r.failed, true); assert.deepEqual(r.violations.map((v) => `${v.metric}:${new URL(v.url).pathname}:${v.level}`).sort(), ['lcpMs:/a:warn', 'totalKB:/a:fail']);
  assert.equal(evaluateBudget(rows, parseBudget('{"lcpMs":{"max":2500,"level":"warn"}}')).failed, false, 'warnings never fail');
  assert.equal(medians(rows).requests, 40 === medians(rows).requests ? 40 : medians(rows).requests);
});

test('history: newest last, capped, garbage entries dropped; the report shows the change against the previous run', () => {
  let h = []; for (let i = 0; i < 70; i++) h = appendHistory(h, { at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, url: 'u', pages: 1, medians: { lcpMs: 1000 + i, totalKB: 500, requests: 20, ttfbMs: 50 } });
  assert.equal(h.length, 60); assert.equal(h.at(-1).medians.lcpMs, 1069);
  assert.deepEqual(appendHistory([null, 5, { x: 1 }], { at: 'now', medians: {} }).length, 1);
  const md = renderPerfMd({ rows: collectPerf([pg('https://x.test/', { lcpMs: 1500, totalBytes: 1024 * 600, requests: 30 })]), budget: null, result: { violations: [] }, history: h });
  assert.match(md, /LCP/); assert.match(md, /\+1500|1500 ms/); assert.ok(!/<script|<img/i.test(md));
});

// ---- end to end: a heavy page against a budget (exit 4), then a light one (exit 0), history grows
const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });

test('explore --budget: exit 4 when a fail-level budget is exceeded, 0 otherwise; history accumulates; a bad budget file stops before crawling', async (t) => {
  let haveBrowser = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); const b = await launchBrowser(); await b.close(); } catch { haveBrowser = false; }
  if (!haveBrowser) return t.skip('no browser');
  let heavy = true; const big = Buffer.alloc(400_000, 7);
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } if (q.url === '/big.bin') { r.setHeader('content-type', 'application/octet-stream'); return r.end(big); }
    r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Budget test page title here</title><meta name="description" content="A page used to test performance budgets against a measured page."><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Budget</h1><p>${'Some words to read on the page. '.repeat(10)}</p>${heavy ? '<script>fetch("/big.bin").then(r=>r.arrayBuffer())</script><img src="/big.bin" alt="">' : ''}</body></html>`); });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-perf-')); const out = path.join(dir, 'o'); const bf = path.join(dir, 'budget.json'); fs.writeFileSync(bf, '{"totalKB":200}');
  try {
    const a = await run([url, '--budget', bf, '--out', out]); assert.equal(a.status, 4, a.out); assert.match(a.out, /over budget|exceed|budget/i);
    const hist = JSON.parse(fs.readFileSync(path.join(out, 'perf-history.json'), 'utf8')); assert.equal(hist.length, 1);
    const pj = JSON.parse(fs.readFileSync(path.join(out, 'site', fs.readdirSync(path.join(out, 'site'))[0], 'performance.json'), 'utf8')); assert.equal(pj.result.failed, true);
    heavy = false;
    const b = await run([url, '--budget', bf, '--out', out]); assert.equal(b.status, 0, b.out);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'perf-history.json'), 'utf8')).length, 2);
    const noBudget = await run([url, '--out', out]); assert.equal(noBudget.status, 0, noBudget.out);
    fs.writeFileSync(bf, '{"lcp":5}'); const bad = await run([url, '--budget', bf, '--out', path.join(dir, 'o2')]); assert.equal(bad.status, 1); assert.match(bad.out, /Budget file/i); assert.ok(!fs.existsSync(path.join(dir, 'o2', 'site')), 'no crawl for a bad budget');
  } finally { srv.close(); }
});

test('a budget on a metric that was never measured is reported, and a fail-level one fails', () => {
  const rows = [{ url: 'https://x.test/', metrics: { ttfbMs: 100, lcpMs: null } }];
  const warn = evaluateBudget(rows, { lcpMs: { max: 2500, level: 'warn' } }); assert.equal(warn.failed, false); assert.deepEqual(warn.unmeasured, [{ metric: 'lcpMs', level: 'warn', pages: 1 }]);
  const fail = evaluateBudget(rows, { lcpMs: { max: 2500, level: 'fail' }, ttfbMs: { max: 800, level: 'fail' } }); assert.equal(fail.failed, true);
  assert.deepEqual(evaluateBudget(rows, { ttfbMs: { max: 800, level: 'fail' } }).unmeasured, []);
});

test('total blocking time is measured, --perf-runs takes the median of repeated cold loads, --throttle mobile slows the load, bad values are rejected', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blocking time test page</title><meta name="description" content="A page whose script blocks the main thread so that total blocking time can be measured."></head><body><h1>Busy page</h1><p>${'Words to make the page real content. '.repeat(10)}</p><script>function busy(){setTimeout(function(){var t=Date.now();while(Date.now()-t<400){}},60)}if(performance.getEntriesByName('first-contentful-paint').length)busy();else new PerformanceObserver(function(l,o){o.disconnect();busy()}).observe({type:'paint',buffered:true})</script></body></html>`); });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-tbt-'));
  try {
    const a = await run([url, '--perf-runs', '2', '--out', path.join(dir, 'a')]); assert.equal(a.status, 0, a.out);
    const site = (o) => path.join(dir, o, 'site', fs.readdirSync(path.join(dir, o, 'site'))[0]);
    const pa = JSON.parse(fs.readFileSync(path.join(site('a'), 'pages', 'home', 'page.json'), 'utf8')); assert.equal(pa.seo.perfRuns, 2); assert.ok(pa.seo.perf.tbtMs > 100, 'tbt ' + pa.seo.perf.tbtMs);
    const b = await run([url, '--throttle', 'mobile', '--out', path.join(dir, 'b')]); assert.equal(b.status, 0, b.out);
    const pb = JSON.parse(fs.readFileSync(path.join(site('b'), 'pages', 'home', 'page.json'), 'utf8')); assert.equal(pb.seo.perfThrottled, true); assert.ok(pb.seo.perf.loadMs >= pa.seo.perf.loadMs + 80, `throttled load ${pb.seo.perf.loadMs} vs ${pa.seo.perf.loadMs}`);
    for (const bad of [['--perf-runs', '0'], ['--perf-runs', 'x'], ['--throttle', 'slow']]) { const r = await run([url, ...bad, '--out', path.join(dir, 'c')]); assert.equal(r.status, 1, bad.join(' ')); }
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
});
