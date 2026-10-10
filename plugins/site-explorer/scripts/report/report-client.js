// Dashboard UI (runs in the browser; data comes from the JSON element with id "data").
const D=JSON.parse(document.getElementById('data').textContent);
const $=(s,r=document)=>r.querySelector(s),el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstChild};
const css=(s)=>String(s??'').replace(/[;"<>(){}\\@]/g,'');
const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const T=D.tokens,S=D.site,M=D.motion;
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1400)};
const copy=(v)=>{navigator.clipboard?.writeText(v);toast('已複製 '+v)};
$('#sub').textContent=(S?.startUrl||M?.url||'')+' · '+new Date(D.generatedAt).toLocaleString();

const tabs=[['overview','總覽'],['design','設計'],['layout','排版'],['content','內容'],['motion','3D／動畫'],['edit','編輯方式'],['health','健檢'],['history','歷史'],['about','關於']].filter(([k])=>k==='overview'||(k==='health'?D.health:k==='motion'?(M||D.motionPages):k==='history'?(D.history&&D.history.runs.length>0):k==='about'?true:S));
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
   (D.health?'<div class="card"><h3>網站健檢</h3><div class="big" style="color:'+(D.health.score>=80?'var(--ok)':D.health.score>=60?'var(--warn)':'#dc2626')+'">'+D.health.score+' <span style="font-size:16px">'+D.health.grade+'</span></div><div class="hint">'+D.health.severity.critical+' 嚴重・'+D.health.severity.high+' 高・'+D.health.severity.medium+' 中</div></div>':'')+
   (plat.length?'<div class="card"><h3>平台</h3><div class="big" style="font-size:20px">'+plat.map(p=>esc(p.platform)).join(' / ')+'</div></div>':'')+
  '</div><div class="card" style="margin-top:14px"><h3>重點摘要</h3>'+sentences.map(s=>'<p class="say">'+s+'</p>').join('')+'</div>'+
  (T?'<div class="card" style="margin-top:14px"><h3>色彩速覽</h3><div style="display:flex;height:44px;border-radius:8px;overflow:hidden">'+T.palette.slice(0,10).map(p=>'<div title="'+p.hex+'" style="flex:'+Math.max(1,Math.log2(p.uses+1))+';background:'+p.hex+'"></div>').join('')+'</div></div>':'')+
  (S?.assets?.length?'<div class="card" style="margin-top:14px"><h3>品牌素材</h3><div class="imgs">'+S.assets.map(a=>'<div><img src="'+a.src+'" style="object-fit:contain;background:#8884"><div class="hint">'+esc(a.name)+'</div></div>').join('')+'</div></div>':'');

  const blocked=S?.blockedPages||[];
  if(blocked.length)o.insertAdjacentHTML('afterbegin','<div class="card" style="border-color:var(--warn);margin-bottom:14px"><h3 style="color:var(--warn)">⚠️ 部分頁面被擋住</h3><p>'+blocked.map(b=>esc(b.reason)+'：'+esc(b.url)).join('<br>')+'</p><p class="hint">以下結果可能不完整。可降低頻率、確認你有權存取，或請 Claude 用瀏覽器工具互動補查。</p></div>');
  const steps=[];
  if(D.health){const t=D.health.issues.filter(i=>['critical','high'].includes(i.severity))[0];steps.push(['先處理 SEO／索引問題',t?esc(t.title)+'（共 '+D.health.issues.filter(i=>['critical','high'].includes(i.severity)).length+' 項嚴重／高優先，見「健檢」分頁）':'沒有嚴重問題，可到「健檢」分頁看中低優先建議']);}
  if(S)steps.push(['把這個風格變成 Claude Design 的設計系統','在 Claude Code 輸入：<code>/site-explorer:to-design '+esc(S.startUrl)+'</code>']);
  if(D.files.length)steps.push(['給開發者的檔案',D.files.map(f=>'<a href="'+f.href+'" download="'+esc(f.name)+'">'+esc(f.name)+'</a>').join('　')]);
  if(T&&(T.contrastAudit||[]).some(a=>!a.pass))steps.push(['修正對比不足','有 '+T.contrastAudit.filter(a=>!a.pass).length+' 項文字／按鈕對比低於 4.5:1，改版時建議調深前景或底色']);
  if(M&&M.targets.length)steps.push(['理解動畫','到「3D／動畫」分頁播放畫格；要推算節奏與觸發方式，請 Claude 逐張檢視畫格並對照 motion.json']);
  if(D.history&&D.history.runs.length>1)steps.push(['追蹤改版','這個網站已有 '+D.history.runs.length+' 次紀錄，見「歷史」分頁']);
  steps.push(['比較其他網站','終端機：<code>node scripts/db.mjs search --lib three</code>、<code>node scripts/db.mjs list</code>']);
  o.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><h3>下一步可以做什麼</h3>'+steps.map(x=>'<p class="say"><b>'+x[0]+'</b><br><span class="hint">'+x[1]+'</span></p>').join('')+'</div>');

  if(S){const rb=(S.robotsDisallow||[]);
    o.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><h3>探索紀錄（可稽核）</h3>'+
      '<div class="spec"><small>時間</small><span>'+esc(new Date(S.crawledAt).toLocaleString())+'，耗時 '+S.seconds+' 秒</span></div>'+
      '<div class="spec"><small>範圍</small><span>共讀取 '+S.pages.length+' 個頁面（同網域），'+((S.skippedByRobots||[]).length)+' 個因 robots.txt 略過</span></div>'+
      '<div class="spec"><small>robots.txt</small><span>'+(rb.length?'已遵守 '+rb.length+' 條 Disallow：'+esc(rb.slice(0,5).join(', ')):'無限制或未提供')+'</span></div>'+
      '<div class="spec"><small>身分</small><span>'+esc(S.userAgent||'site-explorer')+'（明確標示為自動化工具）</span></div>'+
      '<div class="spec"><small>互動</small><span>未登入、未送出表單、未繞過驗證'+(S.consentAction?'；Cookie 橫幅：「'+esc(S.consentAction)+'」':'')+'</span></div>'+
      (S.tool&&S.tool.version?'<div class="spec"><small>工具版本</small><span>site-explorer '+esc(S.tool.version)+'</span></div>':'')+
      '<p class="hint">本報告為對公開頁面的觀察結果，僅供研究與參考；字型、圖片、文案、3D 素材仍受原權利人保護。</p></div>');}
  if(D.standalone&&D.embed.skipped>0)o.insertAdjacentHTML('afterbegin','<div class="card" style="margin-bottom:14px"><span class="chip warn">部分檔案未內嵌</span> 有 '+D.embed.skipped+' 個檔案超過內嵌上限，僅以相對路徑連結；搬移此 HTML 時請連同資料夾，或調高 <code>--embed-mb</code>。</div>');
})();

