#!/usr/bin/env node
// frameworks — turn the handoff's plain-HTML starter into a runnable React / Vue / Astro project, or a shadcn/ui theme.
//   frameworks.mjs <handoff 資料夾> --to react|vue|astro|shadcn|all [--out <資料夾>]
// Input is OUR OWN generated starter (placeholder text only, validated values), parsed with a small tokenizer — never source-site markup.
// Output: <handoff>/frameworks/<name>/ (a project you `npm install && npm run dev`), each section of each page becomes one component.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isMain } from './util.mjs';
import { isInside } from './safe-out.mjs';

export const TARGETS = ['react', 'vue', 'astro', 'shadcn'];
// Pinned to versions that were built and run end to end when this was written (widely supported majors, Node 18+).
export const VERSIONS = { react: '18.3.1', 'react-dom': '18.3.1', vite: '5.4.21', '@vitejs/plugin-react': '4.7.0', vue: '3.5.43', '@vitejs/plugin-vue': '5.2.4', astro: '4.16.19', three: '0.170.0' };
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

// ------------------------------------------------------------------ tiny HTML parser (our own, well-formed output)
export function parseHtml(html) {
  const root = { tag: '#root', attrs: [], children: [] }, stack = [root];
  const re = /<!--([\s\S]*?)-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(html));) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ comment: m[1].trim() });
    else if (m[2]) { const t = m[2].toLowerCase(); for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === t) { stack.length = i; break; } }
    else if (m[3]) {
      const tag = m[3].toLowerCase(), attrs = [];
      for (const a of m[4].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs.push([a[1], a[2] ?? a[3] ?? a[4] ?? '']);
      const el = { tag, attrs, children: [] }; top.children.push(el);
      if (!VOID.has(tag) && !m[5]) stack.push(el);
    } else if (m[6] && m[6].trim()) top.children.push({ text: m[6].replace(/\s+/g, ' ') });
  }
  return root;
}
const find = (n, tag) => { for (const c of n.children || []) { if (c.tag === tag) return c; const r = c.children && find(c, tag); if (r) return r; } return null; };
const attr = (n, name) => (n.attrs.find(([k]) => k === name) || [])[1];
const safeName = (s) => String(s || '').replace(/[^\w-]/g, '');

