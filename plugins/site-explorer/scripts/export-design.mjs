#!/usr/bin/env node
// Convert a crawl result (site.json) into a design-system bundle that Claude Design can ingest:
//   tokens.json (colors by role, type scale, spacing scale, radius, shadow, breakpoints),
//   tokens.css, components.json, README.md (brand brief), assets/
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) {
  console.error('Usage: export-design.mjs <crawl-output-dir containing site.json> [--out DIR]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : path.join(dir, 'design-bundle');
fs.mkdirSync(out, { recursive: true });
const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
const d = site.design, c = site.components || {};

// ---- color helpers ----
const parse = (v) => {
  const m = String(v).match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
};
const hex = ({ r, g, b }) => '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
const hsl = ({ r, g, b }) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
  const s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (dl) h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
  return { h: Math.round(((h * 60) + 360) % 360), s, l };
};
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };

// merge duplicate colors by hex, accumulating weight
const weights = new Map();
const addColors = (list, w = 1, tag) => {
  for (const { value, count } of list || []) {
    const p = parse(value); if (!p || p.a < 0.5) continue;
    const k = hex(p); const e = weights.get(k) || { hex: k, rgb: p, count: 0, tags: new Set() };
    e.count += count * w; e.tags.add(tag); weights.set(k, e);
  }
};
addColors(d.textColors, 1, 'text'); addColors(d.backgrounds, 2, 'bg'); addColors(d.borderColors || [], 0.5, 'border');
for (const b of c.buttons || []) { const p = parse(b.backgroundColor); if (p && p.a > 0.5) addColors([{ value: b.backgroundColor, count: 8 }], 1, 'button'); }
const all = [...weights.values()].map((e) => ({ ...e, ...hsl(e.rgb) })).sort((a, b) => b.count - a.count);
const neutral = (e) => e.s < 0.14;
const saturated = all.filter((e) => !neutral(e) && e.l > 0.12 && e.l < 0.92);
const neutrals = all.filter(neutral);

// roles
const text = all.find((e) => e.tags.has('text') && neutral(e)) || all.find((e) => e.tags.has('text'));
const lightBg = neutrals.filter((e) => e.l > 0.85 && e.tags.has('bg')).sort((a, b) => b.count - a.count)[0];
const background = lightBg || neutrals.find((e) => e.hex === '#ffffff') || { hex: '#ffffff', rgb: { r: 255, g: 255, b: 255 } };
const btnPrimary = (c.buttons || []).map((b) => parse(b.backgroundColor)).find((p) => p && p.a > 0.5 && hsl(p).s > 0.14);
const brand = btnPrimary ? { hex: hex(btnPrimary), rgb: btnPrimary } : saturated[0];
const accent = saturated.find((e) => brand && e.hex !== brand.hex && Math.abs(e.h - hsl(brand.rgb).h) > 25);
const dark = neutrals.filter((e) => e.l < 0.2).sort((a, b) => b.count - a.count)[0];
const colors = {
  brand: brand && brand.hex, accent: accent && accent.hex,
  background: background.hex, surface: neutrals.find((e) => e.l > 0.9 && e.hex !== background.hex)?.hex,
  text: text?.hex, 'text-inverse': dark ? undefined : '#ffffff', 'surface-dark': dark?.hex,
  border: neutrals.find((e) => e.tags.has('border'))?.hex,
};
for (const k of Object.keys(colors)) if (!colors[k]) delete colors[k];
const palette = all.slice(0, 16).map((e) => ({ hex: e.hex, uses: Math.round(e.count), kind: neutral(e) ? 'neutral' : 'chromatic' }));

