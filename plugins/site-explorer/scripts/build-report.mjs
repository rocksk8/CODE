#!/usr/bin/env node
// Build a single-page visual dashboard (offline, no CDN) from crawl + motion + design outputs.
//   node build-report.mjs --site ./site-report/<host> [--motion ./motion-report/<host>] [--out ./dashboard.html]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const siteDir = opt('site'), motionDir = opt('motion');
if (!siteDir && !motionDir) { console.error('Usage: build-report.mjs --site <crawl dir> [--motion <motion dir>] [--out dashboard.html]'); process.exit(1); }
const outFile = path.resolve(opt('out', './dashboard.html'));
const outDir = path.dirname(outFile);
const rel = (p) => path.relative(outDir, p).split(path.sep).map(encodeURIComponent).join('/');
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = fs.existsSync;

const data = { generatedAt: new Date().toISOString(), site: null, tokens: null, pages: [], motion: null };

if (siteDir && exists(path.join(siteDir, 'site.json'))) {
  data.site = readJSON(path.join(siteDir, 'site.json'));
  const tok = path.join(siteDir, 'design-bundle', 'tokens.json');
  if (!exists(tok)) spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-design.mjs'), siteDir], { stdio: 'ignore' });
  if (exists(tok)) data.tokens = readJSON(tok);
  for (const p of data.site.pages) {
    const pj = path.join(siteDir, 'pages', p.slug, 'page.json');
    if (!exists(pj)) continue;
    const full = readJSON(pj);
    const shot = (v) => (exists(path.join(siteDir, 'pages', p.slug, v + '.png')) ? rel(path.join(siteDir, 'pages', p.slug, v + '.png')) : null);
    data.pages.push({
      slug: p.slug, url: p.url, title: p.title, status: p.status, docHeight: full.layout.docHeight,
      headings: full.content.headings.slice(0, 60), paragraphs: full.content.paragraphs.slice(0, 6),
      images: full.content.images.slice(0, 24), linkCount: full.content.links.length, forms: full.content.forms,
      sections: full.layout.sections, landmarks: full.layout.landmarks, shots: { desktop: shot('desktop'), tablet: shot('tablet'), mobile: shot('mobile') },
      mobileOverflow: full.layout.mobileOverflow,
    });
  }
  if (data.site.assets) data.site.assets = data.site.assets.map((a) => ({ ...a, src: rel(path.join(siteDir, a.file)) }));
}
if (motionDir && exists(path.join(motionDir, 'motion.json'))) {
  const m = readJSON(path.join(motionDir, 'motion.json'));
  const list = (d) => (exists(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort().map((f) => rel(path.join(d, f))) : []);
  for (const t of m.targets) {
    const d = path.join(motionDir, 'frames', t.id);
    t.frames = { idle: list(d).filter((f) => /idle-/.test(f)), hover: list(d).filter((f) => /hover-/.test(f)), drag: list(d).filter((f) => /drag-/.test(f)) };
  }
  m.scroll = list(path.join(motionDir, 'frames', 'scroll'));
  if (m.video) m.video = rel(path.join(motionDir, m.video));
  data.motion = m;
}

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Explorer 報告</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#667085;--line:#e4e7ec;--acc:#4f46e5;--ok:#12b76a;--warn:#f79009}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f13;--card:#171a21;--ink:#eef0f4;--mute:#98a2b3;--line:#272b35;--acc:#8b85ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif}
header{padding:28px 24px 12px;max-width:1200px;margin:auto}h1{margin:0 0 4px;font-size:22px}.sub{color:var(--mute);word-break:break-all}
nav{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
nav .in{max-width:1200px;margin:auto;padding:0 24px;display:flex;gap:4px;overflow-x:auto}
nav button{border:0;background:none;color:var(--mute);padding:12px 14px;font:inherit;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
nav button[aria-selected=true]{color:var(--ink);border-color:var(--acc);font-weight:600}
main{max-width:1200px;margin:auto;padding:20px 24px 80px}section{display:none}section.on{display:block}
.grid{display:grid;gap:14px}.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.card h3{margin:0 0 10px;font-size:13px;color:var(--mute);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.big{font-size:26px;font-weight:700}.chip{display:inline-block;padding:2px 10px;border-radius:99px;background:color-mix(in srgb,var(--acc) 14%,transparent);color:var(--acc);font-size:12px;margin:2px 4px 2px 0}
.chip.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}.chip.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.say{font-size:16px;margin:0 0 8px}.hint{color:var(--mute);font-size:13px}
.sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}.sw button{border:1px solid var(--line);border-radius:10px;overflow:hidden;padding:0;background:var(--card);cursor:pointer;text-align:left;font:inherit;color:var(--ink)}
.sw i{display:block;height:64px}.sw span{display:block;padding:6px 8px;font-size:12px}.sw b{display:block;font-size:12px}
.spec{display:flex;gap:16px;align-items:baseline;border-bottom:1px solid var(--line);padding:8px 0}.spec small{width:90px;color:var(--mute);flex:none}
.bars div{display:flex;align-items:center;gap:10px;margin:4px 0;font-size:12px}.bars i{display:block;height:14px;background:var(--acc);border-radius:3px}
.shapes{display:flex;flex-wrap:wrap;gap:14px}.shapes div{width:84px;height:64px;background:var(--bg);border:2px solid var(--acc);display:grid;place-items:center;font-size:11px;text-align:center}
.shadows div{width:110px;height:70px;background:var(--card);display:grid;place-items:center;font-size:11px;border-radius:8px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:0 8px 10px 0}.seg button{border:0;background:var(--card);color:var(--ink);padding:6px 14px;font:inherit;cursor:pointer}.seg button[aria-pressed=true]{background:var(--acc);color:#fff}
select{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;max-width:100%}
.shot{display:flex;gap:18px;align-items:flex-start}.frame{flex:1;max-height:760px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:#888}.frame img{display:block;margin:auto;max-width:100%}
.map{width:150px;flex:none;position:sticky;top:60px}.map div{border:1px solid var(--line);margin-bottom:2px;font-size:10px;padding:2px 4px;background:var(--card);overflow:hidden;border-radius:3px;cursor:default}
.film{display:flex;gap:6px;overflow-x:auto;padding:6px 0}.film img{height:110px;border-radius:6px;border:1px solid var(--line);cursor:pointer}.film img.cur{outline:3px solid var(--acc)}
.player{display:flex;gap:16px;flex-wrap:wrap}.stage{background:#000;border-radius:10px;min-width:280px;flex:1;display:grid;place-items:center;overflow:hidden}.stage img{max-width:100%;max-height:420px;display:block}
.ctrl{display:flex;gap:10px;align-items:center;margin-top:8px}.ctrl input[type=range]{flex:1}.ctrl button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:5px 12px;cursor:pointer;font:inherit}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
.h{padding-left:calc(var(--l)*16px);color:var(--ink)}.h em{font-style:normal;color:var(--mute);font-size:11px;margin-right:6px}
.imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.imgs img{width:100%;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font-size:12px;max-height:200px}details summary{cursor:pointer;color:var(--acc)}
.empty{color:var(--mute);padding:30px;text-align:center}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:99px;opacity:0;transition:.2s;pointer-events:none}.toast.on{opacity:1}
@media(max-width:700px){.shot{flex-direction:column}.map{display:none}}
</style></head><body>
<header><h1>🔍 網站探索報告</h1><div class="sub" id="sub"></div></header>
<nav><div class="in" id="tabs"></div></nav>
<main>
<section id="s-overview"></section><section id="s-design"></section><section id="s-layout"></section>
<section id="s-content"></section><section id="s-motion"></section><section id="s-edit"></section>
</main><div class="toast" id="toast"></div>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const $=(s,r=document)=>r.querySelector(s),el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstChild};
const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const T=D.tokens,S=D.site,M=D.motion;
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1400)};
const copy=(v)=>{navigator.clipboard?.writeText(v);toast('已複製 '+v)};
$('#sub').textContent=(S?.startUrl||M?.url||'')+' · '+new Date(D.generatedAt).toLocaleString();

