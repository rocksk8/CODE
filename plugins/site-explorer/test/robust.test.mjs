// Reverse-thinking regressions: things that break on real sites. Each case failed before it was fixed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`;
const handler = (robotsAll) => (req, res) => {
  const u = req.url.split('?')[0];
  const send = (code, html, type = 'text/html', h = {}) => { res.writeHead(code, { 'content-type': type, ...h }); res.end(html); };
  if (u === '/robots.txt') return robotsAll ? send(200, 'User-agent: *\nDisallow: /\n', 'text/plain') : send(404, '');
  if (u === '/hang') return;
  if (u === '/go') return send(302, '', 'text/html', { location: `http://localhost:${res.socket.localPort}/` });
  if (u === '/slow') return send(200, page('Slow', '<h1>Slow</h1><script>fetch("/hang")</script>'));
  if (u === '/inf') return send(200, page('Infinite', '<h1>Infinite</h1><div id=c></div><script>const c=document.getElementById("c");function add(){for(let i=0;i<20;i++){const d=document.createElement("p");d.style.height="300px";d.textContent="row";c.appendChild(d)}}add();addEventListener("scroll",()=>{if(innerHeight+scrollY>document.body.scrollHeight-1500)add()});</script>'));
  if (u === '/cookie') return send(200, page('Cookie', '<div id="cookie-banner" style="position:fixed;bottom:0;height:80px;width:100%;background:#ccc"><button onclick="document.title=\'ACCEPTED\'">Accept all</button><button onclick="document.title=\'REJECTED\';this.parentNode.remove()">Reject all</button></div><h1>Cookie</h1>'));
  if (u === '/modal') return send(200, page('Modal', '<h1>Modal</h1><div role="dialog" style="position:fixed;top:20%;left:20%;width:300px;height:150px;background:#eee"><button onclick="document.title=\'AGREED\'">I agree to the terms</button></div>'));
  if (u === '/xss') return send(200, page('</title><script>window.PWNED=1</script><img src=x onerror="window.PWNED=2">', '<h1 title="&quot;><img src=x onerror=window.PWNED=3>">XSS</h1><p>paragraph paragraph paragraph with text that is long enough</p><img src="x" alt="&quot; onerror=&quot;window.PWNED=5">'));
  return send(200, page('Home', '<h1>Home</h1><p>Home paragraph that is long enough to count.</p><a href="/slow">slow</a> <a href="/inf">inf</a> <a href="/xss">xss</a>'));
};

let open, closed, tmp, haveBrowser = true;
const port = (s) => s.address().port;
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  open = http.createServer(handler(false)); closed = http.createServer(handler(true));
  await Promise.all([open, closed].map((s) => new Promise((r) => s.listen(0, '0.0.0.0', r))));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se robust-')); // note the space: Mac paths have them
});
after(() => { open?.close(); closed?.close(); open?.closeAllConnections?.(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const run = (script, args) => new Promise((resolve) => {
  const t0 = Date.now(), p = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { env: { ...process.env, SITE_EXPLORER_DB: path.join(tmp, 't.db') } });
  let out = ''; const kill = setTimeout(() => p.kill(), 100000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (status) => { clearTimeout(kill); resolve({ status, out, secs: (Date.now() - t0) / 1000 }); });
});
const site = (name, host) => JSON.parse(fs.readFileSync(path.join(tmp, name, host, 'site.json'), 'utf8'));

test('invalid numeric option fails loudly instead of crawling 0 pages', async () => {
  const r = await run('crawl.mjs', ['http://localhost:1/', '--max-pages', 'abc']);
  assert.equal(r.status, 1); assert.match(r.out, /--max-pages 需要/);
});

test('URL without scheme works for localhost', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const r = await run('crawl.mjs', [`localhost:${port(open)}/`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'a')]);
  assert.equal(r.status, 0, r.out);
});

test('follows a redirect to another hostname and keeps crawling there', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const r = await run('crawl.mjs', [`http://127.0.0.1:${port(open)}/go`, '--max-pages', '3', '--no-screenshots', '--out', path.join(tmp, 'b')]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /redirected to/);
  assert.ok(site('b', `127.0.0.1_${port(open)}`).pages.length >= 2, 'crawled beyond the first page');
});

test('a page that never goes network-idle does not stall the crawl', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const r = await run('crawl.mjs', [`http://localhost:${port(open)}/slow`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'c')]);
  assert.equal(r.status, 0, r.out); assert.ok(r.secs < 25, `took ${r.secs}s`);
});

test('infinite scroll cannot hang the crawler', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const r = await run('crawl.mjs', [`http://localhost:${port(open)}/inf`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'd')]);
  assert.equal(r.status, 0, r.out); assert.ok(r.secs < 40, `took ${r.secs}s`);
});

test('robots.txt Disallow: / stops crawl and 3D capture with a clear message', async () => {
  const u = `http://localhost:${port(closed)}/`;
  const c = await run('crawl.mjs', [u, '--out', path.join(tmp, 'e')]);
  assert.equal(c.status, 3, c.out); assert.match(c.out, /robots\.txt 不允許/);
  const m = await run('capture-3d.mjs', [u, '--out', path.join(tmp, 'f')]);
  assert.equal(m.status, 3, m.out); assert.match(m.out, /robots\.txt 不允許/);
});

test('cookie banner: prefers Reject; unrelated dialogs are never clicked', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const h = `localhost_${port(open)}`;
  await run('crawl.mjs', [`http://localhost:${port(open)}/cookie`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'g')]);
  const g = site('g', h); assert.match(g.consentAction, /reject/i); assert.equal(g.pages[0].title, 'REJECTED');
  await run('crawl.mjs', [`http://localhost:${port(open)}/modal`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, 'm')]);
  const m = site('m', h); assert.equal(m.consentAction, null); assert.equal(m.pages[0].title, 'Modal');
});

test('hostile page content cannot inject script into the dashboard (path with spaces)', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const out = path.join(tmp, 'x ss'), h = `localhost_${port(open)}`;
  await run('crawl.mjs', [`http://localhost:${port(open)}/xss`, '--max-pages', '1', '--out', out]);
  const dash = path.join(out, 'dash board.html');
  const r = await run('build-report.mjs', ['--site', path.join(out, h), '--out', dash]);
  assert.equal(r.status, 0, r.out);
  const b = await launchBrowser(); const p = await b.newPage(); const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await p.goto('file://' + dash);
  for (const k of ['overview', 'design', 'layout', 'content', 'edit']) { const tab = p.locator(`#tabs button[data-k=${k}]`); if (await tab.count()) await tab.click(); }
  assert.equal(await p.evaluate(() => window.PWNED), undefined);
  assert.deepEqual(dialogs, []);
  assert.ok(await p.evaluate(() => [...document.images].filter((i) => i.src.includes('.png')).every((i) => i.complete && i.naturalWidth > 0)), 'screenshots resolve through a path with spaces');
  await b.close();
});