// ---------- design ----------
(function(){
  if(!T)return;const d=$('#s-design');const c=T.color;
  const role={brand:'品牌色',accent:'輔助色',background:'背景',surface:'表面','surface-dark':'深色表面',text:'文字',border:'邊框','text-inverse':'反白文字'};
  const sw=(hex,name,sub)=>'<button onclick="copy(\''+hex+'\')"><i style="background:'+hex+'"></i><span><b>'+esc(name)+'</b>'+hex+(sub?' · '+sub:'')+'</span></button>';
  const type=Object.entries(T.typography.scale).map(([k,v])=>'<div class="spec"><small>'+k+' · '+v.size+'<br>'+v.weight+'</small><span style="font:'+v.weight+' '+v.size+'/'+(v.lineHeight==='normal'?'1.3':v.lineHeight)+' '+css(v.family)+',system-ui;letter-spacing:'+v.letterSpacing+'">The quick brown fox 設計範例 123</span></div>').join('');
  const sp=T.spacing.observed;const maxSp=Math.max(...sp,1);
  const btns=(window.__b=(S?.components?.buttons||[]).slice(0,4));
  const audit=T.contrastAudit||[];
  d.innerHTML='<div class="card"><h3>色彩角色（點擊複製）</h3><div class="sw">'+Object.entries(c).map(([k,v])=>sw(v,role[k]||k)).join('')+'</div>'+
   '<h3 style="margin-top:18px">完整色盤</h3><div class="sw">'+T.palette.map(p=>sw(p.hex,p.kind==='neutral'?'中性':'彩色',p.uses+'次')).join('')+'</div></div>'+
   '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>字型階層（實際渲染）</h3>'+type+'<p class="hint">標題：'+esc(T.typography.fontStack.heading)+'・內文：'+esc(T.typography.fontStack.body)+(T.typography.scaleRatio?'・級距比 ≈ '+T.typography.scaleRatio:'')+'</p></div>'+
   '<div class="card"><h3>間距（基準 '+T.spacing.baseUnit+'px）</h3><div class="bars">'+sp.map(n=>'<div><span style="width:46px">'+n+'px</span><i style="width:'+(n/maxSp*100)+'%"></i></div>').join('')+'</div>'+
   '<h3 style="margin-top:18px">圓角</h3><div class="shapes">'+(T.radius.length?T.radius.map(r=>'<div style="border-radius:'+r+'">'+r+'</div>').join(''):'<span class="hint">直角設計</span>')+'</div>'+
   '<h3 style="margin-top:18px">陰影</h3><div class="shapes shadows">'+(T.shadow.length?T.shadow.map(s=>'<div style="box-shadow:'+s+'">陰影</div>').join(''):'<span class="hint">平面設計</span>')+'</div></div></div>'+
   '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>按鈕（滑過看 hover）</h3>'+(btns.length?btns.map(b=>'<button style="margin:4px;cursor:pointer;background:'+css(b.backgroundColor)+';color:'+css(b.color)+';border:'+(parseFloat(b.borderTopWidth)?b.borderTopWidth+' solid '+b.borderTopColor:'0')+';border-radius:'+css(b.borderRadius)+';padding:'+css(b.padding)+';font:'+css(b.fontWeight)+' '+css(b.fontSize)+' '+css(b.fontFamily)+';transition:filter .15s" onmouseover="this.style.filter=\'brightness(.88)\'" onmouseout="this.style.filter=\'\'">'+esc(b.text||'按鈕')+'</button>').join(''):'<span class="hint">未找到按鈕</span>')+
   (T.buttonHover?'<p class="hint">實測 hover：'+T.buttonHover.before.backgroundColor+' → '+T.buttonHover.after.backgroundColor+'</p>':'')+'</div>'+
   '<div class="card"><h3>無障礙對比</h3>'+(audit.length?audit.map(a=>'<div class="spec"><small><span class="chip '+(a.pass?'ok':'warn')+'">'+a.ratio+':1</span></small><span style="background:'+a.bg+';color:'+a.fg+';padding:4px 12px;border-radius:6px">'+esc(a.name)+'</span></div>').join(''):'<span class="hint">無資料</span>')+
   '<h3 style="margin-top:18px">斷點</h3><div style="display:flex;gap:6px;flex-wrap:wrap">'+(T.breakpoints.length?T.breakpoints.map(b=>'<span class="chip">'+b+'px</span>').join(''):'<span class="hint">未偵測</span>')+'</div>'+
   (T.darkMode?.supported?'<h3 style="margin-top:18px">深色模式</h3><div style="display:flex;gap:8px"><div style="flex:1;padding:10px;border-radius:8px;background:'+T.darkMode.light.background+';color:'+T.darkMode.light.color+'">淺色</div><div style="flex:1;padding:10px;border-radius:8px;background:'+T.darkMode.dark.background+';color:'+T.darkMode.dark.color+'">深色</div></div>':'')+'</div></div>';
})();

