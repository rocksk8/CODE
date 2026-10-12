// Diagnostic: does the 3D / animation capture work on this runner, and what does it print?
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const root = path.resolve('plugins/site-explorer');
const page = '<!doctype html><title>Spin</title><style>@keyframes spin{to{transform:rotate(360deg)}}.s{width:80px;height:80px;background:#e33;animation:spin 2s linear infinite}</style><body><h1>Hello</h1><div class="s"></div><canvas id="c" width="200" height="100"></canvas><script>var g=document.getElementById("c").getContext("2d");g.fillRect(10,10,50,50)</script></body>';
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(page); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'se-motion-')); const t0 = Date.now(); const stamp = () => String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6);
await new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts', 'capture-3d.mjs'), `http://127.0.0.1:${port}/`, '--out', out, '--wait', '1500'], { env: process.env });
  const kill = setTimeout(() => { console.log(`${stamp()}s  --- killed after 150 s`); p.kill(); }, 150000);
  const onData = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`${stamp()}s  ${l.slice(0, 200)}`));
  p.stdout.on('data', onData); p.stderr.on('data', onData); p.on('close', (c) => { clearTimeout(kill); console.log(`${stamp()}s  exit ${c}`); resolve(); });
});
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
console.log('files:', walk(out).map((f) => path.relative(out, f)).slice(0, 40).join(', '));
srv.close();