const tabs=[['overview','總覽'],['design','設計'],['layout','排版'],['content','內容'],['motion','3D／動畫'],['edit','編輯方式']].filter(([k])=>k==='overview'||(k==='motion'?M:S));
tabs.forEach(([k,l],i)=>{const b=el('<button role="tab">'+l+'</button>');b.dataset.k=k;b.onclick=()=>show(k);$('#tabs').append(b)});
function show(k){document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id==='s-'+k));document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.k===k));history.replaceState(null,'','#'+k)}

// ---------- overview ----------
(function(){
  const o=$('#s-overview');const c=T?.color||{};const plat=S?.editing?.platforms||[];
  const ms=M?M.targets.length:0;
  const sentences=[];
  if(S){sentences.push('共探索 <b>'+S.pages.length+'</b> 頁，'+(plat.length?'偵測到 <b>'+plat.map(p=>esc(p.platform)).join('、')+'</b> 建站特徵':'未偵測到常見建站平台（可能是自訂程式或靜態站）')+'。');}
  if(T){sentences.push('主色 <b style="color:'+(c.brand||'inherit')+'">'+esc(c.brand||'—')+'</b>，標題字型 <b>'+esc(T.typography.fontStack.heading||'?')+'</b>，間距以 <b>'+T.spacing.baseUnit+'px</b> 為基準。');}
  if(M){sentences.push(ms?'發現 <b>'+ms+'</b> 個 3D／動畫元素'+(Object.entries(M.libs).filter(([,v])=>v===true).length?'，使用 '+Object.entries(M.libs).filter(([,v])=>v===true).map(([k])=>'<b>'+k+'</b>').join('、'):'')+'。':'沒有發現 3D 或動畫元素。');}
  o.innerHTML='<div class="grid g3">'+
   (S?'<div class="card"><h3>頁面</h3><div class="big">'+S.pages.length+'</div><div class="hint">耗時 '+S.seconds+' 秒</div></div>':'')+
   (T?'<div class="card"><h3>色彩</h3><div class="big">'+T.palette.length+'</div><div class="hint">'+Object.keys(c).length+' 個角色色</div></div>':'')+
   (M?'<div class="card"><h3>3D／動畫</h3><div class="big">'+ms+'</div><div class="hint">WebGL 實例 '+M.webglContexts.length+'・3D 素材 '+M.assets3d.length+'</div></div>':'')+
   (plat.length?'<div class="card"><h3>平台</h3><div class="big" style="font-size:20px">'+plat.map(p=>esc(p.platform)).join(' / ')+'</div></div>':'')+
  '</div><div class="card" style="margin-top:14px"><h3>重點摘要</h3>'+sentences.map(s=>'<p class="say">'+s+'</p>').join('')+'</div>'+
  (T?'<div class="card" style="margin-top:14px"><h3>色彩速覽</h3><div style="display:flex;height:44px;border-radius:8px;overflow:hidden">'+T.palette.slice(0,10).map(p=>'<div title="'+p.hex+'" style="flex:'+Math.max(1,Math.log2(p.uses+1))+';background:'+p.hex+'"></div>').join('')+'</div></div>':'')+
  (S?.assets?.length?'<div class="card" style="margin-top:14px"><h3>品牌素材</h3><div class="imgs">'+S.assets.map(a=>'<div><img src="'+a.src+'" style="object-fit:contain;background:#8884"><div class="hint">'+esc(a.name)+'</div></div>').join('')+'</div></div>':'');
})();

