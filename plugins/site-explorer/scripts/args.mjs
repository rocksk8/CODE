// Shared CLI helpers: forgiving URL input and validated numeric options.

/** "example.com" / "  https://x.com/a b " -> absolute http(s) URL, or null when it cannot be one. */
export function normalizeUrl(input) {
  if (!input) return null;
  let v = String(input).trim();
  if (!v || v.startsWith('--')) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    const bare = v.replace(/^\/\//, '');
    // local servers and raw IPs rarely speak TLS; everything else defaults to https
    v = (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:|\/|$)/i.test(bare) ? 'http://' : 'https://') + bare;
  }
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost' && !/^[\d.]+$|^\[/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

/** First CLI argument that looks like a URL (with or without scheme). */
export function findUrl(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { if (!a.startsWith('--no-') && args[i + 1] && !args[i + 1].startsWith('--')) i++; continue; }
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

/** Returns the matching `Disallow` rule for this URL under `User-agent: *`, or null when allowed/unknown. */
export async function robotsBlocks(url) {
  try {
    const u = new URL(url);
    const r = await fetch(u.origin + '/robots.txt', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    let applies = false;
    for (const line of (await r.text()).split('\n')) {
      const [k, ...v] = line.split('#')[0].split(':');
      const key = k.trim().toLowerCase(), val = v.join(':').trim();
      if (key === 'user-agent') applies = val === '*';
      else if (applies && key === 'disallow' && val && u.pathname.startsWith(val)) return val;
    }
  } catch {}
  return null;
}
