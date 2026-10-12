// Other ways to explore logged-in pages: cookie file, custom headers, HTTP basic auth — parsed strictly, sent only to the start origin, never written to outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCookieFile, parseHeaders, parseBasicAuth, writeTempStorageState } from '../scripts/auth-state.mjs';

test('cookie files: storage-state JSON, array, Netscape cookies.txt and a one-line header all parse; junk is rejected', () => {
  const host = 'shop.test';
  assert.deepEqual(parseCookieFile('sid=abc; theme=dark', host).map((c) => [c.name, c.value, c.domain]), [['sid', 'abc', host], ['theme', 'dark', host]]);
  assert.equal(parseCookieFile('[{"name":"a","value":"1","domain":".x.test","path":"/p"}]', host)[0].domain, 'x.test');
  assert.equal(parseCookieFile('{"cookies":[{"name":"a","value":"1"}],"origins":[]}', host)[0].name, 'a');
  const net = '# Netscape HTTP Cookie File\n.shop.test\tTRUE\t/\tTRUE\t1893456000\tsid\tzzz\n#HttpOnly_.shop.test\tTRUE\t/\tFALSE\t0\tauth\tqqq\n';
  const c = parseCookieFile(net, host); assert.deepEqual(c.map((x) => [x.name, x.value, x.secure]), [['sid', 'zzz', true], ['auth', 'qqq', false]]);
  for (const bad of ['', '[]', '{"x":1}', 'not json {', '[{"name":"bad name","value":"x"}]', '[{"name":"a","value":"x\\ny"}]']) assert.throws(() => parseCookieFile(bad, host), undefined, bad);
});

test('headers and basic auth: validation; the temporary session file is private', () => {
  assert.deepEqual(parseHeaders(['Authorization: Bearer abc', ['X-Api-Key', 'k']]), { Authorization: 'Bearer abc', 'X-Api-Key': 'k' });
  for (const bad of [['Host: evil'], ['Cookie: a=b'], ['Content-Length: 1'], ['bad name: x'], ['X: '], ['X: a\r\nInjected: 1'], ['X: ' + 'a'.repeat(2001)]]) assert.throws(() => parseHeaders(bad), undefined, bad.join());
  assert.throws(() => parseHeaders(Array.from({ length: 21 }, (_, i) => `X-${i}: v`)));
  assert.deepEqual(parseBasicAuth('user:p:ss\nsecond line ignored'), { username: 'user', password: 'p:ss' }); assert.throws(() => parseBasicAuth('nocolon')); assert.throws(() => parseBasicAuth(':x'));
  const t = writeTempStorageState([{ name: 'a', value: 'b', domain: 'x', path: '/' }]);
  try { if (process.platform !== 'win32') assert.equal(fs.statSync(t.file).mode & 0o077, 0); assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).cookies[0].name, 'a'); } finally { t.cleanup(); } assert.ok(!fs.existsSync(t.file));
});

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args, env = {}) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env, ...env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('explore with a cookie file + header file + basic auth reaches a protected page; third parties never see them; no secret lands in any output; the temp session is removed', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const seen = [];
  const third = http.createServer((q, r) => { seen.push({ h: q.headers, url: q.url }); r.setHeader('content-type', 'text/css'); r.setHeader('access-control-allow-origin', '*'); r.end('p{margin:0}'); });
  await new Promise((r) => third.listen(0, '127.0.0.1', r)); const tp = third.address().port;
  const mainSeen = [];
  const site = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    mainSeen.push(q.url);
    const basicOk = q.headers.authorization === 'Basic ' + Buffer.from('alice:S3CRETPW').toString('base64');
    if (!basicOk) { r.statusCode = 401; r.setHeader('www-authenticate', 'Basic realm="x"'); return r.end('no'); }
    if (!/sid=SECRETCOOKIE/.test(q.headers.cookie || '') || q.headers['x-token'] !== 'SECRETHDR') { r.statusCode = 403; return r.end('forbidden'); }
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Members only page</title><meta name="description" content="A protected page used to test credentials."><link rel="stylesheet" href="http://localhost:${tp}/t.css"></head><body><h1>Welcome back</h1><p>${'Private member content. '.repeat(10)}</p></body></html>`);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${site.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cred-')); const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('se-session-')).length;
  fs.writeFileSync(path.join(dir, 'c.txt'), 'sid=SECRETCOOKIE'); fs.writeFileSync(path.join(dir, 'h.json'), JSON.stringify({ 'X-Token': 'SECRETHDR' })); fs.writeFileSync(path.join(dir, 'b.txt'), 'alice:S3CRETPW\n');
  try {
    const none = await run([url, '--no-db', '--out', path.join(dir, 'none')]); const nonePage = path.join(dir, 'none', 'site');
    assert.ok(!fs.existsSync(nonePage) || !fs.readdirSync(nonePage).length || /401|403|blocked|forbidden/i.test(none.out + JSON.stringify(walk(path.join(dir, 'none')).length)), 'without credentials the page is not reachable');
    const r = await run([url, '--cookie-file', path.join(dir, 'c.txt'), '--header-file', path.join(dir, 'h.json'), '--basic-auth-file', path.join(dir, 'b.txt'), '--archive', '--out', path.join(dir, 'o')]); assert.equal(r.status, 0, r.out);
    const siteDir = path.join(dir, 'o', 'site', fs.readdirSync(path.join(dir, 'o', 'site'))[0]); const pj = JSON.parse(fs.readFileSync(path.join(siteDir, 'pages', 'home', 'page.json'), 'utf8')); assert.equal(pj.title, 'Members only page'); assert.equal(JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8')).authenticated, true);
    assert.ok(seen.length >= 1, 'the third-party stylesheet was requested'); for (const s of seen) { const all = JSON.stringify(s.h); assert.ok(!/SECRETHDR|SECRETCOOKIE|authorization|x-token|cookie/i.test(all), 'third party saw: ' + all); }
    for (const f of walk(path.join(dir, 'o'))) { if (/\.(png|jpg|gz|webm|db)$/i.test(f)) continue; const txt = fs.readFileSync(f, 'utf8'); assert.ok(!/SECRETCOOKIE|SECRETHDR|S3CRETPW|YWxpY2U6/.test(txt), 'a secret is in ' + f); }
    assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('se-session-')).length, before, 'the temporary session folder was removed');
    const both = await run([url, '--cookie-file', path.join(dir, 'c.txt'), '--storage-state', path.join(dir, 'c.txt'), '--out', path.join(dir, 'x')]); assert.equal(both.status, 1);
    const bad = await run([url, '--header-file', path.join(dir, 'nope.json'), '--out', path.join(dir, 'y')]); assert.equal(bad.status, 1); assert.match(bad.out, /Problem with the login settings/);
    const hdr = await run([url, '--header', 'Host: evil', '--out', path.join(dir, 'z')]); assert.equal(hdr.status, 1);
  } finally { site.close(); third.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