// ---------- design ----------
(function(){
  if(!T)return;const d=$('#s-design');const c=T.color;
  const role={brand:'品牌色',accent:'輔助色',background:'背景',surface:'表面','surface-dark':'深色表面',text:'文字',border:'邊框','text-inverse':'反白文字'};
  const sw=(hex,name,sub)=>'<button onclick="copy(\\''+hex+'\\')"><i style="background:'+hex+'"></i><span><b>'+esc(name)+'</b>'+hex+(sub?' · '+sub:'')+'</span></button>';
  const type=Object.entries(T.typography.scale).map(([k,v])=>'<div class="spec"><small>'+k+' · '+v.size+'<br>'+v.weight+'</small><span style="font:'+v.weight+' '+v.size+'/'+(v.lineHeight==='normal'?'1.3':v.lineHeight)+' '+v.family+',system-ui;letter-spacing:'+v.letterSpacing+'">The quick brown fox 設計範例 123</span></div>').join('');
  const sp=T.spacing.observed;const maxSp=Math.max(...sp,1);
  const btns=(window.__b=(S?.components?.buttons||[]).slice(0,4));
  const audit=T.contrastAudit||[];
  d.innerHTML='<div class="card"><h3>色彩角色（點擊複製）</h3><div class="sw">'+Object.entries(c).map(([k,v])=>sw(v,role[k]||k)).join('')+'</div>'+
   '<h3 style="margin-top:18px">完整色盤</h3><div class="sw">'+T.palette.map(p=>sw(p.hex,p.kind==='neutral'?'中性':'彩色',p.uses+'次')).join('')+'</div></div>'+
   '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>字型階層（實際渲染）</h3>'+type+'<p class="hint">標題：'+esc(T.typography.fontStack.heading)+'・內文：'+esc(T.typography.fontStack.body)+(T.typography.scaleRatio?'・級距比 ≈ '+T.typography.scaleRatio:'')+'</p></div>'+
   '<div class="card"><h3>間距（基準 '+T.spacing.baseUnit+'px）</h3><div class="bars">'+sp.map(n=>'<div><span style="width:46px">'+n+'px</span><i style="width:'+(n/maxSp*100)+'%"></i></div>').join('')+'</div>'+
   '<h3 style="margin-top:18px">圓角</h3><div class="shapes">'+(T.radius.length?T.radius.map(r=>'<div style="border-radius:'+r+'">'+r+'</div>').join(''):'<span class="hint">直角設計</span>')+'</div>'+
   '<h3 style="margin-top:18px">陰影</h3><div class="shapes shadows">'+(T.shadow.length?T.shadow.map(s=>'<div style="box-shadow:'+s+'">陰影</div>').join(''):'<span class="hint">平面設計</span>')+'</div></div></div>'+
   '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>按鈕（滑過看 hover）</h3>'+(btns.length?btns.map(b=>'<button style="margin:4px;cursor:pointer;background:'+b.backgroundColor+';color:'+b.color+';border:'+(parseFloat(b.borderTopWidth)?b.borderTopWidth+' solid '+b.borderTopColor:'0')+';border-radius:'+b.borderRadius+';padding:'+b.padding+';font:'+b.fontWeight+' '+b.fontSize+' '+b.fontFamily+';transition:filter .15s" onmouseover="this.style.filter=\\'brightness(.88)\\'" onmouseout="this.style.filter=\\'\\'">'+esc(b.text||'按鈕')+'</button>').join(''):'<span class="hint">未找到按鈕</span>')+
   (T.buttonHover?'<p class="hint">實測 hover：'+T.buttonHover.before.backgroundColor+' → '+T.buttonHover.after.backgroundColor+'</p>':'')+'</div>'+
   '<div class="card"><h3>無障礙對比</h3>'+(audit.length?audit.map(a=>'<div class="spec"><small><span class="chip '+(a.pass?'ok':'warn')+'">'+a.ratio+':1</span></small><span style="background:'+a.bg+';color:'+a.fg+';padding:4px 12px;border-radius:6px">'+esc(a.name)+'</span></div>').join(''):'<span class="hint">無資料</span>')+
   '<h3 style="margin-top:18px">斷點</h3><div style="display:flex;gap:6px;flex-wrap:wrap">'+(T.breakpoints.length?T.breakpoints.map(b=>'<span class="chip">'+b+'px</span>').join(''):'<span class="hint">未偵測</span>')+'</div>'+
   (T.darkMode?.supported?'<h3 style="margin-top:18px">深色模式</h3><div style="display:flex;gap:8px"><div style="flex:1;padding:10px;border-radius:8px;background:'+T.darkMode.light.background+';color:'+T.darkMode.light.color+'">淺色</div><div style="flex:1;padding:10px;border-radius:8px;background:'+T.darkMode.dark.background+';color:'+T.darkMode.dark.color+'">深色</div></div>':'')+'</div></div>';
})();

