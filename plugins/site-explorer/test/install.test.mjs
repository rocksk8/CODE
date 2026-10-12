// Install and first-run experience: one command, done once, easy afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '..', '..');
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let tmp, fresh;
const run = (cwd, args, env = {}, opts = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env } });
  let out = ''; const t0 = Date.now(); const kill = setTimeout(() => p.kill(), opts.timeout || 120000);
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (status) => { clearTimeout(kill); resolve({ status, out, ms: Date.now() - t0 }); });
});
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se install-'));
  // a plugin copy WITHOUT node_modules = what a user gets from GitHub
  fresh = path.join(tmp, 'plugin copy'); fs.mkdirSync(fresh);
  for (const f of ['bin', 'scripts', 'package.json', 'package-lock.json']) fs.cpSync(path.join(root, f), path.join(fresh, f), { recursive: true });
});
after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); });

test('manifests agree: one version everywhere, light dependencies, pinned MCP, valid hook', () => {
  const pkg = J(path.join(root, 'package.json')), plug = J(path.join(root, '.claude-plugin', 'plugin.json')), top = J(path.join(repo, 'package.json'));
  assert.equal(pkg.version, plug.version, 'plugin.json and package.json versions must move together (Claude Code caches by version)');
  assert.equal(top.version, pkg.version);
  assert.equal(pkg.dependencies['playwright-core'], J(path.join(root, 'node_modules', 'playwright-core', 'package.json')).version, 'playwright-core is pinned to the tested version');
  assert.equal(top.dependencies['playwright-core'], pkg.dependencies['playwright-core']);
  assert.equal(top.dependencies['axe-core'], pkg.dependencies['axe-core'], 'axe-core is pinned identically in both manifests'); assert.equal(pkg.dependencies['axe-core'], J(path.join(root, 'node_modules', 'axe-core', 'package.json')).version);
  assert.ok(!pkg.devDependencies, 'no devDependencies: Claude Code installs package.json dependencies into the plugin cache; the 3D tests get three via test:full');
  assert.equal(pkg.engines.node, '>=20'); assert.equal(top.engines.node, '>=20');
  assert.equal(pkg.bin['site-explorer'], 'bin/site-explorer.mjs'); assert.equal(top.bin['site-explorer'], 'plugins/site-explorer/bin/site-explorer.mjs');
  assert.ok(fs.existsSync(path.join(repo, top.bin['site-explorer'])));
  const mcp = J(path.join(root, '.mcp.json')); assert.doesNotMatch(JSON.stringify(mcp), /@latest/, 'MCP server version is pinned');
  const hook = J(path.join(root, 'hooks', 'hooks.json')).hooks.SessionStart[0].hooks[0];
  assert.match(hook.command, /bin\/site-explorer\.mjs" setup --deps-only --quiet --background/); assert.ok(hook.timeout <= 60);
  const mk = J(path.join(repo, '.claude-plugin', 'marketplace.json')); assert.equal(mk.plugins[0].source, './plugins/site-explorer');
});

test('every command and skill calls the dispatcher through ${CLAUDE_PLUGIN_ROOT}, never a bare scripts/ path or a cd into the plugin', () => {
  const files = [...fs.readdirSync(path.join(root, 'commands')).map((f) => path.join(root, 'commands', f)), ...fs.readdirSync(path.join(root, 'skills')).map((d) => path.join(root, 'skills', d, 'SKILL.md')), path.join(root, 'agents', 'site-explorer.md')];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /node scripts\//, f + ' uses a bare scripts/ path'); assert.doesNotMatch(t, /cd "\$\{CLAUDE_PLUGIN_ROOT\}"/, f + ' cd\'s into the plugin (output would land in the plugin cache)');
    assert.doesNotMatch(t, /mcp__playwright__/, f + ' hard-codes an MCP tool prefix that does not match plugin-provided servers');
  }
});

