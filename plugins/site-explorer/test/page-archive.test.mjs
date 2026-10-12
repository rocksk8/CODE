// Page archive: one offline HTML per page; CSS and images embedded, scripts and handlers removed, still looks like the page with the server gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('--archive writes archive.html that has no scripts, embeds CSS and images, and renders after the server is gone', async (t) => {
  let b0; try { b0 = await launchBrowser(); await b0.close(); } catch { return t.skip('no browser'); }
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Archive test page</title><meta name="description" content="A page used to test the offline archive export of site-explorer."><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/s.css"><script>window.x=1</script></head><body onload="alert(1)"><h1 id="t">Archive headline</h1><img src="/p.png" width="40" height="40" alt="pixel"><a href="javascript:alert(1)">bad</a><a href="/next">next</a><iframe src="/frame"></iframe><p>${'Some real content words to make the page non-empty. '.repeat(6)}</p></body></html>`;
  const srv = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    if (q.url === '/s.css') { r.setHeader('content-type', 'text/css'); return r.end('h1{color:rgb(200,10,20);font-size:41px}body{background:url(/p.png) #fafafa}'); }
    if (q.url === '/p.png') { r.setHeader('content-type', 'image/png'); return r.end(PNG); }
    r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(page);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-arc-')); const out = path.join(dir, 'o');
  try {
    const none = await run([url, '--out', path.join(dir, 'n')]); assert.equal(none.status, 0, none.out);
    assert.ok(!fs.existsSync(path.join(dir, 'n', 'site')) || !fs.readdirSync(path.join(dir, 'n', 'site')).some((h) => fs.existsSync(path.join(dir, 'n', 'site', h, 'pages', 'home', 'archive.html'))), 'off by default');
    const r = await run([url, '--archive', '--out', out]); assert.equal(r.status, 0, r.out);
    const site = fs.readdirSync(path.join(out, 'site'))[0]; const f = path.join(out, 'site', site, 'pages', 'home', 'archive.html');
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(!/<script|<iframe|onload=|javascript:/i.test(html.replace(/<!--.*?-->/s, '')), 'nothing active is left');
    assert.match(html, /Content-Security-Policy/); assert.match(html, /data:image\/png;base64/); assert.match(html, /rgb\(200, 10, 20\)|rgb\(200,10,20\)/); assert.ok(!/href="\/s\.css"/.test(html));
    const pj = JSON.parse(fs.readFileSync(path.join(out, 'site', site, 'pages', 'home', 'page.json'), 'utf8')); assert.ok(pj.archive.embedded >= 2, JSON.stringify(pj.archive));
    srv.close(); srv.closeAllConnections?.();
    const b = await launchBrowser(); const pg = await b.newPage();
    try { await pg.goto('file://' + f); const fs1 = await pg.evaluate(() => getComputedStyle(document.getElementById('t')).fontSize + '|' + getComputedStyle(document.getElementById('t')).color + '|' + document.querySelector('img').naturalWidth); assert.equal(fs1, '41px|rgb(200, 10, 20)|1'); } finally { await b.close(); }
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('archive: CSS text containing </style> and javascript: tricks cannot become active content', async (t) => {
  let b0; try { b0 = await launchBrowser(); await b0.close(); } catch { return t.skip('no browser'); }
  const srv = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    if (q.url === '/h.css') { r.setHeader('content-type', 'text/css'); return r.end(`.q::after{content:"</style><meta http-equiv=refresh content='0;url=https://evil.example/'><img src=x onerror=alert(9)><style>"}`); }
    r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hostile css page</title><meta name="description" content="A page used to test that archives stay inert."><link rel="stylesheet" href="/h.css"></head><body><h1 class="q">Hello</h1><a href="java&#10;script:alert(1)">x</a><form action="https://evil.example/post"><input name="a"></form><p>${'Plain words to make the page real. '.repeat(8)}</p></body></html>`);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-arc2-'));
  try {
    const r = await run([url, '--archive', '--out', path.join(dir, 'o')]); assert.equal(r.status, 0, r.out);
    const site = fs.readdirSync(path.join(dir, 'o', 'site'))[0]; const html = fs.readFileSync(path.join(dir, 'o', 'site', site, 'pages', 'home', 'archive.html'), 'utf8');
    const b = await launchBrowser(); const pg = await b.newPage();
    try {
      await pg.setContent(html);
      const live = await pg.evaluate(() => ({ metas: document.querySelectorAll('meta[http-equiv]:not([http-equiv="Content-Security-Policy"])').length, imgs: document.querySelectorAll('img[onerror]').length, js: [...document.querySelectorAll('[href]')].filter((e) => /script/i.test(e.getAttribute('href').replace(/\s/g, ''))).length, action: document.querySelector('form').hasAttribute('action') }));
      assert.deepEqual(live, { metas: 0, imgs: 0, js: 0, action: false });
    } finally { await b.close(); }
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
