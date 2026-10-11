import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, findUrl, sameSite, normalizeFlags } from '../scripts/args.mjs';

test('normalizeUrl is forgiving about scheme', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('  https://a.com/x '), 'https://a.com/x');
  assert.equal(normalizeUrl('localhost:8781/p'), 'http://localhost:8781/p', 'local servers default to http');
  assert.equal(normalizeUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(normalizeUrl('//cdn.com/a'), 'https://cdn.com/a');
});
test('normalizeUrl rejects things that are not sites', () => {
  for (const bad of ['', 'nodots', 'ftp://x.com', '--max-pages', null, undefined]) assert.equal(normalizeUrl(bad), null, String(bad));
});
test('findUrl skips option values', () => {
  assert.equal(findUrl(['--out', 'some.dir', 'example.com', '--no-motion']), 'https://example.com/');
  assert.equal(findUrl(['--max-pages', '5']), null);
});
test('sameSite treats www as the same site', () => {
  assert.ok(sameSite('https://www.a.com/x', 'https://a.com'));
  assert.ok(!sameSite('https://a.com', 'https://b.com'));
});

test('normalizeFlags: --flag=value works, a value flag without a value is an error (never a silent default)', () => {
  assert.deepEqual(normalizeFlags(['https://a.com', '--fail-on=high', '--max-pages=3', '--open']).args, ['https://a.com', '--fail-on', 'high', '--max-pages', '3', '--open']);
  assert.equal(normalizeFlags(['https://a.com', '--fail-on=high']).error, null);
  assert.match(normalizeFlags(['https://a.com', '--fail-on']).error, /--fail-on 需要一個值/, 'trailing value flag');
  assert.match(normalizeFlags(['https://a.com', '--out', '--no-motion']).error, /--out 需要一個值/, 'the next flag is not a value');
  assert.equal(normalizeFlags(['https://a.com', '--no-motion', '--headed']).error, null, 'boolean flags need nothing');
  assert.equal(normalizeFlags(['--out=my dir/x', 'https://a.com']).args[1], 'my dir/x', 'values may contain spaces and slashes');
  assert.equal(normalizeFlags(['--unknown=1']).args[0], '--unknown=1', 'unknown flags pass through untouched');
});