test('dispatcher: help, version, routing and clear errors', async () => {
  const bin = path.join(root, 'bin', 'site-explorer.mjs'), v = J(path.join(root, 'package.json')).version;
  let r = await run(tmp, [bin, '--version']); assert.equal(r.out.trim(), v);
  r = await run(tmp, [bin]); assert.equal(r.status, 0); assert.match(r.out, /site-explorer .* — 探索網站/); assert.match(r.out, /setup\s+一次搞定環境/);
  r = await run(tmp, [bin, 'nonsense']); assert.equal(r.status, 1); assert.match(r.out, /未知的指令或網址：「nonsense」/);
  r = await run(tmp, [bin, 'explore', '--help']); assert.equal(r.status, 0); assert.match(r.out, /--max-pages/); assert.match(r.out, /--no-handoff/); assert.match(r.out, /--no-link-check/);
  r = await run(tmp, [bin, 'explore']); assert.equal(r.status, 1, 'no URL is an error, with the usage text'); assert.match(r.out, /用法：site-explorer explore/);
  r = await run(tmp, [bin, 'example.com', '--help']); assert.equal(r.status, 0, 'a bare domain routes to explore'); assert.match(r.out, /用法：site-explorer explore/);
  r = await run(tmp, [bin, 'health']); assert.equal(r.status, 1); assert.match(r.out, /health-check\.mjs/, '`health` without a URL routes to the health-check script');
});

test('CLI scripts still run when reached through a symlink (npm link, /tmp -> /private/tmp)', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need privileges on Windows');
  const link = path.join(tmp, 'linked'); fs.symlinkSync(path.join(root, 'scripts'), link);
  const r = await run(tmp, [path.join(link, 'health-check.mjs')]);
  assert.equal(r.status, 1); assert.match(r.out, /Usage: health-check\.mjs/, 'it printed its usage instead of silently doing nothing');
});

test('Node version guard explains itself instead of a cryptic dependency error', async () => {
  const r = await run(tmp, ['-e', `import('${pathToFileURL(path.join(root, 'scripts', 'util.mjs')).href}').then(m => m.assertNode(999))`]);
  assert.equal(r.status, 1); assert.match(r.out, /需要 Node\.js 999 以上/); assert.match(r.out, /nodejs\.org/);
});

test('output can never be placed inside the plugin directory', async () => {
  const r = await run(tmp, [path.join(root, 'bin', 'site-explorer.mjs'), 'explore', 'localhost:1', '--out', path.join(root, 'inside-the-plugin')]);
  assert.equal(r.status, 1); assert.match(r.out, /不能放在外掛目錄內/); assert.ok(!fs.existsSync(path.join(root, 'inside-the-plugin')));
});

test('first run installs pinned dependencies ONCE into ~/.site-explorer/deps; the hook form returns at once', async () => {
  const home = path.join(tmp, 'home'); const bin = path.join(fresh, 'bin', 'site-explorer.mjs'), env = { SITE_EXPLORER_HOME: home };
  assert.ok(!fs.existsSync(path.join(fresh, 'node_modules')), 'precondition: the plugin copy has no node_modules');
  const r = await run(fresh, [bin, 'setup', '--deps-only', '--quiet', '--background'], env);
  assert.equal(r.status, 0); assert.equal(r.out, '', 'silent: a SessionStart hook must not inject anything into the conversation'); assert.ok(r.ms < 6000, `returned immediately (${r.ms} ms)`);
  const entry = path.join(home, 'deps', 'node_modules', 'playwright-core', 'index.mjs');
  const lockDir = path.join(home, 'deps', '.lock');
  for (let i = 0; i < 240 && !(fs.existsSync(entry) && !fs.existsSync(lockDir)); i++) await new Promise((res) => setTimeout(res, 250)); // background install (needs the npm registry): done = files present AND lock released
  assert.ok(fs.existsSync(entry), 'dependencies were installed in the background');
  assert.equal(J(path.join(home, 'deps', 'node_modules', 'playwright-core', 'package.json')).version, J(path.join(fresh, 'package.json')).dependencies['playwright-core'], 'the pinned version');
  assert.ok(!fs.existsSync(path.join(fresh, 'node_modules')), 'nothing was written inside the plugin directory');
  assert.ok(!fs.existsSync(path.join(home, 'deps', '.lock')), 'lock released');
  const again = await run(fresh, [bin, 'setup', '--deps-only'], env); assert.equal(again.status, 0); assert.ok(again.ms < 10000, 'second run is a no-op (' + again.ms + ' ms)');
});

