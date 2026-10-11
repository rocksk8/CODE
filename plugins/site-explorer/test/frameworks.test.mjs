// Framework outputs (React / Vue / Astro / shadcn): the converters are correct and safe; an opt-in test really installs and builds them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHtml, pageModel, toJsx, toHtml, shadcnTheme, generate, VERSIONS } from '../scripts/frameworks.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, '..', '..', 'docs', 'demo', 'acme-studio', 'handoff');
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-fw-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const copyDemo = (n) => { const d = path.join(tmp, n); fs.cpSync(demo, d, { recursive: true }); return d; };
const first = (html) => parseHtml(html).children[0];

test('toJsx: class/for become className/htmlFor, style strings become objects (custom properties quoted), void tags self-close', () => {
  const j = toJsx(first('<section class="sec a" style="--sec-bg:#fff;padding-top:12px;--x:calc(1px + 2px)" data-section="hero"><img src="a.png" alt=""><label for="x">L</label><input id="x" type="text" disabled><br></section>'));
  assert.match(j, /className="sec a"/); assert.match(j, /style=\{\{ "--sec-bg": "#fff", paddingTop: "12px", "--x": "calc\(1px \+ 2px\)" \}\}/);
  assert.match(j, /<img src="a\.png" alt="" \/>/); assert.match(j, /htmlFor="x"/); assert.match(j, /<input id="x" type="text" disabled \/>/); assert.match(j, /<br \/>/);
  assert.ok(!/\bclass=|\bfor=/.test(j));
});

test('converters never emit event handlers, raw braces or comment breakouts, whatever the input', () => {
  const evil = first('<div class="a" onclick="alert(1)" onmouseover=x><p>{danger} {{x}} <b>&lt;</b> a &amp; b</p><!-- */ break out --></div>');
  for (const out of [toJsx(evil), toHtml(evil)]) { assert.ok(!/onclick|onmouseover|alert/.test(out), out); }
  const j = toJsx(evil); assert.ok(j.includes("{'{'}danger{'}'}") && !j.includes('{danger}'), j); assert.ok(j.includes('{/* * / break out */}'));
  const h = toHtml(evil); assert.ok(!/\{|\}/.test(h.replace(/&#12[35];/g, '')), h); assert.ok(h.includes('a &amp; b'));
});

test('pageModel: sections come from the starter comments, names are unique components, scripts are dropped', () => {
  const html = '<!doctype html><html lang="fr"><head><title>Home — starter</title></head><body><!-- 1. header | reference image: x -->\n<header data-section="header"><a href="#">A</a></header><!-- 2. cta --><section data-section="cta">x</section><section data-section="cta">y</section><script src="app.js"></script></body></html>';
  const m = pageModel(html); assert.equal(m.lang, 'fr'); assert.equal(m.title, 'Home');
  assert.deepEqual(m.sections.map((s) => s.name), ['Header', 'Cta', 'Cta2']); assert.match(m.sections[0].comment, /reference image/);
});

test('generate: react, vue and astro projects from the demo starter — every page and section is a file, tokens travel with the project, nothing outside the output folder', () => {
  const h = copyDemo('h1'); const res = generate(h, 'all'); assert.deepEqual(res.map((r) => r.target), ['react', 'vue', 'astro', 'shadcn']);
  const sections = fs.readdirSync(path.join(h, 'starter')).filter((f) => f === 'index.html').length ? (fs.readFileSync(path.join(h, 'starter', 'index.html'), 'utf8').match(/data-section=/g) || []).length : 0;
  assert.ok(sections >= 5);
  for (const [fw, ext, comp] of [['react', 'jsx', 'src/components/Home'], ['vue', 'vue', 'src/components/Home'], ['astro', 'astro', 'src/components/Home']]) {
    const dir = path.join(h, 'frameworks', fw); assert.equal(fs.readdirSync(path.join(dir, comp)).filter((f) => f.endsWith('.' + ext)).length, sections, fw);
    assert.ok(fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'README.md')));
    const css = fs.readFileSync(path.join(dir, fw === 'astro' ? 'src/styles/styles.css' : 'src/styles.css'), 'utf8'); assert.ok(!/@import[^;]*\.\.\/tokens/.test(css) && /@import url\("\.\/tokens\.css"\)/.test(css), fw + ' css import is self-contained');
    assert.ok(fs.existsSync(path.join(dir, fw === 'astro' ? 'src/styles/tokens.css' : 'src/tokens.css')));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(h, 'frameworks', 'react', 'package.json'), 'utf8')); assert.equal(pkg.dependencies.react, VERSIONS.react); assert.ok(!/[\^~]/.test(JSON.stringify(pkg.dependencies)), 'versions are pinned');
  assert.ok(!fs.readFileSync(path.join(h, 'frameworks', 'react', 'src', 'components', 'Home', 'Hero.jsx'), 'utf8').includes('<script'));
});

test('generate: an edited previous output is moved aside, an untouched one is replaced; a bad target is refused', () => {
  const h = copyDemo('h2'); generate(h, 'react');
  const f = path.join(h, 'frameworks', 'react', 'src', 'components', 'Home', 'Hero.jsx');
  generate(h, 'react'); assert.deepEqual(fs.readdirSync(path.join(h, 'frameworks')).filter((x) => x.includes('backup')), [], 'untouched output is simply regenerated');
  fs.appendFileSync(f, '\n// my edit\n'); generate(h, 'react');
  const backups = fs.readdirSync(path.join(h, 'frameworks')).filter((x) => x.startsWith('react.backup-')); assert.equal(backups.length, 1);
  assert.ok(fs.readFileSync(path.join(h, 'frameworks', backups[0], 'src', 'components', 'Home', 'Hero.jsx'), 'utf8').includes('my edit'), 'the edit is kept');
  assert.throws(() => generate(h, 'angular'), /--to/); assert.throws(() => generate(path.join(tmp, 'nope'), 'react'), /找不到/);
});