// ---------- design: designer extras ----------
(function(){
  const d=$('#s-design');const dz=S?.designer;if(!d||!S)return;
  const PROV={google:['Google Fonts','ok','可免費商用'],system:['系統字體','','各平台外觀不同'],adobe:['Adobe Fonts','warn','需訂閱授權'],'self-hosted':['自架字型檔','warn','可能需授權'],unknown:['來源不明','warn','需自行確認']};
  const src=T?.typography?.sources||[];
  let h='';
  if(src.length)h+='<div class="card" style="margin-top:14px"><h3>字型來源與替代建議</h3>'+src.map(f=>{const pv=PROV[f.provider]||PROV.unknown;
    return '<div class="fnt"><div><b>'+esc(f.family)+'</b><div class="hint">'+(f.weights.length?'字重 '+f.weights.map(esc).join(', '):'')+'</div></div><div><span class="chip '+pv[1]+'">'+pv[0]+'</span><div class="hint">'+pv[2]+'</div></div><div>'+(f.url?'<a href="'+esc(f.url)+'" target="_blank" rel="noopener">在 Google Fonts 開啟 ↗</a>':f.substitute?'替代：<a href="'+esc(f.substituteUrl)+'" target="_blank" rel="noopener"><b>'+esc(f.substitute)+'</b> ↗</a>':'<span class="hint">—</span>')+'</div></div>'}).join('')+'</div>';
  h+='<div class="grid g2" style="margin-top:14px">';
  const g=dz.grid||{},m=dz.motion||{};
  h+='<div class="card"><h3>版面網格</h3><p class="say">容器寬 <b>'+((g.containerWidths||[]).map(x=>x.px+'px').join(' / ')||'?')+'</b>　欄數 <b>'+((g.columns||[]).map(x=>x.columns).join(' / ')||'?')+'</b>　間距 <b>'+((g.gaps||[]).map(x=>x.value).join(' / ')||'?')+'</b></p><div style="display:flex;gap:6px;height:46px;max-width:420px">'+Array.from({length:(g.columns&&g.columns[0]?g.columns[0].columns:12)},()=>'<i style="flex:1;background:color-mix(in srgb,var(--acc) 30%,transparent);border-radius:3px"></i>').join('')+'</div><p class="hint">依實際 grid／置中容器推算，可直接當作 Figma layout grid 參考。</p></div>';
  h+='<div class="card"><h3>動態節奏（transition／animation）</h3>'+((m.transitions||[]).map(x=>'<div class="spec"><small>×'+x.count+'</small><code>'+esc(x.token)+'</code></div>').join('')||'<span class="hint">沒有 transition</span>')+((m.animations||[]).map(x=>'<div class="spec"><small>動畫 ×'+x.count+'</small><code>'+esc(x.token)+'</code></div>').join(''))+'</div></div>';
  const cf=(dz.contrast&&dz.contrast.failing)||[];
  h+='<div class="card" style="margin-top:14px"><h3>真實背景上的對比檢查（掃描 '+(dz.contrast?dz.contrast.checked:0)+' 個文字元素）</h3>'+(cf.length?cf.map(c=>'<div class="spec"><small><span class="chip warn">'+c.ratio+':1</span><div class="hint">需 '+c.need+'</div></small><span style="background:'+c.bg+';color:'+c.fg+';padding:6px 14px;border-radius:8px;font-size:'+(c.large?'22px':'15px')+'">'+esc(c.sample||'Aa 範例文字')+'</span><span class="hint">'+c.fg+' on '+c.bg+' · 出現 '+c.count+' 次'+(c.uncertain?' · 背景有圖片，請人工確認':'')+'</span></div>').join(''):'<p>✅ 沒有發現對比不足的文字。</p>')+'</div>';
  if(dz.icons&&dz.icons.length)h+='<div class="card" style="margin-top:14px"><h3>行內圖示（'+dz.icons.length+'）</h3><div class="icons">'+dz.icons.map(i=>'<div><img alt="" src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(i.svg)+'"></div>').join('')+'</div><p class="hint">以圖片方式顯示（不執行腳本）。圖示受版權或授權保護，僅供參考。</p></div>';
  const ex=D.files.filter(f=>/palette.svg|tokens.studio|tailwind|tokens.css|w3c/.test(f.name));
  if(ex.length)h+='<div class="card" style="margin-top:14px"><h3>帶走（Figma／開發）</h3>'+ex.map(f=>'<a href="'+f.href+'" download="'+esc(f.name)+'" style="margin-right:14px">'+esc(f.name)+'</a>').join('')+'<p class="hint">palette.svg 拖進 Figma 即成色票；tokens.studio.json 用 Tokens Studio 外掛匯入。</p></div>';
  d.insertAdjacentHTML('beforeend',h);
})();

// ---------- layout ----------
const KIND={header:'頁首',hero:'主視覺 Hero',features:'功能／特色格',pricing:'價格方案',testimonial:'客戶見證',faq:'FAQ',form:'表單',logos:'Logo 牆',stats:'數據亮點',gallery:'圖庫',cta:'行動呼籲 CTA',footer:'頁尾',content:'內容區'};
const KCOL={header:'#64748b',hero:'#7c3aed',features:'#2563eb',pricing:'#059669',testimonial:'#d97706',faq:'#0891b2',form:'#db2777',logos:'#475569',stats:'#ca8a04',gallery:'#9333ea',cta:'#dc2626',footer:'#475569',content:'#94a3b8'};
const kchip=(k)=>'<span class="kind" style="background:'+(KCOL[k]||'#94a3b8')+'">'+esc(KIND[k]||k)+'</span>';
const lumOf=(h)=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const ratioOf=(a,b)=>{const x=lumOf(a),y=lumOf(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05))};
(function(){
  if(!D.pages.length)return;const l=$('#s-layout');let pi=0,mode='shot',vp='desktop',inspect=true;
  const MODES=[['shot','截圖／檢視元素'],['slices','區塊切片'],['skeleton','頁面骨架'],['side','響應式並排']];
  function draw(){
    const p=D.pages[pi];
    l.innerHTML='<div class="card"><select id="pg">'+D.pages.map((q,i)=>'<option value="'+i+'"'+(i===pi?' selected':'')+'>'+esc(q.title||q.url)+'</option>').join('')+'</select> '+
      '<div class="seg" style="margin-left:8px">'+MODES.map(m=>'<button data-mode="'+m[0]+'" aria-pressed="'+(m[0]===mode)+'">'+m[1]+'</button>').join('')+'</div>'+
      (p.mobileOverflow?'<span class="chip warn">手機版橫向溢出</span>':'')+
      (p.blocks.length?'<div style="margin:4px 0 10px">'+p.blocks.map(b=>kchip(b.kind)).join(' <span class="hint">→</span> ')+'</div>':'')+
      '<div id="lbody"></div></div>';
    $('#pg').onchange=(e)=>{pi=+e.target.value;draw()};
    l.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;draw()});
    const body=$('#lbody',l);
    ({shot:shotView,slices:slicesView,skeleton:skelView,side:sideView})[mode](p,body);
  }
  function shotView(p,body){
    body.innerHTML='<div class="seg">'+['desktop','tablet','mobile'].map(v=>'<button data-v="'+v+'" aria-pressed="'+(v===vp)+'">'+({desktop:'桌機 1440',tablet:'平板 768',mobile:'手機 390'})[v]+'</button>').join('')+'</div>'+
      (vp==='desktop'&&p.elements.length?'<div class="seg"><button id="tgI" aria-pressed="'+inspect+'">🔍 檢視元素：'+(inspect?'開':'關')+'</button></div><span class="hint">游標移到畫面上的元素，右側顯示字型、色碼、間距；點擊釘選並複製 CSS</span>':'')+
      '<div class="shot"><div class="frame">'+(p.shots[vp]?'<span class="wrapimg" id="wi"><img src="'+p.shots[vp]+'" id="shotimg"><div class="ov" id="ov"></div></span>':'<div class="empty">沒有截圖（使用了 --no-screenshots？）</div>')+'</div>'+
      (vp==='desktop'&&p.elements.length&&inspect?'<div class="insp card" id="insp"><h3>元素資訊</h3><div class="hint">把游標移到左側畫面</div></div>':'<div class="map"><h3>區塊地圖</h3>'+mapHtml(p)+'</div>')+'</div>';
    body.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{vp=b.dataset.v;draw()});
    const tg=$('#tgI',body);if(tg)tg.onclick=()=>{inspect=!inspect;draw()};
    const img=$('#shotimg',body);
    if(img&&vp==='desktop'&&inspect&&p.elements.length){
      const build=()=>{const NW=img.naturalWidth,NH=img.naturalHeight,ov=$('#ov',body);ov.innerHTML='';
        p.elements.slice().sort((a,b)=>b.w*b.h-a.w*a.h).forEach((e)=>{const d=document.createElement('div');d.className='ib';d.style.cssText='left:'+(e.x/NW*100)+'%;top:'+(e.y/NH*100)+'%;width:'+(e.w/NW*100)+'%;height:'+(e.h/NH*100)+'%';
          d.onmouseenter=()=>info(e,false);d.onclick=()=>{ov.querySelectorAll('.pin').forEach(x=>x.classList.remove('pin'));d.classList.add('pin');info(e,true);copy(cssOf(e))};ov.append(d)})};
      img.complete&&img.naturalWidth?build():img.onload=build;
    }
  }
  const cssOf=(e)=>['font-family: "'+e.font+'";','font-size: '+e.size+';','font-weight: '+e.weight+';','line-height: '+e.lh+';',e.ls!=='normal'?'letter-spacing: '+e.ls+';':'','color: '+e.color+';','background: '+e.bg+';',e.pad&&e.pad!=='0px'?'padding: '+e.pad+';':'',e.radius&&e.radius!=='0px'?'border-radius: '+e.radius+';':'',e.shadow?'box-shadow: '+e.shadow+';':'',e.border?'border: '+e.border+';':''].filter(Boolean).join('\n');
  function info(e,pinned){
    const el=$('#insp');if(!el)return;const r=ratioOf(e.color,e.bg);
    const row=(k,v)=>v?'<div class="row"><span>'+k+'</span><span>'+v+'</span></div>':'';
    const sw=(c)=>'<i class="dot" style="background:'+c+'"></i>'+c;
    el.innerHTML='<h3>'+esc(e.role)+' · &lt;'+esc(e.tag)+'&gt;'+(pinned?' 📌':'')+'</h3>'+(e.text?'<div style="margin-bottom:6px"><b>'+esc(e.text)+'</b></div>':'')+
      row('尺寸',e.w+' × '+e.h)+row('字型',esc(e.font))+row('字級／字重',esc(e.size)+' / '+esc(e.weight))+row('行高',esc(e.lh))+row('字距',e.ls!=='normal'?esc(e.ls):'')+
      row('文字色',sw(e.color))+row('背景色',sw(e.bg))+row('對比','<span class="chip '+(r>=4.5?'ok':'warn')+'">'+r.toFixed(2)+':1</span>')+
      row('內距',e.pad!=='0px'?esc(e.pad):'')+row('外距',e.margin!=='0px'?esc(e.margin):'')+row('圓角',e.radius!=='0px'?esc(e.radius):'')+row('陰影',e.shadow?esc(e.shadow):'')+row('邊框',e.border?esc(e.border):'')+row('版型',esc(e.display)+(e.gap?' gap '+esc(e.gap):''))+
      '<div class="hint" style="margin-top:8px">'+(pinned?'已複製 CSS':'點擊釘選並複製 CSS')+'</div>';
  }
  function mapHtml(p){const total=Math.max(p.docHeight,1);
    if(p.blocks.length)return p.blocks.map(b=>'<div style="height:'+Math.max(16,b.h/total*420)+'px;background:'+(KCOL[b.kind]||'#94a3b8')+';color:#fff;border-color:transparent" title="'+esc(b.text)+'">'+esc(KIND[b.kind]||b.kind)+'<br>'+b.h+'px</div>').join('');
    return p.sections.length?p.sections.map(s=>'<div style="height:'+Math.max(14,s.height/total*420)+'px" title="'+esc(s.class)+'">&lt;'+s.tag+'&gt; '+esc(s.heading||'')+'<br>'+s.height+'px</div>').join(''):'<span class="hint">無法辨識區塊</span>';}
  function slicesView(p,body){
    if(!p.shots.desktop||!p.blocks.length){body.innerHTML='<div class="empty">需要桌機截圖與區塊資料（請勿使用 --no-screenshots）</div>';return}
    const W=Math.min(body.clientWidth||l.clientWidth-60,1100)||800,sc=W/1440;
    body.innerHTML='<p class="hint">自動把頁面切成區塊並辨識版型。每一段都是原截圖的裁切，可逐段研究。</p>'+p.blocks.map((b,i)=>{const H=Math.min(b.h*sc,520);
      return '<div class="slice"><div class="top">'+kchip(b.kind)+'<b>'+esc(b.heading||b.text.slice(0,50)||'（無文字）')+'</b><span class="hint">'+b.w+'×'+b.h+'px · 欄數 '+b.columns+' · 標題 '+b.headings+' · 按鈕 '+b.buttons+' · 媒體 '+b.media+'</span></div>'+
        '<div class="crop" data-bg="'+p.shots.desktop+'" style="width:'+W+'px;max-width:100%;height:'+H+'px;background-size:'+W+'px auto;background-position:0 -'+(b.y*sc)+'px"></div>'+(b.h*sc>520?'<div class="hint" style="padding:4px 12px">（區塊較高，僅顯示上半部）</div>':'')+'</div>'}).join('');
    body.querySelectorAll('.crop').forEach(c=>{c.style.backgroundImage='url("'+c.dataset.bg+'")'});
  }
  function skelView(p,body){
    if(!p.blocks.length){body.innerHTML='<div class="empty">沒有區塊資料</div>';return}
    const seq=p.blocks.map(b=>KIND[b.kind]||b.kind).join(' → ');
    body.innerHTML='<p class="say">頁面骨架：<b>'+esc(seq)+'</b></p><div class="skel">'+p.blocks.map(b=>{const h=Math.max(34,Math.min(b.h*.14,150));const cols=Math.min(b.columns,6);
      return '<div class="b" style="background:'+(KCOL[b.kind]||'#94a3b8')+';height:'+h+'px"><b>'+esc(KIND[b.kind]||b.kind)+' · '+b.h+'px'+(b.columns>1?' · '+b.columns+' 欄':'')+'</b>'+(cols>1?'<div class="cols">'+Array.from({length:cols},()=>'<i></i>').join('')+'</div>':'<div class="ln" style="width:70%"></div><div class="ln" style="width:45%"></div>')+'</div>'}).join('')+'</div>'+
      '<p class="hint">想做同類型頁面時，直接依這個順序規劃區塊；也可交給 Claude Design 照骨架產出線框。<br>⚠️ 版型是依 DOM 規則推測（每個區塊的「推測依據」見「區塊切片」），遇到非行銷型頁面（文章、後台）請以截圖為準。</p>';
  }
  function sideView(p,body){
    const devs=[['desktop','桌機 1440',.3],['tablet','平板 768',.3],['mobile','手機 390',.3]].filter(d=>p.shots[d[0]]);
    if(!devs.length){body.innerHTML='<div class="empty">沒有截圖</div>';return}
    body.innerHTML='<p class="hint">三種尺寸等比例並排，捲動會同步，直接看版面如何重排。</p><div class="side">'+devs.map(d=>{const w={desktop:1440,tablet:768,mobile:390}[d[0]]*d[2];return '<div class="dev"><h4>'+d[1]+'</h4><div class="scr" data-s style="width:'+w+'px;height:680px"><img src="'+p.shots[d[0]]+'" style="width:'+w+'px;display:block"></div></div>'}).join('')+'</div>';
    const sc=[...body.querySelectorAll('[data-s]')];let lock=false;
    sc.forEach(a=>a.addEventListener('scroll',()=>{if(lock)return;lock=true;const r=a.scrollTop/Math.max(1,a.scrollHeight-a.clientHeight);sc.forEach(b=>{if(b!==a)b.scrollTop=r*(b.scrollHeight-b.clientHeight)});requestAnimationFrame(()=>lock=false)}));
  }
  draw();
})();

