// Node 20's test runner does not expand globs; list the files ourselves so `npm test` works on Node 20 and 22.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
// Windows runners are slow when several browser-driven test files run at once, so run fewer files in parallel there.
const conc = process.platform === 'win32' ? ['--test-concurrency=1'] : [];
process.exit(spawnSync(process.execPath, ['--test', ...conc, ...process.argv.slice(2), ...files], { stdio: 'inherit' }).status ?? 1);