// ---------- layout ----------
(function(){
  if(!D.pages.length)return;const l=$('#s-layout');let pi=0,vp='desktop';
  function draw(){const p=D.pages[pi];const total=Math.max(p.docHeight,1);
    l.innerHTML='<div class="card"><select id="pg">'+D.pages.map((q,i)=>'<option value="'+i+'"'+(i===pi?' selected':'')+'>'+esc(q.title||q.url)+'</option>').join('')+'</select> '+
    '<div class="seg" style="margin-left:8px">'+['desktop','tablet','mobile'].map(v=>'<button aria-pressed="'+(v===vp)+'" data-v="'+v+'">'+({desktop:'桌機 1440',tablet:'平板 768',mobile:'手機 390'})[v]+'</button>').join('')+'</div>'+
    (p.mobileOverflow?'<span class="chip warn">手機版橫向溢出</span>':'')+
    '<div class="shot"><div class="frame">'+(p.shots[vp]?'<img src="'+p.shots[vp]+'" loading="lazy">':'<div class="empty">沒有截圖（使用了 --no-screenshots？）</div>')+'</div>'+
    '<div class="map"><h3>區塊地圖</h3>'+(p.sections.length?p.sections.map(s=>'<div style="height:'+Math.max(14,s.height/total*420)+'px" title="'+esc(s.class)+'">&lt;'+s.tag+'&gt; '+esc(s.heading||'')+'<br>'+s.height+'px</div>').join(''):'<span class="hint">無 main 區塊</span>')+'</div></div>'+
    '<p class="hint">Landmarks：'+Object.entries(p.landmarks).map(([k,v])=>k+' ×'+v).join('・')+'</p></div>';
    $('#pg').onchange=(e)=>{pi=+e.target.value;draw()};l.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{vp=b.dataset.v;draw()})}
  draw();
})();

