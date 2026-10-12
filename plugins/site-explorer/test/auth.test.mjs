// Logged-in exploration: the session file is validated and never leaked into outputs, destructive links are never followed,
// and logged-in content is kept out of the shared history database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/launch.mjs';
import { loadAuthState, skipLink } from '../scripts/auth-state.mjs';
import { writeSecret } from '../scripts/login.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'site-explorer.mjs');
const SECRET = 'S3CR3T-SESSION-VALUE-9f8e7d';
let tmp, haveBrowser = true;
before(async () => { try { (await launchBrowser()).close(); } catch { haveBrowser = false; } tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-auth-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
const write = (name, obj, mode = 0o600) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj), { mode }); fs.chmodSync(f, mode); return f; };

test('loadAuthState: clear errors for missing, broken and foreign files; warns about loose permissions and expired sessions', () => {
  assert.throws(() => loadAuthState(path.join(tmp, 'nope.json')), /找不到登入狀態檔/);
  assert.throws(() => loadAuthState(write('bad.json', '{not json')), /不是有效的 JSON/);
  assert.throws(() => loadAuthState(write('other.json', { hello: 1 })), /缺少 cookies/);
  assert.throws(() => loadAuthState(tmp), /不是一般檔案/);
  const ok = loadAuthState(write('ok.json', { cookies: [{ name: 'sid', value: SECRET, domain: '127.0.0.1', path: '/', expires: -1 }], origins: [] }));
  assert.deepEqual(ok.warnings, []); assert.ok(ok.cookieKeys.has('sid|127.0.0.1'));
  if (process.platform !== 'win32') assert.match(loadAuthState(write('open.json', { cookies: [] }, 0o644)).warnings.join(), /chmod 600/); // Windows has no POSIX permission bits
  assert.match(loadAuthState(write('old.json', { cookies: [{ name: 'a', value: 'b', domain: 'x.test', path: '/', expires: 1000 }] })).warnings.join(), /過期/);
  assert.ok(!JSON.stringify(ok).includes(SECRET), 'the loaded handle never carries cookie values');
});

test('skipLink: logout/delete-style links are never followed; logged-in mode keeps /account and /admin; anonymous mode keeps its old rules', () => {
  for (const u of ['https://x.test/logout', 'https://x.test/sign-out', 'https://x.test/account/delete', 'https://x.test/cart/remove/3', 'https://x.test/unsubscribe', 'https://x.test/settings/close-account', 'https://x.test/?action=logout', 'https://x.test/a.pdf'])
    assert.equal(skipLink(u, { authed: true }), true, u);
  for (const u of ['https://x.test/account', 'https://x.test/dashboard', 'https://x.test/admin/users', 'https://x.test/orders/42']) assert.equal(skipLink(u, { authed: true }), false, u);
  assert.equal(skipLink('https://x.test/admin', { authed: false }), true); assert.equal(skipLink('https://x.test/account', { authed: false }), false); assert.equal(skipLink('not a url', { authed: true }), true);
});

test('writeSecret: owner-only permissions, even over an existing world-readable file', { skip: process.platform === 'win32' }, () => {
  const f = path.join(tmp, 'sub', 'state.json'); writeSecret(f, '{}'); assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  fs.chmodSync(f, 0o644); writeSecret(f, '{"a":1}'); assert.equal(fs.statSync(f).mode & 0o777, 0o600); assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
});