// ---------- content ----------
(function(){
  if(!D.pages.length)return;const c=$('#s-content');let pi=0;
  function draw(){const p=D.pages[pi];
    c.innerHTML='<div class="card"><table><tr><th>頁面</th><th>狀態</th><th>H1</th><th>連結</th></tr>'+D.pages.map((q,i)=>'<tr style="cursor:pointer;'+(i===pi?'background:color-mix(in srgb,var(--acc) 10%,transparent)':'')+'" data-i="'+i+'"><td>'+esc(q.title||q.url)+'<div class="hint">'+esc(q.url)+'</div></td><td>'+q.status+'</td><td>'+esc(q.headings.filter(h=>h.level===1).map(h=>h.text).join(' / '))+'</td><td>'+q.linkCount+'</td></tr>').join('')+'</table></div>'+
    '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>標題大綱</h3>'+(p.headings.map(h=>'<div class="h" style="--l:'+(h.level-1)+'"><em>H'+h.level+'</em>'+esc(h.text)+'</div>').join('')||'<span class="hint">無標題</span>')+'</div>'+
    '<div class="card"><h3>主要文案</h3>'+(p.paragraphs.map(t=>'<p>'+esc(t.slice(0,220))+'</p>').join('')||'<span class="hint">無</span>')+(p.forms.length?'<h3>表單</h3>'+p.forms.map(f=>'<div class="hint">'+f.method.toUpperCase()+' '+esc(f.action)+' — '+f.fields.map(x=>esc(x.name)).join(', ')+'</div>').join(''):'')+'</div></div>'+
    '<div class="card" style="margin-top:14px"><h3>圖片（'+p.images.length+'）</h3><div class="imgs">'+p.images.map(i=>'<img loading="lazy" src="'+esc(i.src)+'" title="'+esc(i.alt)+'" onerror="this.style.display=\'none\'">').join('')+'</div></div>';

    const dzc=S&&S.designer&&S.designer.copy;
    if(dzc&&(dzc.ctas.length||dzc.nav.length))c.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><h3>文案盤點</h3><p><b>按鈕文案：</b>'+(dzc.ctas.map(x=>'<span class="chip">'+esc(x.text)+(x.count>1?' ×'+x.count:'')+'</span>').join('')||'—')+'</p><p><b>導覽項目：</b>'+(dzc.nav.map(x=>'<span class="chip">'+esc(x)+'</span>').join('')||'—')+'</p></div>');
    c.querySelectorAll('tr[data-i]').forEach(r=>r.onclick=()=>{pi=+r.dataset.i;draw()})}
  draw();
})();

