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
  let h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4 hidden inside IPv6: ::ffff:127.0.0.1, ::ffff:7f00:1 (Node normalises to the hex form), ::127.0.0.1, 64:ff9b::a.b.c.d
  let mm = h.match(/^(?:0{0,4}:){2,6}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/) || h.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mm) h = mm[1];
  else if ((mm = h.match(/^(?:0{0,4}:){2,6}(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || h.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/))) { const hi = parseInt(mm[1], 16), lo = parseInt(mm[2], 16); h = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
/** Allowed to fetch `target` because it belongs to a page of `base` (same-site, or `base` itself is internal/local so the user chose it). */
export const mayFetch = (target, base) => { try { const t = new URL(target); if (!/^https?:$/.test(t.protocol)) return false; return !isInternalHost(t.hostname) || isInternalHost(new URL(base).hostname); } catch { return false; } };

/** Block every browser request (redirects, subresources) to loopback/private hosts when the site being explored is public. */
export async function guardInternal(ctx, startUrl) {
  let startInternal = false; try { startInternal = isInternalHost(new URL(startUrl).hostname); } catch {}
  if (startInternal) return;
  await ctx.route('**/*', (route) => {
    let host = ''; try { host = new URL(route.request().url()).hostname; } catch {}
    return /^(data|blob|about):/.test(route.request().url()) || !isInternalHost(host) ? route.continue() : route.abort('blockedbyclient');
  });
}

/** fetch that follows redirects itself and re-checks EVERY hop (a public URL may 302 to localhost or a cloud-metadata address). */
export async function gfetch(url, opts = {}, maxHops = 5) {
  if (opts.redirect && opts.redirect !== 'follow') return fetch(url, opts);
  const base = url; let cur = url;
  for (let i = 0; i <= maxHops; i++) {
    if (i > 0 && !mayFetch(cur, base)) throw new Error('blocked redirect to an internal address: ' + cur);
    const r = await fetch(cur, { ...opts, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      try { await r.body?.cancel(); } catch {}
      cur = new URL(r.headers.get('location'), cur).href; continue;
    }
    Object.defineProperty(r, 'url', { value: cur, configurable: true }); // a manual response has url ''; expose the final URL like follow mode
    return r;
  }
  throw new Error('too many redirects');
}
