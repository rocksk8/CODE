// Round 9: ~58 more technology signatures. Every one has a sample URL that must be recognised, and look-alike names must not be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTech } from '../scripts/techstack.mjs';

const samples = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'techstack-samples.json'), 'utf8'));
const page = (...scripts) => ({ status: 200, url: 'https://s.test/', editing: { scripts, stylesheets: [] }, tech: { urls: [] }, seo: { http: { headers: {} } }, privacy: { cookies: [] } });
const ids = (r) => r.items.map((x) => x.id);

test('every new signature recognises its sample URL', () => {
  const missing = Object.entries(samples).filter(([id, url]) => !ids(detectTech([page(url)])).includes(id));
  assert.deepEqual(missing, [], 'not recognised: ' + missing.map(([id]) => id).join(', '));
  assert.ok(Object.keys(samples).length >= 55);
});

test('look-alike file names and ordinary pages do not trigger the new signatures', () => {
  const quiet = ids(detectTech([page('https://s.test/js/member.js', 'https://s.test/js/timber.min.js', 'https://s.test/assets/app.8f3a.js', 'https://s.test/lib/underscore_helpers.css', 'https://s.test/img/ecpay-logo-not-a-host.png')]));
  for (const id of ['ember', 'ecpay', 'lit', 'p5', 'dayjs', 'sanity', 'drift']) assert.ok(!quiet.includes(id), id + ' fired on a look-alike: ' + quiet.join(','));
  assert.deepEqual(ids(detectTech([page('https://s.test/main.js')])), []);
});
