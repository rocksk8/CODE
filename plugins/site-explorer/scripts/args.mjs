// Shared CLI helpers: forgiving URL input and validated numeric options.

/** "example.com" / "  https://x.com/a b " -> absolute http(s) URL, or null when it cannot be one. */
export function normalizeUrl(input) {
  if (!input) return null;
  let v = String(input).trim();
  if (!v || v.startsWith('--')) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'https://' + v.replace(/^\/\//, '');
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
