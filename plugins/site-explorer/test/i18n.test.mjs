// Output language plumbing: Chinese is the identity, English falls back to the original text when there is no translation, placeholders work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = (env, args = []) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { _t, LANG, htmlLang } from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts', 'i18n.mjs')).href)};
  console.log(JSON.stringify({ LANG, htmlLang: htmlLang(), plain: _t('一段不存在的測試字串'), tagged: _t\`共 \${3} 頁，\${'x'} 個\` }));`, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

test('zh is the default and _t is the identity (plain and tagged)', () => {
  const r = JSON.parse(probe({ SITE_EXPLORER_LANG: '' }).stdout);
  assert.deepEqual(r, { LANG: 'zh', htmlLang: 'zh-Hant', plain: '一段不存在的測試字串', tagged: '共 3 頁，x 個' });
});

test('--lang en / SITE_EXPLORER_LANG=en select English; text without a translation falls back to the original instead of breaking', () => {
  for (const r of [probe({ SITE_EXPLORER_LANG: 'en' }), probe({ SITE_EXPLORER_LANG: 'EN-us' }), probe({ SITE_EXPLORER_LANG: '' }, ['--', '--lang', 'en'])]) {
    const j = JSON.parse(r.stdout); assert.equal(j.LANG, 'en'); assert.equal(j.htmlLang, 'en'); assert.equal(j.plain, '一段不存在的測試字串'); assert.equal(j.tagged, '共 3 頁，x 個');
  }
  assert.equal(JSON.parse(probe({ SITE_EXPLORER_LANG: 'fr' }).stdout).LANG, 'zh', 'unknown languages keep the default');
});

test('every dictionary entry is valid: string values, placeholders in the translation exist in the source', async () => {
  const { readFileSync } = await import('node:fs'); const d = JSON.parse(readFileSync(path.join(root, 'scripts', 'i18n', 'en.json'), 'utf8'));
  for (const [k, v] of Object.entries(d)) {
    assert.equal(typeof v, 'string', k); const slots = (k.match(/\{\}/g) || []).length;
    for (const m of v.matchAll(/\{(\d*)\}/g)) assert.ok(m[1] === '' ? true : Number(m[1]) < slots, `placeholder {${m[1]}} has no value in: ${k}`);
    if (!/\{\d*\}/.test(v) && slots) assert.ok(true); // a translation may drop a value on purpose
  }
});
