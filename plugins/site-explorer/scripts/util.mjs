// Small shared helpers.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when this module is the program being run — also through symlinks, `npm link`, macOS /tmp -> /private/tmp, etc. */
export function isMain(metaUrl) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

/** playwright-core 1.64 requires Node >= 20. Say so clearly, before any import can fail with a cryptic message. */
export const MIN_NODE = 20;
export function assertNode(min = MIN_NODE) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < min) {
    console.error(`site-explorer 需要 Node.js ${min} 以上（目前是 ${process.version}）。\n請升級：https://nodejs.org（建議 22 LTS）；macOS 可用：brew install node`);
    process.exit(1);
  }
}

/** Read a fetch body with a hard cap on DECOMPRESSED bytes (guards against gzip bombs and endless bodies). */
export async function readCapped(res, maxBytes = 3_000_000) {
  if (!res.body) return '';
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; chunks.push(value);
    if (n >= maxBytes) { try { await reader.cancel(); } catch {} break; }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}
export async function readCappedBuffer(res, maxBytes = 5_000_000) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; chunks.push(value);
    if (n > maxBytes) { try { await reader.cancel(); } catch {} return null; } // too large: refuse
  }
  return Buffer.concat(chunks);
}

/** Loopback / private / link-local hosts: never fetched on behalf of a PUBLIC site's content (SSRF guard). */
export function isInternalHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
/** Allowed to fetch `target` because it belongs to a page of `base` (same-site, or `base` itself is internal/local so the user chose it). */
export const mayFetch = (target, base) => { try { const t = new URL(target); if (!/^https?:$/.test(t.protocol)) return false; return !isInternalHost(t.hostname) || isInternalHost(new URL(base).hostname); } catch { return false; } };