// ---------- content ----------
(function(){
  if(!D.pages.length)return;const c=$('#s-content');let pi=0;
  function draw(){const p=D.pages[pi];
    c.innerHTML='<div class="card"><table><tr><th>頁面</th><th>狀態</th><th>H1</th><th>連結</th></tr>'+D.pages.map((q,i)=>'<tr style="cursor:pointer;'+(i===pi?'background:color-mix(in srgb,var(--acc) 10%,transparent)':'')+'" data-i="'+i+'"><td>'+esc(q.title||q.url)+'<div class="hint">'+esc(q.url)+'</div></td><td>'+q.status+'</td><td>'+esc(q.headings.filter(h=>h.level===1).map(h=>h.text).join(' / '))+'</td><td>'+q.linkCount+'</td></tr>').join('')+'</table></div>'+
    '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>標題大綱</h3>'+(p.headings.map(h=>'<div class="h" style="--l:'+(h.level-1)+'"><em>H'+h.level+'</em>'+esc(h.text)+'</div>').join('')||'<span class="hint">無標題</span>')+'</div>'+
    '<div class="card"><h3>主要文案</h3>'+(p.paragraphs.map(t=>'<p>'+esc(t.slice(0,220))+'</p>').join('')||'<span class="hint">無</span>')+(p.forms.length?'<h3>表單</h3>'+p.forms.map(f=>'<div class="hint">'+f.method.toUpperCase()+' '+esc(f.action)+' — '+f.fields.map(x=>esc(x.name)).join(', ')+'</div>').join(''):'')+'</div></div>'+
    '<div class="card" style="margin-top:14px"><h3>圖片（'+p.images.length+'）</h3><div class="imgs">'+p.images.map(i=>'<img loading="lazy" src="'+esc(i.src)+'" title="'+esc(i.alt)+'" onerror="this.style.display=\\'none\\'">').join('')+'</div></div>';
    c.querySelectorAll('tr[data-i]').forEach(r=>r.onclick=()=>{pi=+r.dataset.i;draw()})}
  draw();
})();

