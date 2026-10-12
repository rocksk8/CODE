// Perceptual colour maths: sRGB -> CIELAB and the CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), plus a clustering helper that merges colours the eye cannot tell apart.
// Pure functions, no dependencies.
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** {r,g,b} 0-255 -> [L, a, b] (D65). */
export function rgbToLab({ r, g, b }) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
/** CIEDE2000 between two Lab triples. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360), h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p; let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2)), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p === 0) hbp = h1p + h2p; else if (Math.abs(h1p - h2p) <= 180) hbp /= 2; else hbp = (hbp + (hbp < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
export const colorDistance = (rgbA, rgbB) => deltaE2000(rgbToLab(rgbA), rgbToLab(rgbB));

/** items: [{ rgb:{r,g,b}, weight }]. Greedy, heaviest first: an item within `threshold` (default 2.0, "just noticeable") of an existing cluster's representative joins it.
 *  Returns [{ rep: item, members: [item...], weight }]. Unlike single-linkage, a cluster never drifts along a gradient: every member is close to the representative itself. */
export function clusterColors(items, threshold = 2) {
  const sorted = [...items].sort((a, b) => b.weight - a.weight); const out = [];
  for (const it of sorted) {
    const lab = it.lab || (it.lab = rgbToLab(it.rgb)); let hit = null, best = Infinity;
    for (const c of out) { const d = deltaE2000(c.rep.lab, lab); if (d <= threshold && d < best) { best = d; hit = c; } }
    if (hit) { hit.members.push(it); hit.weight += it.weight; } else out.push({ rep: it, members: [it], weight: it.weight });
  }
  return out;
}
