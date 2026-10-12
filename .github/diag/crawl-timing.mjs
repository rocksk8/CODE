// Diagnostic for the platforms workflow: how long does each step of a crawl take on this runner, and where does it stall?
// Prints every output line of the crawler with a timestamp, for three variants.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { sickSite } from '../../plugins/site-explorer/test/fixtures/sick-site.mjs';

const root = path.resolve('plugins/site-explorer');
let port; const srv = http.createServer((q, r) => sickSite({ origin: () => `http://127.0.0.1:${port}` })(q, r));
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
const variants = [['default 3 pages', ['--max-pages', '3']], ['no screenshots, no interact', ['--max-pages', '3', '--no-screenshots', '--no-interact']]];
for (const [label, extra] of variants) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'se-diag-')); const t0 = Date.now(); const stamp = () => String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6);
  console.log(`\n=== ${label}`);
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'scripts', 'crawl.mjs'), `http://127.0.0.1:${port}/`, ...extra, '--out', out], { env: process.env });
    const kill = setTimeout(() => { console.log(`${stamp()}s  --- killed after 100 s`); p.kill(); }, 100000);
    const onData = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`${stamp()}s  ${l.slice(0, 160)}`));
    p.stdout.on('data', onData); p.stderr.on('data', onData); p.on('close', (c) => { clearTimeout(kill); console.log(`${stamp()}s  exit ${c}`); resolve(); });
  });
}
srv.close();
