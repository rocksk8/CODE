// Regressions found by the independent review rounds (each one was reproduced before it was fixed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-r2-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

test('design tokens: a white first paragraph (inside a dark hero) must not become the body text colour on a white page', () => {
  const dir = path.join(tmp, 'site'); fs.mkdirSync(dir);
  const ty = (c) => ({ color: c, fontSize: '16px', fontWeight: '400', lineHeight: '24px', letterSpacing: 'normal', fontFamily: 'Arial, sans-serif' });
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ startUrl: 'http://x.test/', crawledAt: '2026-01-01', pages: [], components: {}, design: {
    textColors: [{ value: 'rgb(255, 255, 255)', count: 90 }, { value: 'rgb(34, 34, 34)', count: 30 }], backgrounds: [{ value: 'rgb(255, 255, 255)', count: 20 }, { value: 'rgb(17, 17, 40)', count: 10 }],
    typography: { p: ty('rgb(255, 255, 255)'), h1: ty('rgb(255, 255, 255)') }, fontFamilies: [{ value: 'Arial, sans-serif', count: 5 }], fontSizes: [{ value: '16px', count: 5 }], spacing: [], radii: [], shadows: [], breakpoints: [] } }));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'export-design.mjs'), dir], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'design-bundle', 'tokens.json'), 'utf8'));
  assert.equal(tokens.color.background, '#ffffff'); assert.notEqual(tokens.color.text, '#ffffff', 'white text on a white page'); assert.equal(tokens.color.text, '#222222', 'the most used READABLE text colour wins');
  const css = fs.readFileSync(path.join(dir, 'design-bundle', 'tokens.css'), 'utf8'); assert.match(css, /--color-text: #222222/);
});

// ---- review round 2 (robustness audit) ----
test('robots: a pathological wildcard rule matches in linear time (no ReDoS)', async () => {
  const { parseRobots, isAllowed } = await import('../scripts/robots.mjs');
  const rule = '/' + '*a'.repeat(40) + '*b';
  const parsed = parseRobots(`User-agent: *\nDisallow: ${rule}\nDisallow: /private$\n`);
  const t0 = Date.now();
  assert.equal(isAllowed(parsed, 'x', '/' + 'a'.repeat(60)).allowed, true);
  assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0) + 'ms');
  assert.equal(isAllowed(parsed, 'x', '/' + 'a'.repeat(45) + 'b').allowed, false);
  assert.equal(isAllowed(parsed, 'x', '/private').allowed, false);
  assert.equal(isAllowed(parsed, 'x', '/private/x').allowed, true);
});

test('normalizeUrl: a password typed into the address is dropped', async () => {
  const { normalizeUrl } = await import('../scripts/args.mjs');
  const u = normalizeUrl('http://alice:S3cretPW@127.0.0.1:9100/x');
  assert.ok(u && !u.includes('S3cretPW') && !u.includes('alice'), u);
});

test('decodeBody: Big5 pages are decoded with their declared charset', async () => {
  const { decodeBody } = await import('../scripts/util.mjs');
  const big5 = Buffer.from('<meta charset=big5><title>', 'latin1');
  const body = Buffer.concat([big5, Buffer.from([0xa6, 0x6e, 0xa6, 0x6e]), Buffer.from('</title>')]); // 你好-ish in Big5
  assert.ok(!decodeBody(body).includes('�') && /[一-鿿]/.test(decodeBody(body)));
  assert.equal(decodeBody(Buffer.from('héllo'), 'text/html; charset=utf-8'), 'héllo');
});

test('explore: a misspelled flag is refused instead of silently ignored', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'site-explorer.mjs'), 'https://example.com', '--fial-on', 'high', '--lang', 'en'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown option: --fial-on/);
  assert.match(r.stderr, /--fail-on/);
});

test('safe-out: a lone runs.json does not make a foreign folder "ours"', async () => {
  const { checkExploreOut } = await import('../scripts/safe-out.mjs');
  const d = path.join(tmp, 'foreign'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'runs.json'), '[]'); fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
  assert.throws(() => checkExploreOut(d));
});

test('explore --json: early failures still leave one parseable JSON document on stdout', () => {
  const bin = path.join(root, 'bin', 'site-explorer.mjs');
  for (const extra of [['--max-pages', '0'], ['--fail-on', 'bogus'], ...(process.platform === 'win32' ? [] : [['--out', '/etc/hostname/y']])]) { // (a POSIX-only path: on Windows it is just a folder on the current drive)
    const r = spawnSync(process.execPath, [bin, 'https://example.com', '--json', ...extra, '--lang', 'en'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1, extra.join(' '));
    const j = JSON.parse(r.stdout); assert.equal(j.ok, false); assert.equal(j.exitCode, 1); assert.ok(j.error.length > 5);
  }
});
