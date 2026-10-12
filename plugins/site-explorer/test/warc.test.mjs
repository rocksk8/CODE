// WARC export: valid multi-member gzip WARC 1.1 with the responses the page loaded, no cookies or auth headers, size caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildWarc, readWarc } from '../scripts/warc.mjs';

test('buildWarc/readWarc round trip: warcinfo first, responses with status, headers filtered, body intact, hostile header text cannot add records', () => {
  const body = Buffer.from('hello 你好 <b>x</b>'); const evil = 'a\r\nWARC-Type: warcinfo';
  const buf = buildWarc([{ url: 'https://x.test/a?q=1', status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'sid=SECRET', authorization: 'Bearer T', 'x-note': evil, 'content-encoding': 'gzip' }, body, date: '2026-01-01T00:00:00.000Z' }, { url: 'https://x.test/missing', status: 404, headers: {}, body: Buffer.alloc(0), date: '2026-01-01T00:00:01.000Z' }], { startUrl: 'https://x.test/' });
  const recs = readWarc(buf); assert.equal(recs.length, 3); assert.equal(recs[0].type, 'warcinfo'); assert.deepEqual(recs.slice(1).map((r) => [r.type, r.status]), [['response', 200], ['response', 404]]);
  assert.equal(recs[1].uri, 'https://x.test/a?q=1'); assert.deepEqual(recs[1].body, body); assert.ok(!('set-cookie' in recs[1].headers) && !('authorization' in recs[1].headers) && !('content-encoding' in recs[1].headers));
  assert.equal(recs[1].headers['content-length'], String(body.length)); assert.ok(!/SECRET|Bearer/.test(buf.toString('latin1')) && !/SECRET/.test(require_unzip(buf)));
  assert.equal(recs.filter((r) => r.type === 'warcinfo').length, 1, 'a CRLF in a header value did not create a record');
});
import zlib from 'node:zlib';
function require_unzip(b) { return zlib.gunzipSync(b).toString('latin1'); }

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'site-explorer.mjs');
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, ...args, '--no-open', '--no-motion', '--no-handoff', '--no-db', '--no-link-check', '--max-pages', '1', '--lang', 'en'], { env: { ...process.env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, out: o })); });

test('explore --warc writes pages/<page>/archive.warc.gz with the document, its CSS and image; cookies set by the server are not in it', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const srv = http.createServer((q, r) => {
    if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); }
    if (q.url === '/s.css') { r.setHeader('content-type', 'text/css'); return r.end('h1{color:#c00}'); }
    if (q.url === '/p.png') { r.setHeader('content-type', 'image/png'); return r.end(PNG); }
    r.setHeader('set-cookie', 'session=TOPSECRET123; Path=/'); r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WARC test page</title><meta name="description" content="A page used to test the WARC export of site-explorer."><link rel="stylesheet" href="/s.css"></head><body><h1>WARC headline</h1><img src="/p.png" width="20" height="20" alt="p"><p>${'Content words. '.repeat(10)}</p></body></html>`);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-warc-'));
  try {
    const r = await run([url, '--warc', '--out', path.join(dir, 'o')]); assert.equal(r.status, 0, r.out);
    const site = path.join(dir, 'o', 'site', fs.readdirSync(path.join(dir, 'o', 'site'))[0], 'pages', 'home');
    const buf = fs.readFileSync(path.join(site, 'archive.warc.gz')); const recs = readWarc(buf).filter((x) => x.type === 'response');
    const uris = recs.map((x) => x.uri.replace(url, '/')); for (const u of ['/', '/s.css', '/p.png']) assert.ok(uris.includes(u), u + ' in ' + uris);
    assert.deepEqual(recs.find((x) => x.uri.endsWith('/p.png')).body, PNG); assert.ok(!zlib.gunzipSync(buf).toString('latin1').includes('TOPSECRET123'));
    const pj = JSON.parse(fs.readFileSync(path.join(site, 'page.json'), 'utf8')); assert.ok(pj.warc.records >= 3);
    const none = await run([url, '--out', path.join(dir, 'n')]); const s2 = path.join(dir, 'n', 'site', fs.readdirSync(path.join(dir, 'n', 'site'))[0], 'pages', 'home'); assert.ok(!fs.existsSync(path.join(s2, 'archive.warc.gz')), 'off by default');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
