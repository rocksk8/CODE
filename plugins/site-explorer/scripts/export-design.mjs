#!/usr/bin/env node
// Convert a crawl result (site.json) into a design-system bundle that Claude Design can ingest:
//   tokens.json (colors by role, type scale, spacing scale, radius, shadow, breakpoints),
//   tokens.css, components.json, README.md (brand brief), assets/
import { _t } from './i18n.mjs';
import { BANNER, sanitizeDoc } from './untrusted.mjs';
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
// body text colour = what real paragraphs use (frequency alone is fooled by white text on dark sections)
const t0 = d.typography || {};
const pc = [t0.p?.color, t0.li?.color, t0.h2?.color, t0.h1?.color].map(parse).find((x) => x && x.a > 0.5);
let text = pc ? { hex: hex(pc), rgb: pc } : all.find((e) => e.tags.has('text') && neutral(e)) || all.find((e) => e.tags.has('text'));
const lightBg = neutrals.filter((e) => e.l > 0.85 && e.tags.has('bg')).sort((a, b) => b.count - a.count)[0];
const background = lightBg || neutrals.find((e) => e.hex === '#ffffff') || { hex: '#ffffff', rgb: { r: 255, g: 255, b: 255 } };
// a "body text" colour that cannot be read on the page background (the first paragraph is white because it sits in a dark hero, say) is not the body colour:
// take the most used text colour that is readable on the background, else a safe near-black / white
if (text && contrast(text.rgb, background.rgb) < 3) {
  const readable = all.filter((e) => e.tags.has('text') && contrast(e.rgb, background.rgb) >= 4.5).sort((a, b) => b.count - a.count)[0];
  text = readable || (lum(background.rgb) > 0.5 ? { hex: '#111111', rgb: { r: 17, g: 17, b: 17 } } : { hex: '#ffffff', rgb: { r: 255, g: 255, b: 255 } });
}
const btnPrimary = (c.buttons || []).map((b) => parse(b.backgroundColor)).find((p) => p && p.a > 0.5 && hsl(p).s > 0.14);
const brand = btnPrimary ? { hex: hex(btnPrimary), rgb: btnPrimary } : saturated[0];
const accent = saturated.find((e) => brand && e.hex !== brand.hex && Math.abs(e.h - hsl(brand.rgb).h) > 25);
const dark = all.filter((e) => e.tags.has('bg') && e.l < 0.2).sort((a, b) => b.count - a.count)[0];
const colors = {
  brand: brand && brand.hex, accent: accent && accent.hex,
  background: background.hex, surface: neutrals.find((e) => e.l > 0.9 && e.hex !== background.hex)?.hex,
  text: text?.hex, 'text-inverse': dark ? '#ffffff' : undefined, 'surface-dark': dark?.hex,
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

// ---- fonts: where they come from, and what to use if you cannot license them ----
const SYSTEM = /^(arial|helvetica|georgia|times|times new roman|verdana|tahoma|trebuchet ms|courier new|courier|system-ui|-apple-system|blinkmacsystemfont|segoe ui|menlo|monaco|consolas|sans-serif|serif|monospace|ui-[a-z-]+|sf pro[a-z ]*|san francisco|apple color emoji|noto sans|lucida grande)$/i;
const SUBSTITUTES = { 'helvetica neue': 'Inter', helvetica: 'Inter', arial: 'Arimo', 'sf pro': 'Inter', 'proxima nova': 'Montserrat', gotham: 'Montserrat', avenir: 'Nunito Sans', 'avenir next': 'Nunito Sans', futura: 'Jost', 'circular': 'DM Sans', 'circular std': 'DM Sans', din: 'Barlow', 'din next': 'Barlow', garamond: 'EB Garamond', 'adobe garamond': 'EB Garamond', baskerville: 'Libre Baskerville', 'minion pro': 'Crimson Pro', 'freight text': 'Source Serif 4', georgia: 'Gelasio', 'times new roman': 'Tinos', gill: 'Lato', 'gill sans': 'Lato', 'trade gothic': 'Archivo', 'akzidenz-grotesk': 'Inter', 'neue haas grotesk': 'Inter', 'graphik': 'Inter', 'söhne': 'Inter', 'sohne': 'Inter', 'gt walsheim': 'Poppins', 'brandon grotesque': 'Montserrat', 'museo': 'Zilla Slab', 'franklin gothic': 'Libre Franklin', 'univers': 'Inter', 'frutiger': 'Open Sans', 'myriad pro': 'Source Sans 3', 'calibre': 'Inter', 'sharp sans': 'Plus Jakarta Sans', 'apercu': 'DM Sans', 'canela': 'Fraunces', 'tiempos': 'Newsreader', 'ivar': 'Fraunces' };
const dz = site.designer || {};
const faces = dz.fonts?.faces || [], gfam = new Set((dz.fonts?.googleFamilies || []).map((f) => f.toLowerCase()));
const hasLink = (re) => (dz.fonts?.links || []).some((l) => re.test(l));
const fontNames = [...new Set([fontStack.heading, fontStack.body, fontStack.mono, ...(d.fontFamilies || []).map((f) => f.value)].filter(Boolean))];
const gUrl = (n) => 'https://fonts.google.com/specimen/' + encodeURIComponent(n).replace(/%20/g, '+');
const SERIF_RE = /georgia|playfair|times|garamond|merriweather|lora|baskerville|tinos|gelasio|crimson|source serif|newsreader|fraunces|cormorant|libre bask|dm serif|canela|tiempos|serif(?!.*sans)/i;
const safeName = (f) => String(f).replace(/[^\w\s.,'()\-\u3400-\u9fff]/g, '').slice(0, 60); // a hostile font-family must not be able to break out of the CSS value
const generic = (f) => (/mono|code|courier|menlo|consolas/i.test(f) ? 'ui-monospace, monospace' : SERIF_RE.test(f) && !/sans/i.test(f) ? 'serif' : 'sans-serif');
const fontSources = fontNames.map((family) => {
  const key = family.toLowerCase(), face = faces.find((f) => f.family.toLowerCase() === key);
  let provider = 'unknown';
  if (gfam.has(key) || (face && /fonts\.gstatic\.com/.test(face.src))) provider = 'google';
  else if (SYSTEM.test(family)) provider = 'system';
  else if (face) provider = /typekit|adobe/.test(face.src) ? 'adobe' : 'self-hosted';
  else if (hasLink(/typekit|fonts\.adobe/)) provider = 'adobe';
  const out = { family, provider, weights: [...new Set(faces.filter((f) => f.family.toLowerCase() === key).map((f) => f.weight))] };
  if (provider === 'google') out.url = gUrl(family);
  if (provider !== 'google' && provider !== 'system') { const sub = SUBSTITUTES[key] || SUBSTITUTES[key.replace(/\s*(pro|std|next|display|text|ui)$/i, '')]; if (sub) { out.substitute = sub; out.substituteUrl = gUrl(sub); } }
  if (provider === 'system') { const sub = SUBSTITUTES[key]; if (sub) { out.substitute = sub; out.substituteUrl = gUrl(sub); out.note = _t('系統字體，各平台外觀不同；要跨平台一致可改用此替代'); } }
  return out;
});
tokens.typography.sources = fontSources;
tokens.motion = dz.motion; tokens.layoutGrid = dz.grid; tokens.copy = dz.copy;
tokens.contrastReal = dz.contrast;
fs.writeFileSync(path.join(out, 'tokens.json'), JSON.stringify(tokens, null, 2));

// ---- Tokens Studio (Figma plugin) ----
const ts = { global: { color: {}, fontFamilies: {}, fontSizes: {}, fontWeights: {}, spacing: {}, borderRadius: {}, boxShadow: {} }, $themes: [], $metadata: { tokenSetOrder: ['global'] } };
for (const [k, v] of Object.entries(colors)) ts.global.color[k] = { value: v, type: 'color' };
if (fontStack.heading) ts.global.fontFamilies.heading = { value: fontStack.heading, type: 'fontFamilies' };
if (fontStack.body) ts.global.fontFamilies.body = { value: fontStack.body, type: 'fontFamilies' };
for (const [k, v] of Object.entries(typeScale)) { ts.global.fontSizes[k] = { value: String(px(v.size)), type: 'fontSizes' }; ts.global.fontWeights[k] = { value: String(v.weight), type: 'fontWeights' }; }
sp.slice(0, 10).forEach((n, i) => { ts.global.spacing[String(i + 1)] = { value: String(n), type: 'spacing' }; });
radii.slice(0, 5).forEach((r, i) => { ts.global.borderRadius[String(i + 1)] = { value: String(px(r) || r), type: 'borderRadius' }; });
shadows.slice(0, 4).forEach((x, i) => { ts.global.boxShadow[String(i + 1)] = { value: x, type: 'boxShadow' }; });
fs.writeFileSync(path.join(out, 'tokens.studio.json'), JSON.stringify(ts, null, 2));

// ---- palette.svg: drag into Figma / Illustrator / Keynote ----
{
  const sw = [...Object.entries(colors).map(([k, v]) => ({ name: k, hex: v })), ...palette.filter((p) => !Object.values(colors).includes(p.hex)).slice(0, 12).map((p) => ({ name: p.kind, hex: p.hex }))];
  const W = 160, H = 130, cols = 6, rows = Math.ceil(sw.length / cols), esc2 = (t) => String(t).replace(/[&<>]/g, '');
  const ink = (h) => (lum(parse(`rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`)) > 0.4 ? '#14141f' : '#ffffff');
  const cells = sw.map((c, i) => `<g transform="translate(${(i % cols) * (W + 8) + 8},${Math.floor(i / cols) * (H + 8) + 8})"><rect width="${W}" height="${H}" rx="10" fill="${c.hex}" stroke="#00000022"/><text x="12" y="${H - 34}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="${ink(c.hex)}">${esc2(c.name)}</text><text x="12" y="${H - 14}" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="${ink(c.hex)}">${c.hex}</text></g>`).join('');
  fs.writeFileSync(path.join(out, 'palette.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * (W + 8) + 8}" height="${rows * (H + 8) + 8}" viewBox="0 0 ${cols * (W + 8) + 8} ${rows * (H + 8) + 8}">${cells}</svg>\n`);
}


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
  fontStack.heading ? `  --font-heading: "${safeName(fontStack.heading)}", ${generic(fontStack.heading)};` : '', fontStack.body ? `  --font-body: "${safeName(fontStack.body)}", ${generic(fontStack.body)};` : '',
  ...Object.entries(typeScale).map(([k, v]) => `  --text-${k}: ${v.size};`),
  `  --space-unit: ${spacing.baseUnit}px;`, ...sp.slice(0, 8).map((n, i) => `  --space-${i + 1}: ${n}px;`),
  ...radii.slice(0, 4).map((r, i) => `  --radius-${i + 1}: ${r};`), ...shadows.slice(0, 3).map((s, i) => `  --shadow-${i + 1}: ${s};`),
  '}', ...(d.darkMode?.supported ? ['@media (prefers-color-scheme: dark) {', `  :root { --color-background: ${d.darkMode.dark.background}; --color-text: ${d.darkMode.dark.color}; }`, '}'] : []),
].filter(Boolean).join('\n');
fs.writeFileSync(path.join(out, 'tokens.css'), sanitizeDoc(css) + '\n');

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
  '## Font sources', ...fontSources.map((f) => `- ${f.family} — ${({ google: _t('Google Fonts（可免費使用）'), system: _t('系統字體'), adobe: _t('Adobe Fonts（需授權）'), 'self-hosted': _t('自架字型檔（可能需授權）'), unknown: _t('來源不明') })[f.provider]}${f.substitute ? _t`；替代建議：${f.substitute}` : ''}`), '',
  '## Layout grid & motion', dz.grid ? `- Container: ${(dz.grid.containerWidths || []).map((x) => x.px + 'px').join(', ') || '?'} · columns: ${(dz.grid.columns || []).map((x) => x.columns).join(', ') || '?'} · gutter: ${(dz.grid.gaps || []).map((x) => x.value).join(', ') || '?'}` : '', ...((dz.motion?.transitions || []).slice(0, 4).map((m) => `- Transition ${m.token} ×${m.count}`)), '',
  ...(dz.contrast?.failing?.length ? ['## Real-background contrast issues', ...dz.contrast.failing.slice(0, 6).map((c) => `- ${c.fg} on ${c.bg} = ${c.ratio}:1 (needs ${c.need}) ×${c.count} — "${c.sample}"${c.uncertain ? ' (background image: verify manually)' : ''}`), ''] : []),
  '## Accessibility', ...audit.map((a) => `- ${a.pass ? '✅' : '⚠️'} ${a.name}: ${a.ratio}:1`), '',
  '## Page structure', ...site.pages.slice(0, 8).map((p) => `- ${p.title || p.url} — ${p.url}`), '',
  '## Files', '- `tokens.json` / `tokens.css` / `tokens.w3c.json` / `tailwind.config.js` — machine-readable tokens (CSS, W3C Design Tokens, Tailwind)', '- `tokens.studio.json` — import with the Tokens Studio plugin in Figma', '- `palette.svg` — drag into Figma / Illustrator / Keynote', '- `components.json` — component styles', '- `assets/` — logo, favicon, og image', '- `reference/` — desktop and mobile screenshots',
].filter((l) => l !== undefined && l !== null).join('\n');
fs.writeFileSync(path.join(out, 'README.md'), BANNER + '\n\n' + sanitizeDoc(readme) + '\n');
console.log('Design bundle written to', out);
console.log(`brand ${colors.brand || '?'} · fonts ${fontStack.heading || '?'} / ${fontStack.body || '?'} · base unit ${spacing.baseUnit}px · ${audit.filter((a) => !a.pass).length} contrast issue(s)`);