// ---------- motion ----------
(function(){
  if(!M)return;const m=$('#s-motion');
  const libs=Object.entries(M.libs).filter(([,v])=>v).map(([k,v])=>'<span class="chip">'+esc(k)+(typeof v==='string'?' '+esc(v):'')+'</span>').join('');
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
  if(M.cssKeyframes.length||M.shaderSamples.length)m.append(el('<div class="card" style="margin-top:14px"><h3>原始線索</h3>'+(M.cssKeyframes.length?'<details><summary>CSS keyframes（'+M.cssKeyframes.length+'）</summary><pre>'+esc(JSON.stringify(M.cssKeyframes,null,2))+'</pre></details>':'')+(M.shaderSamples.length?'<details><summary>Shader 片段（'+M.shaderSamples.length+'）</summary><pre>'+esc(M.shaderSamples.join('\n\n----\n\n'))+'</pre></details>':'')+'</div>'));
})();

// ---------- editing ----------
(function(){
  if(!S)return;const e=$('#s-edit');const E=S.editing;
  e.innerHTML='<div class="grid g2">'+(E.platforms.length?E.platforms.map(p=>'<div class="card"><h3>偵測到的平台</h3><div class="big" style="font-size:20px">'+esc(p.platform)+'</div><p>'+esc(p.howToEdit)+'</p>'+Object.entries(p.adminProbes).map(([k,v])=>'<span class="chip '+(v===200||v===301||v===302?'ok':'')+'">'+esc(k)+' → '+v+'</span>').join('')+'</div>').join(''):'<div class="card"><h3>平台</h3><p>未偵測到已知建站平台，可能是自訂程式或靜態站。</p></div>')+
   '<div class="card"><h3>伺服器線索</h3><p>Server：'+esc(S.server.server||'?')+'<br>X-Powered-By：'+esc(S.server.poweredBy||'?')+'<br>Generator：'+esc(S.server.generator||'?')+'</p><h3>登入／後台連結</h3>'+(E.loginOrAdminLinks.map(l=>'<div class="hint">'+esc(l.text)+' → '+esc(l.href)+'</div>').join('')||'<span class="hint">無</span>')+'<p class="hint">可直接編輯頁面（contenteditable）：'+E.contenteditablePages.length+'</p></div></div>';
})();

