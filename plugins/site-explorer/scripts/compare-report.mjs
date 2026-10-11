#!/usr/bin/env node
// Side-by-side comparison of two explored sites (competitor / before-after) as one offline HTML file.
//   compare-report.mjs --a <site dir> --b <site dir> [--out ./compare.html]
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const [A, B] = [opt('a'), opt('b')];
if (!A || !B) { console.error('Usage: compare-report.mjs --a <site dir> --b <site dir> [--out compare.html]'); process.exit(1); }
import { requireExtension, UnsafeOutputError } from './safe-out.mjs';
let outFile; try { outFile = requireExtension(opt('out', './compare.html'), /\.html?$/i, '*.html'); } catch (e) { if (e instanceof UnsafeOutputError) { console.error(e.message); process.exit(1); } throw e; }
const outDir = path.dirname(outFile);
const rel = (p) => path.relative(outDir, p).split(path.sep).map(encodeURIComponent).join('/');
const here = path.dirname(fileURLToPath(import.meta.url));

function load(dir) {
  if (!fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('找不到 site.json：') + dir); process.exit(1); }
  const tokPath = path.join(dir, 'design-bundle', 'tokens.json');
  if (!fs.existsSync(tokPath)) spawnSync(process.execPath, [path.join(here, 'export-design.mjs'), dir], { stdio: 'ignore' });
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const tokens = fs.existsSync(tokPath) ? JSON.parse(fs.readFileSync(tokPath, 'utf8')) : null;
  const first = site.pages[0];
  const page = first && fs.existsSync(path.join(dir, 'pages', first.slug, 'page.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'pages', first.slug, 'page.json'), 'utf8')) : null;
  const shot = first && fs.existsSync(path.join(dir, 'pages', first.slug, 'desktop.png')) ? rel(path.join(dir, 'pages', first.slug, 'desktop.png')) : null;
  const mshot = first && fs.existsSync(path.join(dir, 'pages', first.slug, 'mobile.png')) ? rel(path.join(dir, 'pages', first.slug, 'mobile.png')) : null;
  return { host: new URL(site.startUrl).host, site, tokens, blocks: page?.designer?.blocks?.map((b) => ({ kind: b.kind, h: b.h })) || [], shot, mshot };
}
const data = { a: load(A), b: load(B), generatedAt: new Date().toISOString() };

const html = _t`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>網站比較</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#667085;--line:#e4e7ec;--a:#4f46e5;--b:#db2777}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f13;--card:#171a21;--ink:#eef0f4;--mute:#98a2b3;--line:#272b35;--a:#8b85ff;--b:#f472b6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif}
main{max-width:1200px;margin:auto;padding:24px}h1{margin:0 0 4px;font-size:22px}.sub{color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:14px}.card h3{margin:0 0 12px;font-size:13px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hd{font-weight:700;margin-bottom:8px}.A .hd{color:var(--a)}.B .hd{color:var(--b)}
.sw{display:flex;flex-wrap:wrap;gap:8px}.sw button{width:84px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card);padding:0;cursor:pointer;font:11px system-ui;color:var(--ink);text-align:left}.sw i{display:block;height:40px}.sw span{display:block;padding:3px 6px}
.kind{display:inline-block;color:#fff;border-radius:6px;padding:1px 8px;font-size:12px;margin:2px 2px 2px 0}
.row{display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:4px 0;font-size:13px;gap:10px}.row span:first-child{color:var(--mute)}
.diff{background:color-mix(in srgb,#f79009 16%,transparent);border-radius:4px;padding:0 4px}
img.s{width:100%;border:1px solid var(--line);border-radius:8px;max-height:520px;object-fit:cover;object-position:top}
.bar{display:flex;gap:3px;align-items:flex-end;height:70px}.bar i{flex:1;border-radius:3px 3px 0 0;min-width:6px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:99px;opacity:0;transition:.2s}.toast.on{opacity:1}
@media(max-width:700px){.cols{grid-template-columns:1fr}}
</style></head><body><main><h1>⚖️ 網站比較</h1><div class="sub" id="sub"></div><div id="root"></div></main><div class="toast" id="t"></div>
<script id="d" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const D=JSON.parse(document.getElementById('d').textContent),A=D.a,B=D.b;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('sub').innerHTML='<b style="color:var(--a)">A</b> '+esc(A.host)+'　vs　<b style="color:var(--b)">B</b> '+esc(B.host);
const KC={header:'#64748b',hero:'#7c3aed',features:'#2563eb',pricing:'#059669',testimonial:'#d97706',faq:'#0891b2',form:'#db2777',logos:'#475569',stats:'#ca8a04',gallery:'#9333ea',cta:'#dc2626',footer:'#475569',content:'#94a3b8'};
const KN={header:'頁首',hero:'Hero',features:'功能格',pricing:'價格',testimonial:'見證',faq:'FAQ',form:'表單',logos:'Logo 牆',stats:'數據',gallery:'圖庫',cta:'CTA',footer:'頁尾',content:'內容'};
const copy=v=>{navigator.clipboard&&navigator.clipboard.writeText(v);const t=document.getElementById('t');t.textContent='已複製 '+v;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1200)};
const two=(f)=>'<div class="cols"><div class="A"><div class="hd">A · '+esc(A.host)+'</div>'+f(A)+'</div><div class="B"><div class="hd">B · '+esc(B.host)+'</div>'+f(B)+'</div></div>';
const card=(t,b)=>'<div class="card"><h3>'+t+'</h3>'+b+'</div>';
const get=(x,path)=>path.split('.').reduce((o,k)=>o&&o[k],x);
const rowPair=(label,fa,fb)=>{const a=fa(A),b=fb?fb(B):fa(B);return [label,a,b]};
const root=document.getElementById('root');
let h='';
h+=card('首頁',two(x=>x.shot?'<img class="s" src="'+x.shot+'">':'<span class="sub">無截圖</span>'));
h+=card('色彩角色（點擊複製）',two(x=>'<div class="sw">'+Object.entries((x.tokens&&x.tokens.color)||{}).map(([k,v])=>'<button data-c="'+v+'"><i style="background:'+v+'"></i><span><b>'+esc(k)+'</b><br>'+v+'</span></button>').join('')+'</div>'));
h+=card('字型',two(x=>{const t=x.tokens&&x.tokens.typography;if(!t)return '—';return '<div style="font:700 30px/1.15 \\''+esc(t.fontStack.heading||'')+'\\',system-ui">Aa 標題 Heading</div><div style="font:400 16px \\''+esc(t.fontStack.body||'')+'\\',system-ui;margin-top:6px">The quick brown fox 內文範例</div><p class="sub">'+esc(t.fontStack.heading||'?')+' / '+esc(t.fontStack.body||'?')+'</p>'+(t.sources||[]).map(s=>'<div class="row"><span>'+esc(s.family)+'</span><span>'+esc(s.provider)+(s.substitute?' → '+esc(s.substitute):'')+'</span></div>').join('')}));
h+=card('頁面骨架',two(x=>(x.blocks.length?'<div class="bar">'+x.blocks.map(b=>'<i title="'+esc(KN[b.kind]||b.kind)+' '+b.h+'px" style="height:'+Math.max(8,Math.min(70,b.h/12))+'px;background:'+(KC[b.kind]||'#94a3b8')+'"></i>').join('')+'</div><div style="margin-top:8px">'+x.blocks.map(b=>'<span class="kind" style="background:'+(KC[b.kind]||'#94a3b8')+'">'+esc(KN[b.kind]||b.kind)+'</span>').join('')+'</div>':'<span class="sub">無資料</span>')));
const metrics=[
 ['間距基準',x=>x.tokens?x.tokens.spacing.baseUnit+'px':'—'],['圓角',x=>x.tokens?(x.tokens.radius.slice(0,3).join(', ')||'直角'):'—'],['陰影',x=>x.tokens?(x.tokens.shadow.length?x.tokens.shadow.length+' 種':'平面'):'—'],
 ['容器寬',x=>{const g=x.site.designer&&x.site.designer.grid;return g&&g.containerWidths.length?g.containerWidths.map(c=>c.px+'px').join(' / '):'—'}],['網格欄數',x=>{const g=x.site.designer&&x.site.designer.grid;return g&&g.columns.length?g.columns.map(c=>c.columns).join(' / '):'—'}],
 ['動態',x=>{const m=x.site.designer&&x.site.designer.motion;return m&&m.transitions.length?m.transitions[0].token:'無'}],['深色模式',x=>x.tokens&&x.tokens.darkMode&&x.tokens.darkMode.supported?'有':'無'],
 ['對比不足',x=>{const c=x.site.designer&&x.site.designer.contrast;return c?c.failing.length+' 組':'—'}],['平台',x=>x.site.editing.platforms.map(p=>p.platform).join(', ')||'未知'],['頁數',x=>x.site.pages.length],['斷點',x=>x.tokens&&x.tokens.breakpoints.length?x.tokens.breakpoints.join(', '):'—']];
h+=card('數據對照',metrics.map(([l,f])=>{const a=String(f(A)),b=String(f(B));const d=a!==b;return '<div class="row"><span>'+l+'</span><span><b style="color:var(--a)">A</b> <span class="'+(d?'diff':'')+'">'+esc(a)+'</span>　<b style="color:var(--b)">B</b> <span class="'+(d?'diff':'')+'">'+esc(b)+'</span></span></div>'}).join('')+'<p class="sub">橘色底表示兩者不同。</p>');
h+=card('行動呼籲文案',two(x=>{const c=x.site.designer&&x.site.designer.copy;return c&&c.ctas.length?c.ctas.map(t=>'<span class="kind" style="background:#64748b">'+esc(t.text)+'</span>').join(''):'—'}));
h+=card('手機版',two(x=>x.mshot?'<img class="s" style="max-width:240px" src="'+x.mshot+'">':'—'));
root.innerHTML=h;
root.addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(b)copy(b.dataset.c)});
</script></body></html>`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log('Comparison:', outFile);