// contrast audit
const audit = [];
const pair = (name, fg, bg) => { const f = parse(fg), b = parse(bg); if (f && b) audit.push({ name, fg: hex(f), bg: hex(b), ratio: contrast(f, b), pass: contrast(f, b) >= 4.5 }); };
if (text && background) pair('body text on background', text.hex.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)})`), `rgb(${background.rgb.r},${background.rgb.g},${background.rgb.b})`);
for (const b of (c.buttons || []).slice(0, 4)) pair(`button "${b.text}"`, b.color, b.backgroundColor);

// ---- typography ----
const px = (v) => parseFloat(v);
const sizes = [...new Set((d.fontSizes || []).map((s) => px(s.value)).filter(Boolean))].sort((a, b) => a - b);
const t = d.typography || {};
const typeScale = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { size: v.fontSize, weight: v.fontWeight, lineHeight: v.lineHeight, letterSpacing: v.letterSpacing, family: v.fontFamily.split(',')[0].replace(/["']/g, '').trim() }]));
const ratio = sizes.length > 2 ? +(Math.pow(sizes.at(-1) / sizes[0], 1 / (sizes.length - 1))).toFixed(3) : null;
const families = (d.fontFamilies || []).map((f) => f.value);
const fontStack = { heading: typeScale.h1?.family || families[0], body: typeScale.p?.family || families[0], mono: families.find((f) => /mono|code|courier/i.test(f)) };

// ---- spacing: detect base unit ----
const sp = [...new Set((d.spacing || []).map((s) => px(s.value)).filter((n) => n > 0 && n <= 160))].sort((a, b) => a - b);
const base = [4, 8, 6, 5, 10].map((u) => ({ u, fit: sp.filter((n) => n % u < 0.6 || u - (n % u) < 0.6).length })).sort((a, b) => b.fit - a.fit)[0];
const spacing = { baseUnit: base?.u || 8, observed: sp };
const radii = (d.radii || []).map((r) => r.value);
const shadows = (d.shadows || []).map((r) => r.value);
const breakpoints = (d.breakpoints || []).map((b) => b.px).sort((a, b) => a - b);

const tokens = {
  $description: `Extracted from ${site.startUrl} on ${site.crawledAt}`,
  color: colors, palette, typography: { fontStack, scale: typeScale, sizesObserved: sizes, scaleRatio: ratio },
  spacing, radius: radii, shadow: shadows, breakpoints,
  cssVariables: d.cssVars, darkMode: d.darkMode, buttonHover: d.buttonHover, contrastAudit: audit,
};
fs.writeFileSync(path.join(out, 'tokens.json'), JSON.stringify(tokens, null, 2));


// ---- developer formats: W3C Design Tokens + Tailwind snippet ----
const w3c = { color: {}, fontFamily: {}, fontSize: {}, spacing: {}, radius: {}, shadow: {} };
for (const [k, v] of Object.entries(colors)) w3c.color[k] = { $type: 'color', $value: v };
if (fontStack.heading) w3c.fontFamily.heading = { $type: 'fontFamily', $value: [fontStack.heading] };
if (fontStack.body) w3c.fontFamily.body = { $type: 'fontFamily', $value: [fontStack.body] };
for (const [k, v] of Object.entries(typeScale)) w3c.fontSize[k] = { $type: 'dimension', $value: v.size };
sp.slice(0, 10).forEach((n, i) => { w3c.spacing[i + 1] = { $type: 'dimension', $value: n + 'px' }; });
radii.slice(0, 5).forEach((r, i) => { w3c.radius[i + 1] = { $type: 'dimension', $value: r }; });
shadows.slice(0, 4).forEach((x, i) => { w3c.shadow[i + 1] = { $type: 'shadow', $value: x }; });
fs.writeFileSync(path.join(out, 'tokens.w3c.json'), JSON.stringify(w3c, null, 2));
const q = (o) => JSON.stringify(o, null, 6).replace(/"([a-zA-Z_][\w]*)":/g, '$1:');
const tw = `// tailwind.config.js (extracted from ${site.startUrl})
module.exports = {
  theme: {
    extend: {
      colors: ${q(colors)},
      fontFamily: ${q({ heading: fontStack.heading ? [fontStack.heading, 'sans-serif'] : undefined, body: fontStack.body ? [fontStack.body, 'sans-serif'] : undefined })},
      borderRadius: ${q(Object.fromEntries(radii.slice(0, 4).map((r, i) => ['r' + (i + 1), r])))},
      boxShadow: ${q(Object.fromEntries(shadows.slice(0, 3).map((x, i) => ['s' + (i + 1), x])))},
      screens: ${q(Object.fromEntries(breakpoints.map((b) => ['bp' + b, b + 'px'])))},
    },
  },
};
`;
fs.writeFileSync(path.join(out, 'tailwind.config.js'), tw);

// ---- tokens.css ----
const css = [':root {',
  ...Object.entries(colors).map(([k, v]) => `  --color-${k}: ${v};`),
  fontStack.heading ? `  --font-heading: "${fontStack.heading}", sans-serif;` : '', fontStack.body ? `  --font-body: "${fontStack.body}", sans-serif;` : '',
  ...Object.entries(typeScale).map(([k, v]) => `  --text-${k}: ${v.size};`),
  `  --space-unit: ${spacing.baseUnit}px;`, ...sp.slice(0, 8).map((n, i) => `  --space-${i + 1}: ${n}px;`),
  ...radii.slice(0, 4).map((r, i) => `  --radius-${i + 1}: ${r};`), ...shadows.slice(0, 3).map((s, i) => `  --shadow-${i + 1}: ${s};`),
  '}', ...(d.darkMode?.supported ? ['@media (prefers-color-scheme: dark) {', `  :root { --color-background: ${d.darkMode.dark.background}; --color-text: ${d.darkMode.dark.color}; }`, '}'] : []),
].filter(Boolean).join('\n');
fs.writeFileSync(path.join(out, 'tokens.css'), css + '\n');

// ---- components ----
fs.writeFileSync(path.join(out, 'components.json'), JSON.stringify({ buttons: c.buttons, inputs: c.inputs, cards: c.cards, navigation: c.navigation, logo: c.logo, hover: d.buttonHover }, null, 2));

// ---- assets ----
if (fs.existsSync(path.join(dir, 'assets'))) fs.cpSync(path.join(dir, 'assets'), path.join(out, 'assets'), { recursive: true });
// reference screenshots for visual grounding
const shotsDir = path.join(out, 'reference'); fs.mkdirSync(shotsDir, { recursive: true });
for (const p of site.pages.slice(0, 4)) for (const v of ['desktop', 'mobile']) {
  const f = path.join(dir, 'pages', p.slug, `${v}.png`);
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(shotsDir, `${p.slug}-${v}.png`));
}

// ---- README (brand brief for Claude Design) ----
const readme = [
  `# Design system extracted from ${site.startUrl}`, '',
  '> Generated by site-explorer. Observed values, not an official brand guide — treat as a faithful reference to build on.', '',
  '## Colors', ...Object.entries(colors).map(([k, v]) => `- **${k}** \`${v}\``),
  `- Dark mode: ${d.darkMode?.supported ? 'supported (' + d.darkMode.dark.background + ' / ' + d.darkMode.dark.color + ')' : 'not detected'}`, '',
  '## Typography', `- Heading: ${fontStack.heading || '?'}  ·  Body: ${fontStack.body || '?'}${fontStack.mono ? '  ·  Mono: ' + fontStack.mono : ''}`,
  ...Object.entries(typeScale).map(([k, v]) => `- ${k}: ${v.size} / ${v.weight} / lh ${v.lineHeight}`), ratio ? `- Approx. scale ratio ${ratio}` : '', '',
  '## Spacing, shape, depth', `- Base unit ${spacing.baseUnit}px; observed ${sp.join(', ')}`, `- Radius: ${radii.join(', ') || 'square'}`, `- Shadows: ${shadows.join(' | ') || 'flat'}`, `- Breakpoints: ${breakpoints.join(', ') || '?'}`, '',
  '## Components', c.navigation ? `- Nav: ${c.navigation.height}px, ${c.navigation.position}, bg ${c.navigation.backgroundColor}, links: ${c.navigation.links.join(' / ')}` : '',
  ...(c.buttons || []).slice(0, 3).map((b) => `- Button "${b.text}": bg ${b.backgroundColor}, text ${b.color}, radius ${b.borderRadius}, padding ${b.padding}`),
  d.buttonHover ? `- Button hover: ${d.buttonHover.before.backgroundColor} → ${d.buttonHover.after.backgroundColor}` : '', '',
  '## Accessibility', ...audit.map((a) => `- ${a.pass ? '✅' : '⚠️'} ${a.name}: ${a.ratio}:1`), '',
  '## Page structure', ...site.pages.slice(0, 8).map((p) => `- ${p.title || p.url} — ${p.url}`), '',
  '## Files', '- `tokens.json` / `tokens.css` / `tokens.w3c.json` / `tailwind.config.js` — machine-readable tokens (CSS, W3C Design Tokens, Tailwind)', '- `components.json` — component styles', '- `assets/` — logo, favicon, og image', '- `reference/` — desktop and mobile screenshots',
].filter((l) => l !== undefined && l !== null).join('\n');
fs.writeFileSync(path.join(out, 'README.md'), readme + '\n');
console.log('Design bundle written to', out);
console.log(`brand ${colors.brand || '?'} · fonts ${fontStack.heading || '?'} / ${fontStack.body || '?'} · base unit ${spacing.baseUnit}px · ${audit.filter((a) => !a.pass).length} contrast issue(s)`);
