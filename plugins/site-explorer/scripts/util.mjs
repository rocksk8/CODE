// Small shared helpers.
import { _t } from './i18n.mjs';
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
    console.error(_t`site-explorer 需要 Node.js ${min} 以上（目前是 ${process.version}）。\n請升級：https://nodejs.org（建議 22 LTS）；macOS 可用：brew install node`);
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
  const buf = Buffer.concat(chunks).subarray(0, maxBytes);
  return decodeBody(buf, res.headers?.get?.('content-type') || '');
}
/** Decode with the declared charset (Content-Type, then <meta charset> in the first 2 KB); UTF-8 when absent or unknown, so Big5 / Shift_JIS / Latin-1 pages are not turned into garbage. */
export function decodeBody(buf, contentType = '') {
  let cs = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!cs) { const head = buf.subarray(0, 2048).toString('latin1'); cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]; }
  if (cs && !/^utf-?8$/i.test(cs)) { try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch {} }
  return buf.toString('utf8');
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
  let h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, ''); // "localhost." is localhost
  // IPv4 hidden inside IPv6: ::ffff:127.0.0.1, ::ffff:7f00:1 (Node normalises to the hex form), ::127.0.0.1, 64:ff9b::a.b.c.d
  let mm = h.match(/^(?:0{0,4}:){2,6}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/) || h.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mm) h = mm[1];
  else if ((mm = h.match(/^(?:0{0,4}:){2,6}(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || h.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/))) { const hi = parseInt(mm[1], 16), lo = parseInt(mm[2], 16); h = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || /\.(lan|corp|home|intranet|private|svc|cluster\.local)$/.test(h) || h.endsWith('.home.arpa')) return true;
  if (h && !h.includes('.') && !h.includes(':') && !/^\d+$/.test(h)) return true; // a single-label name ("intranet", "nas") only exists on the user's own network
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
import dns from 'node:dns/promises';
const dnsCache = new Map();
/** isInternalHost, plus: a public-looking NAME whose DNS answer is a private/loopback/link-local address (e.g. 169.254.169.254.nip.io) counts as internal. */
export async function resolvesInternal(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (isInternalHost(h)) return true;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false; // an IP literal was already judged above
  if (dnsCache.has(h)) return dnsCache.get(h);
  let res = false;
  let timer; try { const all = await Promise.race([dns.lookup(h, { all: true }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('dns timeout')), 4000); timer.unref?.(); })]); res = all.some((a) => isInternalHost(a.address)); } catch { res = false; } finally { clearTimeout(timer); } // unresolvable: nothing to connect to
  if (dnsCache.size > 2000) dnsCache.clear();
  dnsCache.set(h, res); return res;
}
/** Allowed to fetch `target` because it belongs to a page of `base` (same-site, or `base` itself is internal/local so the user chose it). */
export const mayFetch = (target, base) => { try { const t = new URL(target); if (!/^https?:$/.test(t.protocol)) return false; return !isInternalHost(t.hostname) || isInternalHost(new URL(base).hostname); } catch { return false; } };

/** Block every browser request (redirects, subresources) to loopback/private hosts when the site being explored is public. */
export async function guardInternal(ctx, startUrl) {
  let startInternal = false; try { startInternal = await resolvesInternal(new URL(startUrl).hostname); } catch {} // a staging name that resolves to a private address is the user's own choice
  if (startInternal) return;
  await ctx.route('**/*', async (route) => {
    const u = route.request().url(); if (/^(data|blob|about):/.test(u)) return route.fallback();
    let host = ''; try { host = new URL(u).hostname; } catch {}
    return (await resolvesInternal(host)) ? route.abort('blockedbyclient') : route.fallback();
  });
  // WebSocket handshakes are not seen by route(): refuse the ones aimed at the user's own machine or LAN
  if (typeof ctx.routeWebSocket === 'function') await ctx.routeWebSocket('**/*', async (ws) => { let host = ''; try { host = new URL(ws.url()).hostname; } catch {} if (await resolvesInternal(host)) await ws.close({ code: 1008 }); else ws.connectToServer(); }).catch(() => {});
}

/** fetch that follows redirects itself and re-checks EVERY hop (a public URL may 302 to localhost or a cloud-metadata address). */
export async function gfetch(url, opts = {}, maxHops = 5) {
  if (opts.redirect && opts.redirect !== 'follow') return fetch(url, opts);
  const base = url; let cur = url;
  for (let i = 0; i <= maxHops; i++) {
    if (i > 0 && !mayFetch(cur, base)) throw new Error('blocked redirect to an internal address: ' + cur);
    if (!(await resolvesInternal(new URL(base).hostname)) && await resolvesInternal(new URL(cur).hostname)) throw new Error('blocked: ' + new URL(cur).hostname + ' resolves to an internal address');
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

// Linear-time tag/script/comment stripper (regexes like <script[\s\S]*?</script> go quadratic on hostile pages with many unclosed openers)
export function stripMarkup(src) {
  const lower = src.toLowerCase(); let out = '', i = 0; const noClose = new Set(); let gt = -2; // remembered answers keep every scan linear overall
  while (i < src.length) {
    const lt = src.indexOf('<', i); if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt) + ' ';
    let skipTo = -1;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); skipTo = e < 0 ? src.length : e + 3; }
    else for (const t of ['script', 'style', 'noscript']) if (lower.startsWith('<' + t, lt) && /[\s>\/]/.test(lower[lt + t.length + 1] || '>')) { const e = noClose.has(t) ? -1 : lower.indexOf('</' + t, lt); if (e < 0) noClose.add(t); skipTo = e < 0 ? lt + 1 + t.length : (lower.indexOf('>', e) + 1 || src.length); break; }
    if (skipTo < 0) { if (gt !== -1 && gt < lt) gt = src.indexOf('>', lt); skipTo = gt < 0 ? lt + 1 : gt + 1; }
    i = skipTo;
  }
  return out;
}

/**
 * Linear-time list of the start tags in an HTML string: [{ name, attrs, end }] (name lower-cased, attrs = text up to the closing ">", capped; end = index after ">").
 * Used instead of regexes with unbounded gaps between tag name and attribute, which go quadratic on pages made of thousands of unclosed tags.
 */
export function tagList(html, maxTags = 60000, attrCap = 4000) {
  const out = []; let i = 0, gt = -2, lower; const noClose = new Set();
  while (out.length < maxTags) {
    const lt = html.indexOf('<', i); if (lt < 0) break;
    const m = /^[A-Za-z][A-Za-z0-9-]{0,30}/.exec(html.slice(lt + 1, lt + 33));
    if (!m) { i = lt + 1; continue; }
    if (gt !== -1 && gt < lt) gt = html.indexOf('>', lt);
    if (gt < 0) break; // no further ">" anywhere: nothing else can be a complete tag
    const name = m[0].toLowerCase();
    out.push({ name, attrs: html.slice(lt + 1 + m[0].length, Math.min(gt, lt + 1 + m[0].length + attrCap)), end: gt + 1 });
    i = lt + 1 + m[0].length;
    if (name === 'script' || name === 'style') { // raw-text elements: what looks like a tag inside a script string is not markup
      lower ??= html.toLowerCase();
      if (!noClose.has(name)) { const c = lower.indexOf('</' + name, gt + 1); if (c >= 0) i = c; else noClose.add(name); }
    }
  }
  return out;
}
/** Value of an attribute inside the attrs text of one tag (quoted or bare), or null. */
export function attrValue(attrs, name) {
  const m = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}
