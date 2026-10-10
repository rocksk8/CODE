// Shared CLI helpers: forgiving URL input and validated numeric options.

/** "example.com" / "  https://x.com/a b " -> absolute http(s) URL, or null when it cannot be one. */
export function normalizeUrl(input) {
  if (!input) return null;
  let v = String(input).trim();
  if (!v || v.startsWith('--')) return null;
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
  if (!hadScheme) {
    const bare = v.replace(/^\/\//, '');
    // local servers and raw IPs rarely speak TLS; everything else defaults to https
    v = (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:|\/|$)/i.test(bare) ? 'http://' : 'https://') + bare;
  }
  try {
    const u = new URL(v);
    // a file name or path is not a site: './out', 'index.html', 'report.md' would otherwise parse as hosts
    if (u.hostname.startsWith('.') || (!hadScheme && /\.(html?|json|md|txt|png|jpe?g|gif|svg|css|m?js|xml|pdf|zip|csv|ya?ml|log|webp|mp4|db)$/i.test(u.hostname))) return null;
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost' && !/^[\d.]+$|^\[/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

/** First CLI argument that looks like a URL (with or without scheme). */
// options that take a value (so the value is never mistaken for a URL); boolean flags such as --open must not swallow the URL after them
const VALUE_FLAGS = new Set(['--max-pages', '--depth', '--out', '--wait', '--motion-pages', '--frames', '--interval', '--max-targets', '--max-links', '--site', '--motion', '--embed-mb', '--a', '--b', '--lib', '--platform', '--font', '--color', '--health-below']);
/** Every URL among the arguments, in order (the first one is where the crawl starts; the others are extra pages to include). */
export function findUrls(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { if (VALUE_FLAGS.has(a) && args[i + 1] !== undefined) i++; continue; }
    const u = normalizeUrl(a); if (u && !out.includes(u)) out.push(u);
  }
  return out;
}
export function findUrl(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { if (VALUE_FLAGS.has(a) && args[i + 1] !== undefined) i++; continue; }
    const u = normalizeUrl(a); if (u) return u;
  }
  return null;
}

/** Numeric option with a clear error instead of silently becoming NaN. */
export function intOpt(args, name, def, { min = 0, max = Infinity } = {}) {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || args[i + 1] === undefined) return def;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`--${name} 需要 ${min}${Number.isFinite(max) ? '–' + max : ' 以上'} 的數字，收到「${args[i + 1]}」`);
    process.exit(1);
  }
  return Math.floor(n);
}

/** "www.a.com" and "a.com" are the same site for crawling purposes. */
export const sameSite = (a, b) => {
  try { return new URL(a).host.replace(/^www\./, '') === new URL(b).host.replace(/^www\./, ''); } catch { return false; }
};

import { fetchRobots, isAllowed } from './robots.mjs';
export const CRAWLER_UA_TOKEN = 'site-explorer-claude-plugin';

/** Parsed robots.txt for an origin (null parsed when missing). */
export const loadRobots = (origin) => fetchRobots(origin, CRAWLER_UA_TOKEN);

/** The rule that blocks this URL for our crawler, or null when allowed/unknown. */
export async function robotsBlocks(url) {
  const u = new URL(url), r = await loadRobots(u.origin);
  const v = isAllowed(r.parsed, CRAWLER_UA_TOKEN, u.pathname + u.search);
  return v.allowed ? null : v.rule;
}