test('explore --storage-state: crawls pages behind the login, never touches logout/delete, keeps the secret and the content out of history and outputs', async (t) => {
  if (!haveBrowser) return t.skip('no browser');
  const hits = []; const authed = (q) => (q.headers.cookie || '').includes('sid=' + SECRET);
  const server = http.createServer((q, r) => {
    hits.push(q.url); const h = { 'content-type': 'text/html' };
    if (q.url === '/robots.txt') { r.writeHead(404); return r.end(); }
    if (q.url === '/logout' || q.url.startsWith('/delete')) { r.writeHead(200, { ...h, 'set-cookie': 'sid=; Max-Age=0; Path=/' }); return r.end('<title>gone</title><p>destroyed</p>'); }
    if (!authed(q)) { r.writeHead(200, h); return r.end('<!doctype html><title>Welcome</title><h1>Please log in</h1><p>Public landing page with enough words to be counted as content here.</p><a href="/login">Log in</a>'); }
    if (q.url === '/account') { r.writeHead(200, h); return r.end('<!doctype html><title>Account</title><main><h1>Account</h1><p>MEMBER-ONLY account page: Alice Example, alice@example.com, enough words here to count as content.</p></main>'); }
    r.writeHead(200, h); r.end('<!doctype html><title>Home</title><h1>Hello Alice</h1><p>Member home with a paragraph long enough to be counted as real page content.</p><nav><a href="/account">Account</a> <a href="/logout">Log out</a> <a href="/delete-account">Delete account</a></nav>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`, state = write('session.json', { cookies: [{ name: 'sid', value: SECRET, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] });
  const run = (args, db) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, url, ...args, '--no-open', '--no-motion', '--max-pages', '5'], { env: { ...process.env, SITE_EXPLORER_DB: db } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (s) => resolve({ s, o })); });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  try {
    const anon = await run(['--out', path.join(tmp, 'anon')], path.join(tmp, 'anon.db')); assert.equal(anon.s, 0, anon.o);
    assert.ok(!walk(path.join(tmp, 'anon')).some((f) => /\.(md|json|html)$/.test(f) && fs.readFileSync(f, 'utf8').includes('MEMBER-ONLY')), 'without the session the member page is not reachable');
    hits.length = 0;
    const db = path.join(tmp, 'auth.db'), out = path.join(tmp, 'auth');
    const r = await run(['--out', out, '--storage-state', state], db); assert.equal(r.s, 0, r.o); assert.match(r.o, /以登入狀態探索/);
    assert.ok(hits.includes('/account'), 'a page behind the login was crawled'); assert.ok(!hits.some((h) => h === '/logout' || h.startsWith('/delete')), 'destructive links were never requested: ' + hits.join(' '));
    const site = JSON.parse(fs.readFileSync(path.join(out, 'site', '127.0.0.1_' + new URL(url).port, 'site.json'), 'utf8')); assert.equal(site.authenticated, true);
    assert.ok(site.pages.some((p) => /account/.test(p.url)));
    const texts = walk(out).filter((f) => /\.(md|json|html|csv|js|css|txt)$/.test(f)).map((f) => [f, fs.readFileSync(f, 'utf8')]);
    assert.deepEqual(texts.filter(([, c]) => c.includes(SECRET)).map(([f]) => f), [], 'the session value appears in no output file');
    assert.ok(texts.some(([f, c]) => /START-HERE/.test(f) && /Captured while logged in/.test(c)), 'handoff warns that it was captured while logged in');
    assert.ok(texts.some(([f, c]) => /dashboard\.html$/.test(f) && c.includes('登入狀態探索')), 'dashboard says so too');
    if (fs.existsSync(db)) { // the environment check may create an empty database file; what matters is that it holds no run of this site
      let sqlite = null; try { sqlite = await import('node:sqlite'); } catch {}
      if (sqlite) { const d = new sqlite.DatabaseSync(db); try { assert.equal(d.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0, 'logged-in content is not written to the history database'); } catch (e) { if (!/no such table/.test(e.message)) throw e; } finally { d.close(); } }
    }
    const j = await new Promise((resolve) => { const p = spawn(process.execPath, [bin, url, '--storage-state', path.join(tmp, 'missing.json'), '--no-open', '--out', path.join(tmp, 'miss')], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (s) => resolve({ s, o })); });
    assert.notEqual(j.s, 0); assert.match(j.o, /找不到登入狀態檔/);
  } finally { server.close(); }
});