test('two first runs at the same time: one installs, the other waits, both succeed', async () => {
  const home = path.join(tmp, 'home2'), env = { SITE_EXPLORER_HOME: home };
  const launch = pathToFileURL(path.join(fresh, 'scripts', 'launch.mjs')).href;
  const go = () => run(fresh, ['-e', `import('${launch}').then((m) => m.loadPlaywright()).then(() => console.log('READY'))`], env); // non-quiet: prints a message only when it installs
  const [a, b] = await Promise.all([go(), go()]);
  assert.match(a.out, /READY/, a.out); assert.match(b.out, /READY/, b.out);
  assert.equal([a.out, b.out].filter((o) => /第一次執行/.test(o)).length, 1, 'only one process did the install');
  assert.ok(fs.existsSync(path.join(home, 'deps', 'node_modules', 'playwright-core', 'index.mjs'))); assert.ok(!fs.existsSync(path.join(home, 'deps', '.lock')));
});

test('setup without a browser and without a terminal asks for consent instead of downloading (exit 2)', async (t) => {
  const home = path.join(tmp, 'home'); // deps already installed by the test above
  if (!fs.existsSync(path.join(home, 'deps', 'node_modules'))) return t.skip('deps not installed');
  const r = await run(fresh, [path.join(fresh, 'bin', 'site-explorer.mjs'), 'setup'], { SITE_EXPLORER_HOME: home, CHROMIUM_PATH: '', PLAYWRIGHT_BROWSERS_PATH: path.join(tmp, 'no-browsers') });
  if (r.status === 0) return t.skip('this machine has Chrome/Edge installed, so no download is needed');
  assert.equal(r.status, 2); assert.match(r.out, /需要你的同意才會下載/); assert.match(r.out, /site-explorer setup --yes/);
});

test('npm package: ships only what the CLI needs, is small, and the unpacked tarball runs', async () => {
  const { spawnSync } = await import('node:child_process');
  const dest = path.join(tmp, 'pack'); fs.mkdirSync(dest);
  const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8', shell: process.platform === 'win32' }); // packs into the repo folder; moved right away (the --pack-destination option is not understood the same way by every npm)
  assert.equal(packed.status, 0, packed.stderr);
  const info = JSON.parse(packed.stdout)[0];
  fs.copyFileSync(path.join(repo, info.filename), path.join(dest, info.filename)); fs.rmSync(path.join(repo, info.filename), { force: true }); // (copy, not rename: the temp folder can be on another drive)
  const paths = info.files.map((f) => f.path);
  for (const must of ['package.json', 'README.md', 'LICENSE', 'plugins/site-explorer/bin/site-explorer.mjs', 'plugins/site-explorer/package.json', 'plugins/site-explorer/scripts/verify.mjs', 'plugins/site-explorer/scripts/report/report-client.js']) assert.ok(paths.includes(must), 'missing from package: ' + must);
  assert.ok(!paths.some((p) => /(^|\/)(test|docs|node_modules|tools)\//.test(p) || /\.env|\.pem|\.db$/.test(p)), 'tests, docs, tools or secrets leaked into the package');
  assert.ok(info.size < 1_500_000, `package is ${info.size} bytes`);
  const ex = path.join(tmp, 'unpacked'); fs.mkdirSync(ex);
  assert.equal(spawnSync('tar', ['-xzf', path.join('pack', info.filename), '-C', 'unpacked'], { cwd: tmp }).status, 0); // relative paths: GNU tar on Windows reads "C:\\..." as a remote host
  const bin = path.join(ex, 'package', 'plugins', 'site-explorer', 'bin', 'site-explorer.mjs');
  const r = await run(tmp, [bin, '--version']); assert.equal(r.out.trim(), J(path.join(repo, 'package.json')).version);
  const h = await run(tmp, [bin, 'verify']); assert.match(h.out, /用法：site-explorer verify/);
});