test('shadcnTheme: HSL variables in the format shadcn reads, readable foregrounds, a dark scheme, no injection through font names', () => {
  const t = shadcnTheme({ color: { brand: '#5b4bff', background: '#ffffff', text: '#14141f' }, radius: ['16px'], typography: { fontStack: { heading: 'Evil"}; body{x:y', body: 'Acme Sans' } }, darkMode: { supported: false } }, { host: 'x.test' });
  assert.match(t['globals-theme.css'], /--primary: 245 100% 65%;/); assert.match(t['globals-theme.css'], /--primary-foreground: 0 0% 100%;/); assert.match(t['globals-theme.css'], /--radius: 1rem;/); assert.match(t['globals-theme.css'], /\.dark \{/);
  for (const m of t['globals-theme.css'].matchAll(/--[\w-]+: ([^;]+);/g)) assert.match(m[1], /^(\d+ \d+% \d+%|1rem)$/, m[0]);
  assert.ok(!/Evil"/.test(t['tailwind.config.snippet.js']) && t['tailwind.config.snippet.js'].includes('"Acme Sans"'), t['tailwind.config.snippet.js']);
  assert.match(shadcnTheme({}, {})['globals-theme.css'], /--background: 0 0% 100%;/, 'missing tokens fall back to a neutral theme');
});

// Opt-in (needs network, takes about a minute): really install and build each project, then compare it section by section with the plain starter.
test('react, vue and astro projects install, build, and render the starter exactly', { skip: process.env.SITE_EXPLORER_BUILD_TEST !== '1' }, async () => {
  const { launchBrowser } = await import('../scripts/launch.mjs'); const http = await import('node:http'); const crypto = await import('node:crypto'); const { pathToFileURL } = await import('node:url');
  const h = copyDemo('build'); generate(h, 'all');
  const b = await launchBrowser();
  const shots = async (url) => { const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(300); const n = await p.locator('[data-section]').count(); const o = []; for (let i = 0; i < n; i++) o.push(crypto.createHash('sha1').update(await p.locator('[data-section]').nth(i).screenshot()).digest('hex')); await p.close(); return o; };
  try {
    const base = await shots(pathToFileURL(path.join(h, 'starter', 'index.html')).href); assert.ok(base.length >= 5);
    for (const fw of ['react', 'vue', 'astro']) {
      const dir = path.join(h, 'frameworks', fw), run = (a) => spawnSync('npm', a, { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
      let r = run(['install', '--no-audit', '--no-fund', '--loglevel=error']); assert.equal(r.status, 0, fw + ' install: ' + r.stderr); r = run(['run', 'build']); assert.equal(r.status, 0, fw + ' build: ' + r.stdout + r.stderr);
      const dist = path.join(dir, 'dist'); const srv = http.createServer((q, res) => { let f = path.join(dist, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) f = path.join(dist, 'index.html'); res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
      await new Promise((r2) => srv.listen(0, '127.0.0.1', r2));
      try { assert.deepEqual(await shots(`http://127.0.0.1:${srv.address().port}/`), base, fw + ' renders differently from the plain starter'); } finally { srv.close(); }
    }
  } finally { await b.close(); }
});

test('explore --framework: a real run writes the framework project next to the handoff; a bad value or --no-handoff is refused', async (t) => {
  const { launchBrowser } = await import('../scripts/launch.mjs'); let ok = true; try { (await launchBrowser()).close(); } catch { ok = false; }
  if (!ok) return t.skip('no browser');
  const http = await import('node:http'); const { spawn } = await import('node:child_process');
  const html = '<!doctype html><title>F</title><style>body{margin:0}header{background:#123;color:#fff;padding:20px}section{padding:60px 20px}</style><header><a href="/">Home</a></header><section><h1>Headline here</h1><p>A paragraph long enough to count as content for this fixture page.</p></section><footer style="padding:30px">foot</footer>';
  const server = http.createServer((q, r) => { r.writeHead(q.url === '/robots.txt' ? 404 : 200, { 'content-type': 'text/html' }); r.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`, bin = path.join(root, 'bin', 'site-explorer.mjs');
  const run = (a) => new Promise((resolve) => { const p = spawn(process.execPath, [bin, url, '--no-open', '--no-motion', '--no-db', '--no-health', '--max-pages', '1', ...a], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (s) => resolve({ s, o })); });
  try {
    const out = path.join(tmp, 'xf'); const r = await run(['--framework', 'all', '--out', out]); assert.equal(r.s, 0, r.o);
    for (const fw of ['react', 'vue', 'astro', 'shadcn']) assert.ok(fs.existsSync(path.join(out, 'handoff', 'frameworks', fw)), fw);
    assert.ok(fs.existsSync(path.join(out, 'handoff', 'frameworks', 'react', 'src', 'components', 'Home')));
    assert.notEqual((await run(['--framework', 'svelte', '--out', path.join(tmp, 'x2')])).s, 0);
    assert.notEqual((await run(['--framework', 'react', '--no-handoff', '--out', path.join(tmp, 'x3')])).s, 0);
  } finally { server.close(); }
});