/** A page -> { lang, title, sections:[{ name, kind, comment, node }] } (sections = top-level elements of <body>; scripts are ours and are dropped). */
export function pageModel(html) {
  const doc = parseHtml(html); const htmlEl = find(doc, 'html'), body = find(doc, 'body'), titleEl = find(doc, 'title');
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(attr(htmlEl || { attrs: [] }, 'lang') || '') ? attr(htmlEl, 'lang') : 'en';
  const title = ((titleEl?.children || []).map((c) => c.text || '').join('') || 'Page').replace(/ — starter$/, '').replace(/[^\w .,&'-]/g, '').trim() || 'Page';
  const sections = []; let pending = null; const used = new Map();
  for (const c of body?.children || []) {
    if (c.comment !== undefined) { pending = c.comment; continue; }
    if (!c.tag || c.tag === 'script') continue;
    const kind = safeName(attr(c, 'data-section') || c.tag) || 'section';
    let name = kind.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Section';
    if (/^\d/.test(name)) name = 'S' + name;
    const n = (used.get(name) || 0) + 1; used.set(name, n); if (n > 1) name += n;
    sections.push({ name, kind, comment: (pending || '').replace(/\*\/|--+>?/g, ' ').slice(0, 220), node: c }); pending = null;
  }
  return { lang, title, sections };
}

// ------------------------------------------------------------------ serialisers
const ind = (n) => '  '.repeat(n);
const escJsxText = (t) => t.replace(/[{}<>]/g, (c) => `{'${c}'}`);
const escHtmlText = (t) => t.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
const escAttr = (v) => String(v).replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/"/g, '&quot;');
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleObject(css) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of css) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  const props = parts.map((p) => { const i = p.indexOf(':'); return i < 0 ? null : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter((x) => x && /^(--)?[a-zA-Z][\w-]*$/.test(x[0]) && x[1]);
  return '{{ ' + props.map(([k, v]) => `${k.startsWith('--') ? JSON.stringify(k) : camel(k)}: ${JSON.stringify(v)}`).join(', ') + ' }}';
}
const REACT_ATTR = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan', maxlength: 'maxLength', readonly: 'readOnly', autocomplete: 'autoComplete', crossorigin: 'crossOrigin' };
const attrOk = ([k]) => /^[a-zA-Z][\w:-]*$/.test(k) && !/^on/i.test(k); // no event handlers, nothing odd

export function toJsx(node, depth = 0) {
  if (node.text !== undefined) return ind(depth) + escJsxText(node.text.trim());
  if (node.comment !== undefined) return ind(depth) + `{/* ${node.comment.replace(/\*\//g, '* /')} */}`;
  const attrs = node.attrs.filter(attrOk).map(([k, v]) => {
    if (k === 'style') return `style=${styleObject(v)}`;
    const name = REACT_ATTR[k] || k;
    return v === '' && /^(hidden|disabled|checked|required|readonly|autofocus|multiple|selected)$/.test(k) ? name : `${name}="${escAttr(v)}"`;
  });
  const open = `<${node.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(node.tag)) return ind(depth) + open + ' />';
  const kids = node.children.map((c) => toJsx(c, depth + 1)).filter((s) => s.trim());
  if (!kids.length) return ind(depth) + open + `></${node.tag}>`;
  if (kids.length === 1 && node.children[0].text !== undefined) return ind(depth) + `${open}>${kids[0].trim()}</${node.tag}>`;
  return [ind(depth) + open + '>', ...kids, ind(depth) + `</${node.tag}>`].join('\n');
}

export function toHtml(node, depth = 0) {
  if (node.text !== undefined) return ind(depth) + escHtmlText(node.text.trim());
  if (node.comment !== undefined) return ind(depth) + `<!-- ${node.comment.replace(/--+>?/g, ' ')} -->`;
  const attrs = node.attrs.filter(attrOk).map(([k, v]) => (v === '' && /^(hidden|disabled|checked|required|readonly|autofocus|multiple|selected)$/.test(k) ? k : `${k}="${escAttr(v)}"`));
  const open = `<${node.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(node.tag)) return ind(depth) + open + '>';
  const kids = node.children.map((c) => toHtml(c, depth + 1)).filter((s) => s.trim());
  if (!kids.length) return ind(depth) + open + `></${node.tag}>`;
  if (kids.length === 1 && node.children[0].text !== undefined) return ind(depth) + `${open}>${kids[0].trim()}</${node.tag}>`;
  return [ind(depth) + open + '>', ...kids, ind(depth) + `</${node.tag}>`].join('\n');
}

// ------------------------------------------------------------------ shared pieces
const NAV_TOGGLE = `// Mobile navigation toggle (same behaviour as the plain-HTML starter's app.js), written with event delegation so it keeps working
// when the framework re-renders the page.
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target.closest('.nav-toggle') : null; if (!t) return;
  const nav = document.getElementById(t.getAttribute('aria-controls')); if (!nav) return;
  const open = nav.classList.toggle('is-open'); t.setAttribute('aria-expanded', String(open));
});
`;
const pascal = (s) => safeName(s).split(/[-_.]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Page';
const compName = (s) => { const c = pascal(s); return /^[A-Za-z_]/.test(c) ? c : 'P' + c; }; // a JS identifier cannot start with a digit (/404 -> P404)
const routeOf = (file) => (file === 'index' ? '/' : '/' + file);
const read = (f) => fs.readFileSync(f, 'utf8');
const hashDir = (dir) => { const o = {}; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', 'dist', '.astro'].includes(e.name)) walk(f); } else if (e.name !== '.manifest.json' && e.name !== 'package-lock.json') o[path.relative(dir, f).split(path.sep).join('/')] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } }; walk(dir); return o; };

function loadStarter(handoffDir) {
  const sd = path.join(handoffDir, 'starter');
  if (!fs.existsSync(sd)) throw new Error(_t`找不到 ${sd}。請先產生交接包（site-explorer <網址>）。`);
  const files = fs.readdirSync(sd).filter((f) => /\.html$/i.test(f)).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  if (!files.length) throw new Error(_t('starter/ 裡沒有 HTML 頁面。'));
  const pages = files.map((f) => { const file = f.replace(/\.html$/i, ''); return { file, comp: compName(file === 'index' ? 'home' : file), ...pageModel(read(path.join(sd, f))) }; });
  const used = new Set(); for (const p of pages) { let c = p.comp, n = 2; while (used.has(c.toLowerCase())) c = p.comp + n++; p.comp = c; used.add(c.toLowerCase()); } // case-insensitive: Ab / AB collide on macOS and Windows
  const motionDir = path.join(sd, 'motion');
  const tokF = path.join(handoffDir, 'tokens', 'tokens.css'); // styles.css @imports ../tokens/tokens.css: a project is self-contained, so the tokens travel with it
  const tokens = fs.existsSync(tokF) ? read(tokF) : ':root {}\n';
  return { pages, tokens, css: read(path.join(sd, 'styles.css')).replace(/@import\s+url\((['"]?)\.\.\/tokens\/tokens\.css\1\)/, '@import url("./tokens.css")'), motion: fs.existsSync(path.join(motionDir, 'motion.js')) ? { css: read(path.join(motionDir, 'motion.css')), js: read(path.join(motionDir, 'motion.js')) } : null };
}

// ------------------------------------------------------------------ targets: each returns { 'relative/path': content }
function react({ pages, css, tokens, motion }) {
  const out = {};
  out['package.json'] = JSON.stringify({ name: 'site-starter-react', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { react: VERSIONS.react, 'react-dom': VERSIONS['react-dom'], ...(motion ? { three: VERSIONS.three } : {}) }, devDependencies: { vite: VERSIONS.vite, '@vitejs/plugin-react': VERSIONS['@vitejs/plugin-react'] } }, null, 2) + '\n';
  out['vite.config.js'] = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`;
  out['index.html'] = `<!doctype html>\n<html lang="${pages[0].lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0].title} — starter</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n`;
  out['src/styles.css'] = css; out['src/tokens.css'] = tokens; out['src/nav-toggle.js'] = NAV_TOGGLE;
  if (motion) { out['src/motion/motion.css'] = motion.css; out['src/motion/motion.js'] = motion.js; }
  out['src/main.jsx'] = `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\n${motion ? "import './motion/motion.css';\n" : ''}import './nav-toggle.js';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n${motion ? "// The motion starter looks for its elements when it runs, so load it after the first render.\nrequestAnimationFrame(() => import('./motion/motion.js'));\n" : ''}`;
  const routes = pages.map((p) => `  ${JSON.stringify(routeOf(p.file))}: ${p.comp}Page,`).join('\n');
  out['src/App.jsx'] = `${pages.map((p) => `import ${p.comp}Page from './pages/${p.comp}Page.jsx';`).join('\n')}\n\n// Minimal path-based routing so every starter page is reachable. Swap for react-router when you need more.\nconst routes = {\n${routes}\n};\n\nexport default function App() {\n  const Page = routes[location.pathname.replace(/\\/$/, '') || '/'] || routes['/'];\n  return <Page />;\n}\n`;
  for (const p of pages) {
    out[`src/pages/${p.comp}Page.jsx`] = `${p.sections.map((s) => `import ${s.name} from '../components/${p.comp}/${s.name}.jsx';`).join('\n')}\n\nexport default function ${p.comp}Page() {\n  return (\n    <>\n${p.sections.map((s) => `      <${s.name} />`).join('\n')}\n    </>\n  );\n}\n`;
    for (const s of p.sections) out[`src/components/${p.comp}/${s.name}.jsx`] = `${s.comment ? `// ${s.comment}\n` : ''}export default function ${s.name}() {\n  return (\n${toJsx(s.node, 2)}\n  );\n}\n`;
  }
  return out;
}

function vue({ pages, css, tokens, motion }) {
  const out = {};
  out['package.json'] = JSON.stringify({ name: 'site-starter-vue', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { vue: VERSIONS.vue, ...(motion ? { three: VERSIONS.three } : {}) }, devDependencies: { vite: VERSIONS.vite, '@vitejs/plugin-vue': VERSIONS['@vitejs/plugin-vue'] } }, null, 2) + '\n';
  out['vite.config.js'] = `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nexport default defineConfig({ plugins: [vue()] });\n`;
  out['index.html'] = `<!doctype html>\n<html lang="${pages[0].lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pages[0].title} — starter</title>\n</head>\n<body>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`;
  out['src/styles.css'] = css; out['src/tokens.css'] = tokens; out['src/nav-toggle.js'] = NAV_TOGGLE;
  if (motion) { out['src/motion/motion.css'] = motion.css; out['src/motion/motion.js'] = motion.js; }
  out['src/main.js'] = `import { createApp } from 'vue';\nimport App from './App.vue';\nimport './styles.css';\n${motion ? "import './motion/motion.css';\n" : ''}import './nav-toggle.js';\n\ncreateApp(App).mount('#app');\n${motion ? "// The motion starter looks for its elements when it runs, so load it after the first render.\nrequestAnimationFrame(() => import('./motion/motion.js'));\n" : ''}`;
  out['src/App.vue'] = `<script setup>\n${pages.map((p) => `import ${p.comp}Page from './pages/${p.comp}Page.vue';`).join('\n')}\n\n// Minimal path-based routing so every starter page is reachable. Swap for vue-router when you need more.\nconst routes = {\n${pages.map((p) => `  ${JSON.stringify(routeOf(p.file))}: ${p.comp}Page,`).join('\n')}\n};\nconst Page = routes[location.pathname.replace(/\\/$/, '') || '/'] || routes['/'];\n</script>\n\n<template>\n  <component :is="Page" />\n</template>\n`;
  for (const p of pages) {
    out[`src/pages/${p.comp}Page.vue`] = `<script setup>\n${p.sections.map((s) => `import ${s.name} from '../components/${p.comp}/${s.name}.vue';`).join('\n')}\n</script>\n\n<template>\n${p.sections.map((s) => `  <${s.name} />`).join('\n')}\n</template>\n`;
    for (const s of p.sections) out[`src/components/${p.comp}/${s.name}.vue`] = `<template>\n${s.comment ? `  <!-- ${s.comment.replace(/--+>?/g, ' ')} -->\n` : ''}${toHtml(s.node, 1)}\n</template>\n`;
  }
  return out;
}

function astro({ pages, css, tokens, motion }) {
  const out = {};
  out['package.json'] = JSON.stringify({ name: 'site-starter-astro', private: true, type: 'module', scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview' }, dependencies: { astro: VERSIONS.astro, ...(motion ? { three: VERSIONS.three } : {}) } }, null, 2) + '\n';
  out['astro.config.mjs'] = `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`;
  out['src/styles/styles.css'] = css; out['src/styles/tokens.css'] = tokens; out['src/scripts/nav-toggle.js'] = NAV_TOGGLE;
  if (motion) { out['src/styles/motion.css'] = motion.css; out['src/scripts/motion.js'] = motion.js; }
  out['src/layouts/Base.astro'] = `---\nimport '../styles/styles.css';\n${motion ? "import '../styles/motion.css';\n" : ''}const { title = 'Page', lang = 'en' } = Astro.props;\n---\n<!doctype html>\n<html lang={lang}>\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>{title} — starter</title>\n  </head>\n  <body>\n    <slot />\n    <script>\n      import '../scripts/nav-toggle.js';\n${motion ? "      import '../scripts/motion.js';\n" : ''}    </script>\n  </body>\n</html>\n`;
  for (const p of pages) {
    out[`src/pages/${p.file}.astro`] = `---\nimport Base from '../layouts/Base.astro';\n${p.sections.map((s) => `import ${s.name} from '../components/${p.comp}/${s.name}.astro';`).join('\n')}\n---\n<Base title=${JSON.stringify(p.title)} lang=${JSON.stringify(p.lang)}>\n${p.sections.map((s) => `  <${s.name} />`).join('\n')}\n</Base>\n`;
    for (const s of p.sections) out[`src/components/${p.comp}/${s.name}.astro`] = `${s.comment ? `<!-- ${s.comment.replace(/--+>?/g, ' ')} -->\n` : ''}${toHtml(s.node, 0)}\n`;
  }
  return out;
}

// ------------------------------------------------------------------ shadcn/ui theme (CSS variables in the format shadcn components read)
const HEX6 = /^#[0-9a-f]{6}$/i;
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
const hsl = (rgb) => { const [h, s, l] = rgbToHsl(rgb); return `${h} ${s}% ${l}%`; };
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const onColor = (rgb) => (lum(rgb) > 0.55 ? [20, 20, 30] : [255, 255, 255]); // readable text colour on a fill

export function shadcnTheme(tokens, { host = 'site' } = {}) {
  const color = tokens?.color || {}; const pick = (...names) => { for (const n of names) if (HEX6.test(color[n] || '')) return hexToRgb(color[n]); return null; };
  const bg = pick('background', 'surface', 'bg') || [255, 255, 255], fg = pick('text', 'foreground', 'color') || [20, 20, 30];
  const primary = pick('brand', 'primary', 'accent') || fg;
  const darkBg = pick('surface-dark', 'background-dark') || [18, 18, 24], darkFg = pick('text-inverse') || [250, 250, 250];
  const radius = (() => { const m = String((tokens?.radius || []).find((r) => /^\d+(\.\d+)?px$/.test(r) && parseFloat(r) < 100) || '8px').match(/^[\d.]+/); return `${(parseFloat(m[0]) / 16).toFixed(3).replace(/\.?0+$/, '')}rem`; })();
  const fam = (n) => String(tokens?.typography?.fontStack?.[n] || '').replace(/[^\w\s-]/g, '').trim();
  const scheme = (b, f, p) => {
    const secondary = mix(b, f, 0.06), muted = mix(b, f, 0.04), mutedFg = mix(f, b, 0.4), border = mix(b, f, 0.14);
    return [['background', b], ['foreground', f], ['card', b], ['card-foreground', f], ['popover', b], ['popover-foreground', f], ['primary', p], ['primary-foreground', onColor(p)], ['secondary', secondary], ['secondary-foreground', f], ['muted', muted], ['muted-foreground', mutedFg], ['accent', secondary], ['accent-foreground', f], ['destructive', [220, 38, 38]], ['destructive-foreground', [250, 250, 250]], ['border', border], ['input', border], ['ring', p]];
  };
  const block = (sel, rows, extra = '') => `  ${sel} {\n${rows.map(([k, v]) => `    --${k}: ${hsl(v)};`).join('\n')}\n${extra}  }\n`;
  const heading = fam('heading'), body = fam('body');
  const dark = scheme(darkBg, darkFg, lum(primary) < 0.25 ? mix(primary, [255, 255, 255], 0.35) : primary);
  const css = `/* shadcn/ui theme for ${host.replace(/[^\w.-]/g, '')}, derived from the measured colours (brand → primary, background/text → background/foreground).\n   Paste into your global CSS (e.g. app/globals.css) after the Tailwind directives. Values are HSL triplets, as shadcn/ui expects. */\n@layer base {\n${block(':root', scheme(bg, fg, primary), `    --radius: ${radius};\n`)}${block('.dark', dark)}}\n`;
  const snippet = `// tailwind.config.js — merge into theme.extend (shadcn/ui's colour names, driven by the CSS variables above)\nmodule.exports = {\n  darkMode: ['class'],\n  theme: {\n    extend: {\n      colors: {\n${['border', 'input', 'ring', 'background', 'foreground'].map((k) => `        ${k}: 'hsl(var(--${k}))',`).join('\n')}\n${['primary', 'secondary', 'destructive', 'muted', 'accent', 'popover', 'card'].map((k) => `        ${k}: { DEFAULT: 'hsl(var(--${k}))', foreground: 'hsl(var(--${k}-foreground))' },`).join('\n')}\n      },\n      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },\n${heading || body ? `      fontFamily: {\n${body ? `        sans: [${JSON.stringify(body)}, 'system-ui', 'sans-serif'],\n` : ''}${heading ? `        heading: [${JSON.stringify(heading)}, 'system-ui', 'serif'],\n` : ''}      },\n` : ''}    },\n  },\n};\n`;
  return { 'globals-theme.css': css, 'tailwind.config.snippet.js': snippet, 'README.md': `# shadcn/ui theme\n\n1. In a project that already uses shadcn/ui (\`npx shadcn@latest init\`), replace the \`:root\` / \`.dark\` variable blocks in your global CSS with \`globals-theme.css\`.\n2. Merge \`tailwind.config.snippet.js\` into your Tailwind config (\`theme.extend\`).\n3. Components such as Button now use the measured brand colour as \`primary\`.\n\nThe dark palette is derived (the source site ${tokens?.darkMode?.supported ? 'does' : 'does not'} ship a dark mode); review it by eye. Fonts are only named, not loaded: add them yourself.\n` };
}

// ------------------------------------------------------------------ driver
export function generate(handoffDir, to, { outDir } = {}) {
  const targets = to === 'all' ? TARGETS : [to];
  for (const t of targets) if (!TARGETS.includes(t)) throw new Error(_t`--to 必須是 ${TARGETS.join(_t('、'))} 或 all（收到：${to}）`);
  const base = path.resolve(outDir || path.join(handoffDir, 'frameworks'));
  const results = [];
  for (const t of targets) {
    let files;
    if (t === 'shadcn') { const tj = path.join(handoffDir, 'tokens', 'tokens.json'); if (!fs.existsSync(tj)) throw new Error(_t('找不到 tokens/tokens.json')); files = shadcnTheme(JSON.parse(read(tj)), { host: (() => { try { return JSON.parse(read(path.join(handoffDir, 'spec.json'))).meta.name || 'the source site'; } catch { return 'the source site'; } })() }); }
    else { const model = loadStarter(handoffDir); files = { react, vue, astro }[t](model); }
    const dir = path.join(base, t === 'shadcn' ? 'shadcn' : t);
    if (!isInside(dir, base)) throw new Error(_t('輸出路徑不安全'));
    // never overwrite work: an edited (or unrecorded) previous output is moved aside first
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
      let untouched = false; try { const listed = JSON.parse(read(path.join(dir, '.manifest.json'))), now = hashDir(dir); untouched = Object.keys(now).every((k) => listed[k] === now[k]) && Object.keys(listed).every((k) => k in now); } catch {}
      if (!untouched) fs.renameSync(dir, `${dir}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`); else fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const [rel, content] of Object.entries(files)) { const f = path.join(dir, rel); if (!isInside(f, dir)) throw new Error(_t('輸出路徑不安全：') + rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
    if (t !== 'shadcn') fs.writeFileSync(path.join(dir, 'README.md'), `# ${t} starter\n\nGenerated by site-explorer from the handoff's plain-HTML starter: every section of every page is a component, text and images are placeholders, spacing and colours are measured.\n\n\`\`\`bash\nnpm install\nnpm run dev      # development server\nnpm run build    # production build in dist/\n\`\`\`\n\nCompare with the reference images in \`../../media/sections/\` and refine section by section. \`site-explorer verify\` can score a built page against the original.\n`);
    fs.writeFileSync(path.join(dir, '.manifest.json'), JSON.stringify(hashDir(dir), null, 2));
    results.push({ target: t, dir, files: Object.keys(files).length });
  }
  return results;
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : null; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--to', '--out'].includes(a[i - 1]));
  if (!dir || !opt('to')) { console.error(_t`用法：site-explorer framework <交接包資料夾（handoff）> --to ${TARGETS.join('|')}|all [--out <資料夾>]`); process.exit(1); }
  try { for (const r of generate(path.resolve(dir), opt('to'), { outDir: opt('out') })) console.log(_t`✔ ${r.target}：${r.files} 個檔案 → ${r.dir}${r.target === 'shadcn' ? '' : _t('\n   執行：cd "') + r.dir + '" && npm install && npm run dev'}`); }
  catch (e) { console.error('✖ ' + e.message); process.exit(1); }
}