// ---------- health (SEO / indexability) ----------
(function(){
  const H=D.health;if(!H)return;const h=$('#s-health');
  const SEVN={critical:'嚴重',high:'高',medium:'中',low:'低',info:'資訊'};
  const col=(v)=>v>=80?'var(--ok)':v>=60?'var(--warn)':'#dc2626';
  let catF=null,sevF=null,view='issues';
  const VIEWS=[['issues','問題清單'],['pages','頁面一覽'],['crawl','爬蟲與 robots'],['sitemap','Sitemap'],['perf','效能'],['sec','安全']];
  function draw(){
    const cats=Object.entries(H.categories);
    let list=H.issues.filter(i=>(!catF||i.category===catF)&&(!sevF||i.severity===sevF));
    h.innerHTML='<div class="card"><div class="score"><div><div class="ring" style="--p:'+H.score+';--c:'+col(H.score)+'"><b>'+H.score+'</b></div><small class="hint" style="display:block;text-align:center;margin-top:4px">等級 '+H.grade+'</small></div>'+
      '<div style="flex:1;min-width:260px">'+cats.map(([k,c])=>'<div class="cat'+(catF&&catF!==k?' off':'')+'" data-cat="'+k+'"><span>'+esc(c.label)+'</span><i><b style="width:'+c.score+'%;background:'+col(c.score)+'"></b></i><span>'+c.score+'</span></div>').join('')+'<div class="hint">點類別可篩選問題</div></div>'+
      '<div style="min-width:170px">'+Object.entries(H.severity).map(([k,n])=>'<div style="margin:3px 0;cursor:pointer" data-sev="'+k+'"><span class="sev '+k+'" style="opacity:'+(sevF&&sevF!==k?.4:1)+'">'+SEVN[k]+'</span> <b>'+n+'</b></div>').join('')+'</div></div>'+
      (H.notes.length?'<p class="hint" style="margin-top:10px">'+H.notes.map(esc).join('<br>')+'</p>':'')+'</div>'+
      '<div class="sub2 seg" style="display:flex">'+VIEWS.map(v=>'<button data-view="'+v[0]+'" aria-pressed="'+(v[0]===view)+'">'+v[1]+'</button>').join('')+'</div><div id="hv"></div>';
    h.querySelectorAll('[data-cat]').forEach(e=>e.onclick=()=>{catF=catF===e.dataset.cat?null:e.dataset.cat;draw()});
    h.querySelectorAll('[data-sev]').forEach(e=>e.onclick=()=>{sevF=sevF===e.dataset.sev?null:e.dataset.sev;draw()});
    h.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{view=e.dataset.view;draw()});
    ({issues:vIssues,pages:vPages,crawl:vCrawl,sitemap:vSitemap,perf:vPerf,sec:vSec})[view]($('#hv',h),list);
  }
  const catName=(k)=>(H.categories[k]||{}).label||k;
  function vIssues(el,list){
    const top=H.issues.filter(i=>['critical','high','medium'].includes(i.severity)).slice(0,5);
    el.innerHTML=(!catF&&!sevF&&top.length?'<div class="card"><h3>最該先處理的 '+top.length+' 件事</h3>'+top.map((i,n)=>'<p class="say"><b>'+(n+1)+'. '+esc(i.title)+'</b> <span class="sev '+i.severity+'">'+SEVN[i.severity]+'</span><br><span class="hint">'+esc(i.fix)+'</span></p>').join('')+'</div>':'')+
      '<div style="margin-top:12px">'+(list.length?list.map(i=>'<details class="is"><summary><span class="sev '+i.severity+'">'+SEVN[i.severity]+'</span><b>'+esc(i.title)+'</b><span class="hint">'+esc(catName(i.category))+' · '+(i.scope==='site'?'全站':i.affected+' / '+i.total+' 頁')+'</span></summary><div class="bd">'+
        (i.impact?'<p><b>為什麼重要：</b>'+esc(i.impact)+'</p>':'')+(i.fix?'<div class="fix"><b>怎麼修：</b>'+esc(i.fix)+'</div>':'')+(i.detail?'<p class="hint">'+esc(i.detail)+'</p>':'')+
        (i.examples.length?'<b>範例</b><ul>'+i.examples.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+'<span class="hint mono">'+esc(i.id)+'</span></div></details>').join(''):'<div class="empty">沒有符合條件的問題 🎉</div>')+'</div>'+
      '<details class="is" style="margin-top:14px"><summary><b>已通過的檢查（'+H.passed.length+'）</b></summary><div class="bd"><ul>'+H.passed.map(p=>'<li>✅ '+esc(catName(p.category))+'：'+esc(p.title)+'</li>').join('')+'</ul></div></details>';
  }
  function vPages(el){
    el.innerHTML='<div class="card" style="overflow:auto"><table class="t"><tr><th>網址</th><th>狀態</th><th>可索引</th><th>標題</th><th>描述</th><th>H1</th><th>字數 渲染／原始</th><th>LCP</th><th>連入</th></tr>'+H.pages.map(p=>{
      const tl=p.titleLen,dl=p.descLen;return '<tr><td class="mono">'+esc(p.url.replace(/^https?:\/\/[^/]+/,'')||'/')+'</td><td>'+p.status+'</td><td>'+(p.indexable?'✅':'<span class="chip warn">noindex／錯誤</span>')+'</td>'+
        '<td><span class="'+(tl===0?'poor':tl<20||tl>60?'warn2':'good')+'">'+tl+'</span></td><td><span class="'+(dl===0?'poor':dl<70||dl>160?'warn2':'good')+'">'+dl+'</span></td><td class="'+(p.h1===1?'good':'warn2')+'">'+p.h1+'</td>'+
        '<td>'+p.words+'／<span class="'+(p.rawWords!=null&&p.rawWords<p.words*.35?'poor':'')+'">'+(p.rawWords??'—')+'</span></td><td class="'+(p.lcpMs==null?'':p.lcpMs<=2500?'good':p.lcpMs<=4000?'warn2':'poor')+'">'+(p.lcpMs??'—')+'</td><td>'+p.inlinks+'</td></tr>'}).join('')+'</table><p class="hint">標題／描述為「字元寬度」（中日韓字元算 2）。建議標題 20–60、描述 70–160、h1 恰好 1。</p></div>';
  }
  function vCrawl(el){
    const f=H.facts.robots,row=(b)=>'<tr><td class="mono">'+esc(b.bot)+'</td><td>'+esc(b.who)+'</td><td>'+(b.allowed?'<span class="chip ok">允許</span>':'<span class="chip warn">禁止</span> <span class="hint mono">'+esc(b.rule||'')+'</span>')+'</td></tr>';
    el.innerHTML='<div class="grid g2"><div class="card"><h3>搜尋引擎爬蟲</h3><table class="t">'+f.searchBots.map(row).join('')+'</table></div><div class="card"><h3>AI 爬蟲</h3><table class="t">'+f.aiBots.map(row).join('')+'</table><p class="hint">訓練類（GPTBot、ClaudeBot、Google-Extended…）與搜尋／代使用者類（OAI-SearchBot、ChatGPT-User、Claude-User…）政策可以不同。</p></div></div>'+
      '<div class="card" style="margin-top:14px"><h3>robots.txt（HTTP '+(f.status??'—')+'）'+(f.issues.length?' · <span class="chip warn">'+f.issues.length+' 個語法問題</span>':'')+'</h3>'+(f.issues.length?'<ul>'+f.issues.map(i=>'<li>第 '+i.line+' 行：'+esc(i.msg)+'</li>').join('')+'</ul>':'')+'<pre class="raw">'+esc((D.site&&D.site.robotsTxt&&D.site.robotsTxt.text)||'（無內容）')+'</pre></div>'+
      '<div class="card" style="margin-top:14px"><h3>其他爬蟲相關</h3><div class="spec"><small>llms.txt</small><span>'+(H.facts.llmsTxt?'有':'無')+'</span></div><div class="spec"><small>不存在網址</small><span>回應 '+(H.facts.soft404.status??'—')+'（應為 404／410）</span></div>'+(H.facts.variants?'<div class="spec"><small>網域變體</small><span>'+H.facts.variants.map(v=>esc(v.variant)+' → '+(v.status||v.error)).join('<br>')+'</span></div>':'')+(H.facts.linkCheckLimited?'<p class="hint">'+esc(H.facts.linkCheckLimited)+'</p>':'')+(H.links?'<div class="spec"><small>連結檢查</small><span>內部 '+H.links.internalChecked+' 個、外部 '+H.links.externalChecked+' 個；壞連結 '+H.links.broken.length+'，外部失效 '+H.links.externalBroken.length+'</span></div>':'<div class="hint">未檢查連結狀態（--no-link-check）</div>')+'</div>';
  }
  function vSitemap(el){
    const s=H.facts.sitemap;
    el.innerHTML='<div class="card"><h3>Sitemap</h3><div class="spec"><small>位置</small><span>'+(s.found.map(esc).join('<br>')||'<span class="chip warn">找不到</span>')+'</span></div><div class="spec"><small>網址數</small><span>'+s.urlCount+'（含 lastmod：'+s.withLastmod+'）</span></div>'+(s.children.length?'<div class="spec"><small>子 sitemap</small><span>'+s.children.map(esc).join('<br>')+'</span></div>':'')+
      (s.sampleChecked?'<div class="spec"><small>抽樣檢查</small><span>'+s.sampleChecked+' 筆；異常 '+s.sampleBad.length+'</span></div>':'')+(s.sampleBad.length?'<ul>'+s.sampleBad.map(x=>'<li class="mono">'+esc(x)+'</li>').join('')+'</ul>':'')+(s.errors.length?'<p class="hint">'+s.errors.map(esc).join('<br>')+'</p>':'')+'</div>';
  }
  function vPerf(el){
    const p=H.facts.performance,fmt=(v,u)=>v==null?'—':v+u;
    const m=(label,v,u,good,poor)=>'<div class="metric"><span class="hint">'+label+'</span><b class="'+(v==null?'':v<=good?'good':v<=poor?'warn2':'poor')+'">'+fmt(v,u)+'</b></div>';
    el.innerHTML='<div class="card"><h3>中位數（各頁）</h3>'+m('TTFB',p.ttfbMs,' ms',800,1800)+m('LCP',p.lcpMs,' ms',2500,4000)+m('CLS',p.cls,'',.1,.25)+m('總下載量',p.totalBytes!=null?+(p.totalBytes/1048576).toFixed(2):null,' MB',3,6)+m('請求數',p.requests,'',100,200)+m('DOM 節點',p.domNodes,'',1500,3000)+'<p class="hint">'+esc(p.note)+'</p></div>'+
      '<div class="card" style="margin-top:14px;overflow:auto"><table class="t"><tr><th>網址</th><th>TTFB</th><th>LCP</th><th>CLS</th><th>下載量</th></tr>'+H.pages.map(x=>'<tr><td class="mono">'+esc(x.url.replace(/^https?:\/\/[^/]+/,'')||'/')+'</td><td>'+fmt(x.ttfbMs,' ms')+'</td><td>'+fmt(x.lcpMs,' ms')+'</td><td>'+fmt(x.cls,'')+'</td><td>'+(x.bytes!=null?(x.bytes/1024).toFixed(0)+' KB':'—')+'</td></tr>').join('')+'</table></div>';
  }
  function vSec(el){
    const s=H.facts.security,c=s.certificate;
    const lab={'strict-transport-security':'HSTS','content-security-policy':'CSP','x-content-type-options':'nosniff','x-frame-options':'X-Frame-Options','referrer-policy':'Referrer-Policy','permissions-policy':'Permissions-Policy'};
    el.innerHTML='<div class="card"><h3>傳輸與標頭</h3><div class="spec"><small>HTTPS</small><span>'+(s.https?'<span class="chip ok">是</span>':'<span class="chip warn">否</span>')+'</span></div>'+(c&&c.ok?'<div class="spec"><small>憑證</small><span>'+esc(c.issuer||'')+'，到期 '+esc((c.validTo||'').slice(0,10))+'（剩 '+c.daysLeft+' 天），'+esc(c.protocol||'')+'</span></div>':'')+
      Object.entries(lab).map(([k,v])=>'<div class="spec"><small>'+v+'</small><span>'+(s.headers[k]?'<span class="chip ok">已設定</span> <span class="hint mono">'+esc(String(s.headers[k]).slice(0,90))+'</span>':'<span class="chip warn">未設定</span>')+'</span></div>').join('')+
      (s.headers.server||s.headers['x-powered-by']?'<div class="spec"><small>洩漏資訊</small><span class="mono">'+esc([s.headers.server,s.headers['x-powered-by']].filter(Boolean).join('、'))+'</span></div>':'')+'</div>';
  }
  draw();
})();