// ---------- motion ----------
(function(){
  if(!M)return;const m=$('#s-motion');
  const libs=Object.entries(M.libs).filter(([,v])=>v).map(([k,v])=>'<span class="chip">'+k+(typeof v==='string'?' '+v:'')+'</span>').join('');
  m.innerHTML='<div class="card"><h3>技術</h3>'+(libs||'<span class="hint">未偵測到已知 3D 函式庫</span>')+'<span class="chip">WebGL ×'+M.webglContexts.length+'</span>'+
   (M.assets3d.length?'<h3 style="margin-top:12px">3D 素材</h3>'+M.assets3d.map(a=>'<div class="hint">'+esc(a)+'</div>').join(''):'')+
   (M.video?'<h3 style="margin-top:12px">錄影</h3><video src="'+M.video+'" controls style="max-width:100%;border-radius:8px"></video>':'')+'</div><div id="targets"></div>';
  const wrap=$('#targets',m);
  const kindName={webgl:'WebGL 3D','css-3d':'CSS 3D',canvas:'Canvas',canvas2d:'Canvas 2D',video:'影片','css-animation':'CSS 動畫','model-viewer':'model-viewer'};
  M.targets.forEach(t=>{
    const card=el('<div class="card" style="margin-top:14px"></div>');
    const modes=['idle','hover','drag'].filter(k=>t.frames[k].length);let mode=modes[0],i=0,timer=null;
    card.innerHTML='<h3>'+(kindName[t.kind]||t.kind)+' · '+esc(t.selector)+'</h3><div>'+(t.animatesOnItsOwn?'<span class="chip ok">會自己動</span>':'<span class="chip">靜置不動</span>')+(t.reactsToMouse?'<span class="chip ok">回應滑鼠</span>':'')+'<span class="chip">'+t.box.w+'×'+t.box.h+'</span></div>'+
     '<div class="seg" style="margin-top:10px">'+modes.map(k=>'<button data-m="'+k+'">'+({idle:'自走',hover:'滑鼠掃過',drag:'拖曳'})[k]+'</button>').join('')+'</div>'+
     '<div class="player"><div class="stage"><img></div></div><div class="ctrl"><button class="pl">▶ 播放</button><input type="range" min="0" value="0"><span class="hint cnt"></span></div><div class="film"></div>';
    const img=$('img',card),rng=$('input',card),film=$('.film',card),cnt=$('.cnt',card);
    const set=(n)=>{const fr=t.frames[mode];i=(n+fr.length)%fr.length;img.src=fr[i];rng.value=i;cnt.textContent=(i+1)+' / '+fr.length;film.querySelectorAll('img').forEach((x,j)=>x.classList.toggle('cur',j===i))};
    const load=()=>{const fr=t.frames[mode];rng.max=fr.length-1;film.innerHTML='';fr.forEach((f,j)=>{const x=el('<img src="'+f+'" loading="lazy">');x.onclick=()=>set(j);film.append(x)});card.querySelectorAll('[data-m]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===mode));set(0)};
    card.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{mode=b.dataset.m;load()});
    rng.oninput=()=>set(+rng.value);
    $('.pl',card).onclick=(e)=>{if(timer){clearInterval(timer);timer=null;e.target.textContent='▶ 播放'}else{timer=setInterval(()=>set(i+1),250);e.target.textContent='⏸ 暫停'}};
    if(modes.length){load()}else card.append(el('<div class="empty">沒有畫格</div>'));
    wrap.append(card);
  });
  if(!M.targets.length)wrap.append(el('<div class="card empty" style="margin-top:14px">沒有偵測到 3D 或動畫元素。若網站是互動體驗頁，請調大 --wait 後重跑。</div>'));
  if(M.scroll.length){const sc=el('<div class="card" style="margin-top:14px"><h3>捲動序列（拖動滑桿＝捲動頁面）</h3><div class="player"><div class="stage"><img></div></div><div class="ctrl"><input type="range" min="0" max="'+(M.scroll.length-1)+'" value="0"><span class="hint">'+M.scrollChangedFrames+' / '+M.scrollFrames+' 張畫面不同</span></div></div>');const im=$('img',sc),r=$('input',sc);im.src=M.scroll[0];r.oninput=()=>im.src=M.scroll[r.value];m.append(sc)}
  if(M.cssKeyframes.length||M.shaderSamples.length)m.append(el('<div class="card" style="margin-top:14px"><h3>原始線索</h3>'+(M.cssKeyframes.length?'<details><summary>CSS keyframes（'+M.cssKeyframes.length+'）</summary><pre>'+esc(JSON.stringify(M.cssKeyframes,null,2))+'</pre></details>':'')+(M.shaderSamples.length?'<details><summary>Shader 片段（'+M.shaderSamples.length+'）</summary><pre>'+esc(M.shaderSamples.join('\\n\\n----\\n\\n'))+'</pre></details>':'')+'</div>'));
})();

// ---------- editing ----------
(function(){
  if(!S)return;const e=$('#s-edit');const E=S.editing;
  e.innerHTML='<div class="grid g2">'+(E.platforms.length?E.platforms.map(p=>'<div class="card"><h3>偵測到的平台</h3><div class="big" style="font-size:20px">'+esc(p.platform)+'</div><p>'+esc(p.howToEdit)+'</p>'+Object.entries(p.adminProbes).map(([k,v])=>'<span class="chip '+(v===200||v===301||v===302?'ok':'')+'">'+esc(k)+' → '+v+'</span>').join('')+'</div>').join(''):'<div class="card"><h3>平台</h3><p>未偵測到已知建站平台，可能是自訂程式或靜態站。</p></div>')+
   '<div class="card"><h3>伺服器線索</h3><p>Server：'+esc(S.server.server||'?')+'<br>X-Powered-By：'+esc(S.server.poweredBy||'?')+'<br>Generator：'+esc(S.server.generator||'?')+'</p><h3>登入／後台連結</h3>'+(E.loginOrAdminLinks.map(l=>'<div class="hint">'+esc(l.text)+' → '+esc(l.href)+'</div>').join('')||'<span class="hint">無</span>')+'<p class="hint">可直接編輯頁面（contenteditable）：'+E.contenteditablePages.length+'</p></div></div>';
})();
show(location.hash.slice(1)&&tabs.some(t=>t[0]===location.hash.slice(1))?location.hash.slice(1):'overview');
</script></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log('Dashboard:', outFile);
