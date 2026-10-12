// A slow page must not hang the capture: the time budget ends it early, keeps what was done, says so, and progress lines show it is alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'capture-3d.mjs');
test('capture-3d: --budget-ms ends a long capture early, writes the report anyway, and prints progress', async (t) => {
  let have = true; try { const { launchBrowser } = await import('../scripts/launch.mjs'); await (await launchBrowser()).close(); } catch { have = false; }
  if (!have) return t.skip('no browser');
  const canvases = Array.from({ length: 4 }, (_, i) => `<canvas id="c${i}" width="400" height="260" style="display:block;margin:20px"></canvas>`).join('');
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Many canvases</title></head><body style="margin:0">${canvases}<div style="height:3000px"></div><script>for(const c of document.querySelectorAll('canvas')){const g=c.getContext('2d');let n=0;(function f(){n++;g.fillStyle='hsl('+(n*5%360)+',70%,50%)';g.fillRect(0,0,400,260);g.fillStyle='#fff';g.fillText(String(n),20,40);requestAnimationFrame(f)})()}</script></body></html>`;
  const srv = http.createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(page); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-bud-'));
  const run = (extra) => new Promise((resolve) => { const t0 = Date.now(); const p = spawn(process.execPath, [script, url, '--out', dir, '--wait', '300', '--no-video', '--lang', 'en', ...extra], { env: process.env }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (status) => resolve({ status, o, ms: Date.now() - t0 })); });
  try {
    const r = await run(['--budget-ms', '1500']); assert.equal(r.status, 0, r.o);
    assert.match(r.o, /target 1\/4/i, 'progress per target'); assert.match(r.o, /time budget/, 'says that it ended early');
    const j = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => fs.existsSync(path.join(dir, n, 'motion.json'))), 'motion.json'), 'utf8')); assert.ok(j.targets.length >= 1, 'a report is still written'); assert.ok(j.targets.some((x) => x.skipped === 'time budget'), 'skipped targets are marked');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
});