// ---------- history ----------
(function(){
  const H=D.history;if(!H||!H.runs.length)return;const h=$('#s-history');
  h.innerHTML='<div class="card"><h3>'+esc(H.host)+' 的探索紀錄</h3><table><tr><th>#</th><th>時間</th><th>頁數</th><th>主色</th><th>標題字型</th><th>3D／動畫</th></tr>'+H.runs.slice().reverse().map(r=>'<tr><td>'+r.id+'</td><td>'+esc(new Date(r.date).toLocaleString())+'</td><td>'+(r.pages??'—')+'</td><td>'+(r.brand?'<span class="chip" style="background:'+r.brand+';color:#fff">'+r.brand+'</span>':'—')+'</td><td>'+esc(r.font||'—')+'</td><td>'+r.targets+'</td></tr>').join('')+'</table></div>'+
  '<div class="card" style="margin-top:14px"><h3>與上一次相比</h3>'+(H.runs.length<2?'<p class="hint">這是第一次紀錄；之後再探索同一個網站，就能看到改版差異。</p>':(H.changes.length?'<table><tr><th>項目</th><th>之前</th><th>現在</th></tr>'+H.changes.map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+esc(c.from)+'</td><td>'+esc(c.to)+'</td></tr>').join('')+'</table>':'<p>沒有明顯變化。</p>'))+'</div>';
})();
// ---------- capture status: say it loudly when a page came out (almost) empty ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;const bad=(S.pages||[]).filter(p=>p.emptyPage);if(!bad.length)return;
  const why=d=>!d?'原因不明；可試 <code>--wait 30000</code> 或 <code>--headed</code>。':d.blockPage?'<b>像是防機器人／驗證頁</b>：網站把自動化瀏覽器擋在外面。可試 <code>--headed</code>（顯示瀏覽器視窗）。':(d.canvases>0&&d.textChars<40)?'<b>像是 WebGL／canvas 整頁體驗</b>：畫面由 3D 繪製，網頁上幾乎沒有文字或版面元素可抽取。請看「3D／動畫」分頁與截圖。':(d.iframes>0&&d.elements<40)?'內容可能在 iframe 裡，目前不會深入 iframe。':(d.buttons>0&&d.textChars<40)?'可能要先點「進入」或同意 Cookie 才會顯示內容。可試 <code>--headed</code> 親手點一下。':'原因不明；可試 <code>--wait 30000</code> 或 <code>--headed</code>。';
  const shot=p=>{const pg=(D.pages||[]).find(x=>x.slug===p.slug);const src=pg&&pg.shots&&pg.shots.desktop;return src?'<img src="'+esc(src)+'" style="max-width:260px;border:1px solid var(--line);border-radius:8px;margin-top:8px" alt="擷取當下的畫面">':''};
  o.insertAdjacentHTML('afterbegin','<div class="card" style="border-color:#dc2626;margin-bottom:14px"><h3 style="color:#dc2626">⚠️ 這次擷取不完整（'+bad.length+' 頁幾乎是空的）</h3>'+bad.map(p=>'<div style="margin:8px 0"><b>'+esc(p.title||p.url)+'</b><br><small>'+esc(p.url)+'</small><br>'+(p.emptyDiag?'<small>DOM 元素 '+p.emptyDiag.elements+'・canvas '+p.emptyDiag.canvases+'・iframe '+p.emptyDiag.iframes+'・可見文字 '+p.emptyDiag.textChars+' 字</small><br>':'')+why(p.emptyDiag)+'<br>'+shot(p)+'</div>').join('')+'</div>');
})();
// ---------- what the page actually loaded (network, shadow DOM / iframes, accessibility tree) ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;const p=(S.pages||[]).find(x=>x.network);if(!p)return;const n=p.network,d=p.deep,a=p.aria;
  const li=x=>'<li>'+x+'</li>';
  const rows=[
    li('請求 <b>'+n.total+'</b> 個（'+Object.entries(n.byType).sort((x,y)=>y[1]-x[1]).slice(0,6).map(([k,v])=>esc(k)+' '+v).join('、')+'）；第三方網域 '+(n.thirdParty||[]).length+' 個'+(n.errorCount?'；<b style="color:#dc2626">錯誤回應 '+n.errorCount+' 個（403/429：'+n.blockedLike+'）</b>':'')),
    n.assets3d&&n.assets3d.length?li('3D 資源：'+n.assets3d.map(x=>'<code>'+esc(x.url)+'</code> ('+x.status+')').join('、')):'',
    n.apis&&n.apis.length?li('API／JSON：'+n.apis.slice(0,6).map(x=>'<code>'+esc(x.url)+'</code> ('+x.status+')').join('、')):'',
    n.apiTextSamples&&n.apiTextSamples.length?li('API 回應裡的文字（頁面上看不到時，內容常在這裡）：<ul>'+n.apiTextSamples.slice(0,6).map(t=>li(esc(t))).join('')+'</ul>'):'',
    d?li('含 shadow DOM 與 iframe 的可見文字 <b>'+d.textChars+'</b> 字（iframe '+d.frameCount+' 個、shadow root '+d.shadowHosts+' 個）'):'',
    a?li('無障礙樹 <b>'+a.lines+'</b> 行：標題 '+a.headings+'、連結 '+a.links+'、按鈕 '+a.buttons+'、圖片 '+a.images+'、地標 '+a.landmarks+'（pages/'+esc(p.slug)+'/aria.yml）'+(a.head?'<details><summary>展開前 40 行</summary><pre style="white-space:pre-wrap;font-size:12px">'+esc(a.head)+'</pre></details>':'')):''
  ].join('');
  o.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><h3>頁面實際載入了什麼</h3><div class="hint">'+esc(p.url)+'</div><ul>'+rows+'</ul></div>');
})();
// ---------- interaction states: what appeared after clicking / scrolling / pressing keys ----------
(function(){
  const o=$('#s-overview');if(!o||!D.pages)return;const list=D.pages.filter(p=>p.states&&p.states.length>1);if(!list.length)return;
  o.insertAdjacentHTML('beforeend','<div class="card" style="margin-top:14px"><h3>互動狀態（自動點擊／滾動／按鍵後出現的畫面）</h3>'+list.slice(0,4).map(p=>'<div style="margin:8px 0"><b>'+esc(p.title||p.url)+'</b> <small>'+esc(p.url)+'</small><div style="display:flex;gap:10px;overflow-x:auto;padding:6px 0">'+p.states.map(s=>'<figure style="margin:0;flex:none;width:200px"><img src="'+esc(s.src||'')+'" style="width:200px;border:1px solid var(--line);border-radius:6px" alt="狀態 '+s.index+'"><figcaption style="font-size:12px">'+s.index+'. '+esc(s.action)+(s.label?'「'+esc(s.label)+'」':'')+'<br>文字 '+s.textChars+' 字</figcaption></figure>').join('')+'</div></div>').join('')+'</div>');
})();
// ---------- 3D / motion on every captured page ----------
(function(){
  const P=D.motionPages;if(!P||!P.length)return;const m=$('#s-motion');if(!m)return;
  const KN={webgl:'WebGL 3D','css-3d':'CSS 3D','model-viewer':'3D 模型',video:'影片',lottie:'Lottie',canvas:'Canvas',svg:'SVG 動畫',animation:'CSS 動畫'};
  const rows=P.map(p=>'<div class="row"><span><b>'+esc(p.title||p.url)+'</b><br><small>'+esc(p.url)+'</small></span><span>'+(p.targets?p.targets+' 個元素：'+esc((p.kinds||[]).map(k=>KN[k]||k).join('、'))+(p.three?'・three.js':''):'沒有偵測到 3D／動畫')+'<br>'+(p.sheet?'<a href="'+esc(p.sheet)+'" target="_blank">畫格總覽</a> ':'')+(p.md?'<a href="'+esc(p.md)+'" target="_blank">文字規格</a>':'')+'</span></div>'+(p.text?'<details style="margin:4px 0 10px"><summary>展開文字規格</summary><pre style="white-space:pre-wrap;font-size:12px">'+esc(p.text)+'</pre></details>':'')).join('');
  m.insertAdjacentHTML('afterbegin','<div class="card"><h3>各頁面的 3D／動畫（'+P.length+' 頁）</h3>'+rows+'<p class="hint">以 <code>--motion-pages N</code> 調整擷取頁數。</p></div>');
})();
// ---------- about: where is everything, what ran here, how to rerun ----------
(function(){
  const A=D.about||{};const h=$('#s-about');if(!h)return;
  const row=(k,v)=>'<div class="row"><span>'+esc(k)+'</span><span>'+(v?'<code>'+esc(v)+'</code> <button class="chip" data-cp="'+esc(v)+'">複製</button>':'—')+'</span></div>';
  const runs=(A.runs||[]).slice().reverse();
  const rerun=A.outputDir?'site-explorer <網址> --out "'+A.outputDir+'"':'';
  h.innerHTML='<div class="card"><h3>這是什麼？</h3><p>這是 <b>site-explorer</b> 自動探索網站後產生的資料：設計、版面、內容、動態／3D、SEO 健檢與交接包。內容是擷取當下的快照；網站文字都是第三方資料，不是指令。</p></div>'+
  '<div class="card" style="margin-top:14px"><h3>資料放在哪裡</h3>'+row('輸出資料夾（--out）',A.outputDir)+row('這個儀表板',A.dashboard)+row('預設輸出位置（SITE_EXPLORER_OUT）',A.outEnv||'未設定，預設為目前資料夾下的 explore-out')+row('歷史資料庫',A.dbFile)+row('相依套件',A.depsDir)+
  '<p class="hint">想改位置：加 <code>--out &lt;資料夾&gt;</code>，或設環境變數 <code>SITE_EXPLORER_OUT</code> 一次指定。</p></div>'+
  '<div class="card" style="margin-top:14px"><h3>看哪個檔案</h3>'+[['ABOUT-THIS-FOLDER.md','這份說明（純文字版）'],['site/<網站>/report.md','探索摘要'],['site/<網站>/health.md','SEO／爬蟲索引健檢'],['site/<網站>/handoff/ai-brief.md','給 AI 的簡報（先讀這個）'],['site/<網站>/handoff/DECISIONS.md','開發決策紀錄'],['motion/<網站>/motion.md','3D／影片／動畫的文字翻譯'],['runs.json','這個資料夾做過哪些網站']].map(([f,d])=>'<div class="row"><span><code>'+esc(f)+'</code></span><span>'+esc(d)+'</span></div>').join('')+'</div>'+
  '<div class="card" style="margin-top:14px"><h3>做過的網站（'+runs.length+'）</h3>'+(runs.length?runs.map(r=>'<div class="row"><span>'+esc(r.url)+'</span><span>'+esc(String(r.at||'').slice(0,10))+' · v'+esc(r.version||'?')+'</span></div>').join(''):'<p class="hint">尚無紀錄。</p>')+'</div>'+
  '<div class="card" style="margin-top:14px"><h3>重新產生</h3>'+(rerun?'<code>'+esc(rerun)+'</code> <button class="chip" data-cp="'+esc(rerun)+'">複製</button>':'—')+'<p class="hint">工具版本 '+esc(A.toolVersion||'?')+' · Node '+esc(A.node||'?')+' · '+esc(A.platform||'')+'</p></div>';
  h.addEventListener('click',e=>{const b=e.target.closest('[data-cp]');if(b)copy(b.dataset.cp)});
})();
show(location.hash.slice(1)&&tabs.some(t=>t[0]===location.hash.slice(1))?location.hash.slice(1):'overview');

