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
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
