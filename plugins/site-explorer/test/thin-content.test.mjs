// A 200 response whose copy is painted by JavaScript seconds after `load` (and into <div>s, not <p>s) must still be captured;
// a page that really is empty must be flagged instead of passing silently.
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
const LATE = `<!doctype html><title>Late</title><body><div id="root"></div><script>
setTimeout(() => { document.getElementById('root').innerHTML = '<h1>Energy for a low-carbon future</h1>' + Array.from({ length: 8 }, (_, i) => '<div class="blk">Section ' + i + ' describes our nuclear fuel cycle activities in detail for visitors number ' + i + '</div>').join(''); }, 3500);
</script></body>`;
const EMPTY = '<!doctype html><title>Empty</title><body><div id="root"></div></body>';
let server, port, tmp, haveBrowser = true;
const run = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', 'crawl.mjs'), ...args], { env: process.env });
  let out = ''; const kill = setTimeout(() => p.kill(), 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (status) => { clearTimeout(kill); resolve({ status, out }); });
});
before(async () => {
  try { (await launchBrowser()).close(); } catch { haveBrowser = false; }
  if (!haveBrowser) return;
  server = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(q.url.startsWith('/empty') ? EMPTY : LATE); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res)); port = server.address().port;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-thin-'));
});
after(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
const crawl = async (p) => {
  const r = await run([`http://127.0.0.1:${port}${p}`, '--max-pages', '1', '--no-screenshots', '--out', path.join(tmp, p.replace(/\W/g, '') || 'home')]); assert.equal(r.status, 0, r.out);
  const d = path.join(tmp, p.replace(/\W/g, '') || 'home', `127.0.0.1_${port}`);
  return { site: JSON.parse(fs.readFileSync(path.join(d, 'site.json'), 'utf8')), page: JSON.parse(fs.readFileSync(path.join(d, 'pages', fs.readdirSync(path.join(d, 'pages'))[0], 'page.json'), 'utf8')), report: fs.readFileSync(path.join(d, 'report.md'), 'utf8') };
};

test('JS-rendered copy that appears after load is captured (headings and non-<p> text)', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const { page, site } = await crawl('/late');
  assert.equal(page.content.headings[0]?.text, 'Energy for a low-carbon future');
  assert.ok(page.content.paragraphs.length >= 8, 'text living in <div>s is kept: ' + page.content.paragraphs.length);
  assert.equal(site.thinPages.length, 0);
});
test('a 200 page with no visible text is flagged as thin in site.json and report.md', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const { site, page, report } = await crawl('/empty');
  assert.equal(site.thinPages.length, 1); assert.ok(page.thin);
  assert.match(report, /幾乎沒有抓到文字內容/);
});
