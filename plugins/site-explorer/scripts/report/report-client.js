// Dashboard UI (runs in the browser; data comes from the JSON element with id "data").
// Output language: window.__EN holds the English dictionary when the dashboard was built with --lang en (keys are the Chinese source strings).
const _t=(f,...v)=>{const E=window.__EN||{};const tg=Array.isArray(f);const k=tg?f.join('{}'):f;const e=E[k];if(e===undefined)return tg?f.reduce((a,x,i)=>a+x+(i<v.length?v[i]:''),''):f;if(!tg)return e;let n=0;return e.replace(/\{(\d*)\}/g,(m,i)=>{const j=i===''?n++:Number(i);return j<v.length?String(v[j]):m})};
const D=JSON.parse(document.getElementById('data').textContent);
const $=(s,r=document)=>r.querySelector(s),el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstChild};
const css=(s)=>String(s??'').replace(/[;"<>(){}\\@]/g,'');
const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const T=D.tokens,S=D.site,M=D.motion;
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1400)};
const copy=(v)=>{navigator.clipboard?.writeText(v);toast(_t('已複製 ')+v)};
$('#sub').textContent=(S?.startUrl||M?.url||'')+' · '+new Date(D.generatedAt).toLocaleString();
if(S&&S.authenticated)$('#sub').textContent+=_t(' · 🔐 以登入狀態探索：內容可能含個人資料，請勿公開分享');

const tabs=[['overview',_t('總覽')],['design',_t('設計')],['layout',_t('排版')],['content',_t('內容')],['motion',_t('3D／動畫')],['edit',_t('編輯方式')],['health',_t('健檢')],['history',_t('歷史')],['export',_t('匯出給 AI')],['data',_t('詳細資料')],['about',_t('關於')]].filter(([k])=>k==='overview'||(k==='health'?D.health:k==='motion'?(M||D.motionPages):k==='history'?(D.history&&D.history.runs.length>0):k==='export'?D.exportKit:k==='data'||k==='about'?true:S));
tabs.forEach(([k,l],i)=>{const b=el('<button role="tab">'+l+'</button>');b.dataset.k=k;if(k==='data')b.classList.add('dt-tab');b.onclick=()=>show(k);$('#tabs').append(b)});
function show(k){if(k==='data'&&!document.body.classList.contains('detail'))setDetail(true);document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id==='s-'+k));document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.k===k));history.replaceState(null,'','#'+k)}

// ---------- overview ----------
(function(){
  const o=$('#s-overview');const c=T?.color||{};const plat=S?.editing?.platforms||[];
  const ms=M?M.targets.length:0;
  const sentences=[];
  if(S){sentences.push(_t('共探索 <b>')+S.pages.length+_t('</b> 頁，')+(plat.length?_t('偵測到 <b>')+plat.map(p=>esc(p.platform)).join(_t('、'))+_t('</b> 建站特徵'):_t('未偵測到常見建站平台（可能是自訂程式或靜態站）'))+_t('。'));}
  if(T){sentences.push(_t('主色 <b style="color:')+(c.brand||'inherit')+'">'+esc(c.brand||'—')+_t('</b>，標題字型 <b>')+esc(T.typography.fontStack.heading||'?')+_t('</b>，間距以 <b>')+T.spacing.baseUnit+_t('px</b> 為基準。'));}
  if(M){sentences.push(ms?_t('發現 <b>')+ms+_t('</b> 個 3D／動畫元素')+(Object.entries(M.libs).filter(([,v])=>v===true).length?_t('，使用 ')+Object.entries(M.libs).filter(([,v])=>v===true).map(([k])=>'<b>'+k+'</b>').join(_t('、')):'')+_t('。'):_t('沒有發現 3D 或動畫元素。'));}
  o.innerHTML='<div class="grid g3">'+
   (S?_t('<div class="card"><h3>頁面</h3><div class="big">')+S.pages.length+_t('</div><div class="hint">耗時 ')+S.seconds+_t(' 秒</div></div>'):'')+
   (T?_t('<div class="card"><h3>色彩</h3><div class="big">')+T.palette.length+'</div><div class="hint">'+Object.keys(c).length+_t(' 個角色色</div></div>'):'')+
   (M?_t('<div class="card"><h3>3D／動畫</h3><div class="big">')+ms+_t('</div><div class="hint">WebGL 實例 ')+M.webglContexts.length+_t('・3D 素材 ')+M.assets3d.length+'</div></div>':'')+
   (D.health?_t('<div class="card"><h3>網站健檢</h3><div class="big" style="color:')+(D.health.score>=80?'var(--ok)':D.health.score>=60?'var(--warn)':'#dc2626')+'">'+D.health.score+' <span style="font-size:16px">'+D.health.grade+'</span></div><div class="hint">'+D.health.severity.critical+_t(' 嚴重・')+D.health.severity.high+_t(' 高・')+D.health.severity.medium+_t(' 中</div></div>'):'')+
   (plat.length?_t('<div class="card"><h3>平台</h3><div class="big" style="font-size:20px">')+plat.map(p=>esc(p.platform)).join(' / ')+'</div></div>':'')+
  _t('</div><div class="card" style="margin-top:14px"><h3>重點摘要</h3>')+sentences.map(s=>'<p class="say">'+s+'</p>').join('')+'</div>'+
  (T?_t('<div class="card" style="margin-top:14px"><h3>色彩速覽</h3><div style="display:flex;height:44px;border-radius:8px;overflow:hidden">')+T.palette.slice(0,10).map(p=>'<div title="'+p.hex+'" style="flex:'+Math.max(1,Math.log2(p.uses+1))+';background:'+p.hex+'"></div>').join('')+'</div></div>':'')+
  (S?.assets?.length?_t('<div class="card" style="margin-top:14px"><h3>品牌素材</h3><div class="imgs">')+S.assets.map(a=>'<div><img src="'+a.src+'" style="object-fit:contain;background:#8884"><div class="hint">'+esc(a.name)+'</div></div>').join('')+'</div></div>':'');

  const blocked=S?.blockedPages||[];
  if(blocked.length)o.insertAdjacentHTML('afterbegin',_t('<div class="card" style="border-color:var(--warn);margin-bottom:14px"><h3 style="color:var(--warn)">⚠️ 部分頁面被擋住</h3><p>')+blocked.map(b=>esc(b.reason)+_t('：')+esc(b.url)).join('<br>')+_t('</p><p class="hint">以下結果可能不完整。可降低頻率、確認你有權存取，或請 Claude 用瀏覽器工具互動補查。</p></div>'));
  const steps=[];
  if(D.health){const t=D.health.issues.filter(i=>['critical','high'].includes(i.severity))[0];steps.push([_t('先處理 SEO／索引問題'),t?esc(t.title)+_t('（共 ')+D.health.issues.filter(i=>['critical','high'].includes(i.severity)).length+_t(' 項嚴重／高優先，見「健檢」分頁）'):_t('沒有嚴重問題，可到「健檢」分頁看中低優先建議')]);}
  if(S)steps.push([_t('把這個風格變成 Claude Design 的設計系統'),_t('在 Claude Code 輸入：<code>/site-explorer:to-design ')+esc(S.startUrl)+'</code>']);
  if(D.files.length)steps.push([_t('給開發者的檔案'),D.files.map(f=>'<a href="'+f.href+'" download="'+esc(f.name)+'">'+esc(f.name)+'</a>').join(_t('　'))]);
  if(T&&(T.contrastAudit||[]).some(a=>!a.pass))steps.push([_t('修正對比不足'),_t('有 ')+T.contrastAudit.filter(a=>!a.pass).length+_t(' 項文字／按鈕對比低於 4.5:1，改版時建議調深前景或底色')]);
  if(M&&M.targets.length)steps.push([_t('理解動畫'),_t('到「3D／動畫」分頁播放畫格；要推算節奏與觸發方式，請 Claude 逐張檢視畫格並對照 motion.json')]);
  if(D.history&&D.history.runs.length>1)steps.push([_t('追蹤改版'),_t('這個網站已有 ')+D.history.runs.length+_t(' 次紀錄，見「歷史」分頁')]);
  steps.push([_t('比較其他網站'),_t('終端機：<code>node scripts/db.mjs search --lib three</code>、<code>node scripts/db.mjs list</code>')]);
  o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>下一步可以做什麼</h3>')+steps.map(x=>'<p class="say"><b>'+x[0]+'</b><br><span class="hint">'+x[1]+'</span></p>').join('')+'</div>');

  if(S){const rb=(S.robotsDisallow||[]);
    o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>探索紀錄（可稽核）</h3>')+
      _t('<div class="spec"><small>時間</small><span>')+esc(new Date(S.crawledAt).toLocaleString())+_t('，耗時 ')+S.seconds+_t(' 秒</span></div>')+
      _t('<div class="spec"><small>範圍</small><span>共讀取 ')+S.pages.length+_t(' 個頁面（同網域），')+((S.skippedByRobots||[]).length)+_t(' 個因 robots.txt 略過</span></div>')+
      '<div class="spec"><small>robots.txt</small><span>'+(rb.length?_t('已遵守 ')+rb.length+_t(' 條 Disallow：')+esc(rb.slice(0,5).join(', ')):_t('無限制或未提供'))+'</span></div>'+
      _t('<div class="spec"><small>身分</small><span>')+esc(S.userAgent||'site-explorer')+_t('（明確標示為自動化工具）</span></div>')+
      _t('<div class="spec"><small>互動</small><span>未登入、未送出表單、未繞過驗證')+(S.consentAction?_t('；Cookie 橫幅：「')+esc(S.consentAction)+_t('」'):'')+'</span></div>'+
      (S.tool&&S.tool.version?_t('<div class="spec"><small>工具版本</small><span>site-explorer ')+esc(S.tool.version)+'</span></div>':'')+
      _t('<p class="hint">本報告為對公開頁面的觀察結果，僅供研究與參考；字型、圖片、文案、3D 素材仍受原權利人保護。</p></div>'));}
  if(D.standalone&&D.embed.skipped>0)o.insertAdjacentHTML('afterbegin',_t('<div class="card" style="margin-bottom:14px"><span class="chip warn">部分檔案未內嵌</span> 有 ')+D.embed.skipped+_t(' 個檔案超過內嵌上限，僅以相對路徑連結；搬移此 HTML 時請連同資料夾，或調高 <code>--embed-mb</code>。</div>'));
})();

// ---------- design ----------
(function(){
  if(!T)return;const d=$('#s-design');const c=T.color;
  const role={brand:_t('品牌色'),accent:_t('輔助色'),background:_t('背景'),surface:_t('表面'),'surface-dark':_t('深色表面'),text:_t('文字'),border:_t('邊框'),'text-inverse':_t('反白文字')};
  const sw=(hex,name,sub)=>'<button onclick="copy(\''+hex+'\')"><i style="background:'+hex+'"></i><span><b>'+esc(name)+'</b>'+hex+(sub?' · '+sub:'')+'</span></button>';
  const type=Object.entries(T.typography.scale).map(([k,v])=>'<div class="spec"><small>'+k+' · '+v.size+'<br>'+v.weight+'</small><span style="font:'+v.weight+' '+v.size+'/'+(v.lineHeight==='normal'?'1.3':v.lineHeight)+' '+css(v.family)+',system-ui;letter-spacing:'+v.letterSpacing+_t('">The quick brown fox 設計範例 123</span></div>')).join('');
  const sp=T.spacing.observed;const maxSp=Math.max(...sp,1);
  const btns=(window.__b=(S?.components?.buttons||[]).slice(0,4));
  const audit=T.contrastAudit||[];
  d.innerHTML=_t('<div class="card"><h3>色彩角色（點擊複製）</h3><div class="sw">')+Object.entries(c).map(([k,v])=>sw(v,role[k]||k)).join('')+'</div>'+
   _t('<h3 style="margin-top:18px">完整色盤</h3><div class="sw">')+T.palette.map(p=>sw(p.hex,p.kind==='neutral'?_t('中性'):_t('彩色'),p.uses+_t('次'))).join('')+'</div></div>'+
   _t('<div class="grid g2" style="margin-top:14px"><div class="card"><h3>字型階層（實際渲染）</h3>')+type+_t('<p class="hint">標題：')+esc(T.typography.fontStack.heading)+_t('・內文：')+esc(T.typography.fontStack.body)+(T.typography.scaleRatio?_t('・級距比 ≈ ')+T.typography.scaleRatio:'')+'</p></div>'+
   _t('<div class="card"><h3>間距（基準 ')+T.spacing.baseUnit+_t('px）</h3><div class="bars">')+sp.map(n=>'<div><span style="width:46px">'+n+'px</span><i style="width:'+(n/maxSp*100)+'%"></i></div>').join('')+'</div>'+
   _t('<h3 style="margin-top:18px">圓角</h3><div class="shapes">')+(T.radius.length?T.radius.map(r=>'<div style="border-radius:'+r+'">'+r+'</div>').join(''):_t('<span class="hint">直角設計</span>'))+'</div>'+
   _t('<h3 style="margin-top:18px">陰影</h3><div class="shapes shadows">')+(T.shadow.length?T.shadow.map(s=>'<div style="box-shadow:'+s+_t('">陰影</div>')).join(''):_t('<span class="hint">平面設計</span>'))+'</div></div></div>'+
   _t('<div class="grid g2" style="margin-top:14px"><div class="card"><h3>按鈕（滑過看 hover）</h3>')+(btns.length?btns.map(b=>'<button style="margin:4px;cursor:pointer;background:'+css(b.backgroundColor)+';color:'+css(b.color)+';border:'+(parseFloat(b.borderTopWidth)?b.borderTopWidth+' solid '+b.borderTopColor:'0')+';border-radius:'+css(b.borderRadius)+';padding:'+css(b.padding)+';font:'+css(b.fontWeight)+' '+css(b.fontSize)+' '+css(b.fontFamily)+';transition:filter .15s" onmouseover="this.style.filter=\'brightness(.88)\'" onmouseout="this.style.filter=\'\'">'+esc(b.text||_t('按鈕'))+'</button>').join(''):_t('<span class="hint">未找到按鈕</span>'))+
   (T.buttonHover?_t('<p class="hint">實測 hover：')+T.buttonHover.before.backgroundColor+' → '+T.buttonHover.after.backgroundColor+'</p>':'')+'</div>'+
   _t('<div class="card"><h3>無障礙對比</h3>')+(audit.length?audit.map(a=>'<div class="spec"><small><span class="chip '+(a.pass?'ok':'warn')+'">'+a.ratio+':1</span></small><span style="background:'+a.bg+';color:'+a.fg+';padding:4px 12px;border-radius:6px">'+esc(a.name)+'</span></div>').join(''):_t('<span class="hint">無資料</span>'))+
   _t('<h3 style="margin-top:18px">斷點</h3><div style="display:flex;gap:6px;flex-wrap:wrap">')+(T.breakpoints.length?T.breakpoints.map(b=>'<span class="chip">'+b+'px</span>').join(''):_t('<span class="hint">未偵測</span>'))+'</div>'+
   (T.darkMode?.supported?_t('<h3 style="margin-top:18px">深色模式</h3><div style="display:flex;gap:8px"><div style="flex:1;padding:10px;border-radius:8px;background:')+T.darkMode.light.background+';color:'+T.darkMode.light.color+_t('">淺色</div><div style="flex:1;padding:10px;border-radius:8px;background:')+T.darkMode.dark.background+';color:'+T.darkMode.dark.color+_t('">深色</div></div>'):'')+'</div></div>';
})();

// ---------- design: designer extras ----------
(function(){
  const d=$('#s-design');const dz=S?.designer;if(!d||!S)return;
  const PROV={google:['Google Fonts','ok',_t('可免費商用')],system:[_t('系統字體'),'',_t('各平台外觀不同')],adobe:['Adobe Fonts','warn',_t('需訂閱授權')],'self-hosted':[_t('自架字型檔'),'warn',_t('可能需授權')],unknown:[_t('來源不明'),'warn',_t('需自行確認')]};
  const src=T?.typography?.sources||[];
  let h='';
  if(src.length)h+=_t('<div class="card" style="margin-top:14px"><h3>字型來源與替代建議</h3>')+src.map(f=>{const pv=PROV[f.provider]||PROV.unknown;
    return '<div class="fnt"><div><b>'+esc(f.family)+'</b><div class="hint">'+(f.weights.length?_t('字重 ')+f.weights.map(esc).join(', '):'')+'</div></div><div><span class="chip '+pv[1]+'">'+pv[0]+'</span><div class="hint">'+pv[2]+'</div></div><div>'+(f.url?'<a href="'+esc(f.url)+_t('" target="_blank" rel="noopener">在 Google Fonts 開啟 ↗</a>'):f.substitute?_t('替代：<a href="')+esc(f.substituteUrl)+'" target="_blank" rel="noopener"><b>'+esc(f.substitute)+'</b> ↗</a>':'<span class="hint">—</span>')+'</div></div>'}).join('')+'</div>';
  h+='<div class="grid g2" style="margin-top:14px">';
  const g=dz.grid||{},m=dz.motion||{};
  h+=_t('<div class="card"><h3>版面網格</h3><p class="say">容器寬 <b>')+((g.containerWidths||[]).map(x=>x.px+'px').join(' / ')||'?')+_t('</b>　欄數 <b>')+((g.columns||[]).map(x=>x.columns).join(' / ')||'?')+_t('</b>　間距 <b>')+((g.gaps||[]).map(x=>x.value).join(' / ')||'?')+'</b></p><div style="display:flex;gap:6px;height:46px;max-width:420px">'+Array.from({length:(g.columns&&g.columns[0]?g.columns[0].columns:12)},()=>'<i style="flex:1;background:color-mix(in srgb,var(--acc) 30%,transparent);border-radius:3px"></i>').join('')+_t('</div><p class="hint">依實際 grid／置中容器推算，可直接當作 Figma layout grid 參考。</p></div>');
  h+=_t('<div class="card"><h3>動態節奏（transition／animation）</h3>')+((m.transitions||[]).map(x=>'<div class="spec"><small>×'+x.count+'</small><code>'+esc(x.token)+'</code></div>').join('')||_t('<span class="hint">沒有 transition</span>'))+((m.animations||[]).map(x=>_t('<div class="spec"><small>動畫 ×')+x.count+'</small><code>'+esc(x.token)+'</code></div>').join(''))+'</div></div>';
  const cf=(dz.contrast&&dz.contrast.failing)||[];
  h+=_t('<div class="card" style="margin-top:14px"><h3>真實背景上的對比檢查（掃描 ')+(dz.contrast?dz.contrast.checked:0)+_t(' 個文字元素）</h3>')+(cf.length?cf.map(c=>'<div class="spec"><small><span class="chip warn">'+c.ratio+_t(':1</span><div class="hint">需 ')+c.need+'</div></small><span style="background:'+c.bg+';color:'+c.fg+';padding:6px 14px;border-radius:8px;font-size:'+(c.large?'22px':'15px')+'">'+esc(c.sample||_t('Aa 範例文字'))+'</span><span class="hint">'+c.fg+' on '+c.bg+_t(' · 出現 ')+c.count+_t(' 次')+(c.uncertain?_t(' · 背景有圖片，請人工確認'):'')+'</span></div>').join(''):_t('<p>✅ 沒有發現對比不足的文字。</p>'))+'</div>';
  if(dz.icons&&dz.icons.length)h+=_t('<div class="card" style="margin-top:14px"><h3>行內圖示（')+dz.icons.length+_t('）</h3><div class="icons">')+dz.icons.map(i=>'<div><img alt="" src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(i.svg)+'"></div>').join('')+_t('</div><p class="hint">以圖片方式顯示（不執行腳本）。圖示受版權或授權保護，僅供參考。</p></div>');
  const ex=D.files.filter(f=>/palette.svg|tokens.studio|tailwind|tokens.css|w3c/.test(f.name));
  if(ex.length)h+=_t('<div class="card" style="margin-top:14px"><h3>帶走（Figma／開發）</h3>')+ex.map(f=>'<a href="'+f.href+'" download="'+esc(f.name)+'" style="margin-right:14px">'+esc(f.name)+'</a>').join('')+_t('<p class="hint">palette.svg 拖進 Figma 即成色票；tokens.studio.json 用 Tokens Studio 外掛匯入。</p></div>');
  d.insertAdjacentHTML('beforeend',h);
})();

// ---------- layout ----------
const KIND={header:_t('頁首'),hero:_t('主視覺 Hero'),features:_t('功能／特色格'),pricing:_t('價格方案'),testimonial:_t('客戶見證'),faq:'FAQ',form:_t('表單'),logos:_t('Logo 牆'),stats:_t('數據亮點'),gallery:_t('圖庫'),cta:_t('行動呼籲 CTA'),footer:_t('頁尾'),content:_t('內容區')};
const KCOL={header:'#64748b',hero:'#7c3aed',features:'#2563eb',pricing:'#059669',testimonial:'#d97706',faq:'#0891b2',form:'#db2777',logos:'#475569',stats:'#ca8a04',gallery:'#9333ea',cta:'#dc2626',footer:'#475569',content:'#94a3b8'};
const kchip=(k)=>'<span class="kind" style="background:'+(KCOL[k]||'#94a3b8')+'">'+esc(KIND[k]||k)+'</span>';
const lumOf=(h)=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const ratioOf=(a,b)=>{const x=lumOf(a),y=lumOf(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05))};
(function(){
  if(!D.pages.length)return;const l=$('#s-layout');let pi=Math.max(0,D.pages.findIndex(q=>(q.sections&&q.sections.length)||(q.blocks&&q.blocks.length))),mode='shot',vp='desktop',inspect=true;
  const MODES=[['shot',_t('截圖／檢視元素')],['slices',_t('區塊切片')],['skeleton',_t('頁面骨架')],['side',_t('響應式並排')]];
  function draw(){
    const p=D.pages[pi];
    l.innerHTML='<div class="card"><select id="pg">'+D.pages.map((q,i)=>'<option value="'+i+'"'+(i===pi?' selected':'')+'>'+esc(q.title||q.url)+(q.emptyPage?_t('（空白頁，沒有版面）'):'')+'</option>').join('')+'</select> '+
      '<div class="seg" style="margin-left:8px">'+MODES.map(m=>'<button data-mode="'+m[0]+'" aria-pressed="'+(m[0]===mode)+'">'+m[1]+'</button>').join('')+'</div>'+
      (p.mobileOverflow?_t('<span class="chip warn">手機版橫向溢出</span>'):'')+
      (p.emptyPage?_t('<div class="hint" style="color:#dc2626;margin:6px 0">這一頁在擷取時幾乎是空的，沒有版面可顯示（原因見「總覽」的紅色警告）。</div>'):'')+
      (p.blocks.length?'<div style="margin:4px 0 10px">'+p.blocks.map(b=>kchip(b.kind)).join(' <span class="hint">→</span> ')+'</div>':'')+
      '<div id="lbody"></div></div>';
    $('#pg').onchange=(e)=>{pi=+e.target.value;draw()};
    l.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;draw()});
    const body=$('#lbody',l);
    ({shot:shotView,slices:slicesView,skeleton:skelView,side:sideView})[mode](p,body);
  }
  function shotView(p,body){
    body.innerHTML='<div class="seg">'+['desktop','tablet','mobile'].map(v=>'<button data-v="'+v+'" aria-pressed="'+(v===vp)+'">'+({desktop:_t('桌機 1440'),tablet:_t('平板 768'),mobile:_t('手機 390')})[v]+'</button>').join('')+'</div>'+
      (vp==='desktop'&&p.elements.length?'<div class="seg"><button id="tgI" aria-pressed="'+inspect+_t('">🔍 檢視元素：')+(inspect?_t('開'):_t('關'))+_t('</button></div><span class="hint">游標移到畫面上的元素，右側顯示字型、色碼、間距；點擊釘選並複製 CSS</span>'):'')+
      '<div class="shot"><div class="frame">'+(p.shots[vp]?'<span class="wrapimg" id="wi"><img src="'+p.shots[vp]+'" id="shotimg"><div class="ov" id="ov"></div></span>':_t('<div class="empty">沒有截圖（使用了 --no-screenshots？）</div>'))+'</div>'+
      (vp==='desktop'&&p.elements.length&&inspect?_t('<div class="insp card" id="insp"><h3>元素資訊</h3><div class="hint">把游標移到左側畫面</div></div>'):_t('<div class="map"><h3>區塊地圖</h3>')+mapHtml(p)+'</div>')+'</div>';
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
      row(_t('尺寸'),e.w+' × '+e.h)+row(_t('字型'),esc(e.font))+row(_t('字級／字重'),esc(e.size)+' / '+esc(e.weight))+row(_t('行高'),esc(e.lh))+row(_t('字距'),e.ls!=='normal'?esc(e.ls):'')+
      row(_t('文字色'),sw(e.color))+row(_t('背景色'),sw(e.bg))+row(_t('對比'),'<span class="chip '+(r>=4.5?'ok':'warn')+'">'+r.toFixed(2)+':1</span>')+
      row(_t('內距'),e.pad!=='0px'?esc(e.pad):'')+row(_t('外距'),e.margin!=='0px'?esc(e.margin):'')+row(_t('圓角'),e.radius!=='0px'?esc(e.radius):'')+row(_t('陰影'),e.shadow?esc(e.shadow):'')+row(_t('邊框'),e.border?esc(e.border):'')+row(_t('版型'),esc(e.display)+(e.gap?' gap '+esc(e.gap):''))+
      '<div class="hint" style="margin-top:8px">'+(pinned?_t('已複製 CSS'):_t('點擊釘選並複製 CSS'))+'</div>';
  }
  function mapHtml(p){const total=Math.max(p.docHeight,1);
    if(p.blocks.length)return p.blocks.map(b=>'<div style="height:'+Math.max(16,b.h/total*420)+'px;background:'+(KCOL[b.kind]||'#94a3b8')+';color:#fff;border-color:transparent" title="'+esc(b.text)+'">'+esc(KIND[b.kind]||b.kind)+'<br>'+b.h+'px</div>').join('');
    return p.sections.length?p.sections.map(s=>'<div style="height:'+Math.max(14,s.height/total*420)+'px" title="'+esc(s.class)+'">&lt;'+s.tag+'&gt; '+esc(s.heading||'')+'<br>'+s.height+'px</div>').join(''):_t('<span class="hint">無法辨識區塊</span>');}
  function slicesView(p,body){
    if(!p.shots.desktop||!p.blocks.length){body.innerHTML=_t('<div class="empty">需要桌機截圖與區塊資料（請勿使用 --no-screenshots）</div>');return}
    const W=Math.min(body.clientWidth||l.clientWidth-60,1100)||800,sc=W/1440;
    body.innerHTML=_t('<p class="hint">自動把頁面切成區塊並辨識版型。每一段都是原截圖的裁切，可逐段研究。</p>')+p.blocks.map((b,i)=>{const H=Math.min(b.h*sc,520);
      return '<div class="slice"><div class="top">'+kchip(b.kind)+'<b>'+esc(b.heading||b.text.slice(0,50)||_t('（無文字）'))+'</b><span class="hint">'+b.w+'×'+b.h+_t('px · 欄數 ')+b.columns+_t(' · 標題 ')+b.headings+_t(' · 按鈕 ')+b.buttons+_t(' · 媒體 ')+b.media+'</span></div>'+
        '<div class="crop" data-bg="'+p.shots.desktop+'" style="width:'+W+'px;max-width:100%;height:'+H+'px;background-size:'+W+'px auto;background-position:0 -'+(b.y*sc)+'px"></div>'+(b.h*sc>520?_t('<div class="hint" style="padding:4px 12px">（區塊較高，僅顯示上半部）</div>'):'')+'</div>'}).join('');
    body.querySelectorAll('.crop').forEach(c=>{c.style.backgroundImage='url("'+c.dataset.bg+'")'});
  }
  function skelView(p,body){
    if(!p.blocks.length){body.innerHTML=_t('<div class="empty">沒有區塊資料</div>');return}
    const seq=p.blocks.map(b=>KIND[b.kind]||b.kind).join(' → ');
    body.innerHTML=_t('<p class="say">頁面骨架：<b>')+esc(seq)+'</b></p><div class="skel">'+p.blocks.map(b=>{const h=Math.max(34,Math.min(b.h*.14,150));const cols=Math.min(b.columns,6);
      return '<div class="b" style="background:'+(KCOL[b.kind]||'#94a3b8')+';height:'+h+'px"><b>'+esc(KIND[b.kind]||b.kind)+' · '+b.h+'px'+(b.columns>1?' · '+b.columns+_t(' 欄'):'')+'</b>'+(cols>1?'<div class="cols">'+Array.from({length:cols},()=>'<i></i>').join('')+'</div>':'<div class="ln" style="width:70%"></div><div class="ln" style="width:45%"></div>')+'</div>'}).join('')+'</div>'+
      _t('<p class="hint">想做同類型頁面時，直接依這個順序規劃區塊；也可交給 Claude Design 照骨架產出線框。<br>⚠️ 版型是依 DOM 規則推測（每個區塊的「推測依據」見「區塊切片」），遇到非行銷型頁面（文章、後台）請以截圖為準。</p>');
  }
  function sideView(p,body){
    const devs=[['desktop',_t('桌機 1440'),.3],['tablet',_t('平板 768'),.3],['mobile',_t('手機 390'),.3]].filter(d=>p.shots[d[0]]);
    if(!devs.length){body.innerHTML=_t('<div class="empty">沒有截圖</div>');return}
    body.innerHTML=_t('<p class="hint">三種尺寸等比例並排，捲動會同步，直接看版面如何重排。</p><div class="side">')+devs.map(d=>{const w={desktop:1440,tablet:768,mobile:390}[d[0]]*d[2];return '<div class="dev"><h4>'+d[1]+'</h4><div class="scr" data-s style="width:'+w+'px;height:680px"><img src="'+p.shots[d[0]]+'" style="width:'+w+'px;display:block"></div></div>'}).join('')+'</div>';
    const sc=[...body.querySelectorAll('[data-s]')];let lock=false;
    sc.forEach(a=>a.addEventListener('scroll',()=>{if(lock)return;lock=true;const r=a.scrollTop/Math.max(1,a.scrollHeight-a.clientHeight);sc.forEach(b=>{if(b!==a)b.scrollTop=r*(b.scrollHeight-b.clientHeight)});requestAnimationFrame(()=>lock=false)}));
  }
  draw();
})();

// ---------- content ----------
(function(){
  if(!D.pages.length)return;const c=$('#s-content');let pi=0;
  function draw(){const p=D.pages[pi];
    c.innerHTML=_t('<div class="card"><table><tr><th>頁面</th><th>狀態</th><th>H1</th><th>連結</th></tr>')+D.pages.map((q,i)=>'<tr style="cursor:pointer;'+(i===pi?'background:color-mix(in srgb,var(--acc) 10%,transparent)':'')+'" data-i="'+i+'"><td>'+esc(q.title||q.url)+'<div class="hint">'+esc(q.url)+'</div></td><td>'+q.status+'</td><td>'+esc(q.headings.filter(h=>h.level===1).map(h=>h.text).join(' / '))+'</td><td>'+q.linkCount+'</td></tr>').join('')+'</table></div>'+
    _t('<div class="grid g2" style="margin-top:14px"><div class="card"><h3>標題大綱</h3>')+(p.headings.map(h=>'<div class="h" style="--l:'+(h.level-1)+'"><em>H'+h.level+'</em>'+esc(h.text)+'</div>').join('')||_t('<span class="hint">無標題</span>'))+'</div>'+
    _t('<div class="card"><h3>主要文案</h3>')+(p.paragraphs.map(t=>'<p>'+esc(t.slice(0,220))+'</p>').join('')||_t('<span class="hint">無</span>'))+(p.forms.length?_t('<h3>表單</h3>')+p.forms.map(f=>'<div class="hint">'+f.method.toUpperCase()+' '+esc(f.action)+' — '+f.fields.map(x=>esc(x.name)).join(', ')+'</div>').join(''):'')+'</div></div>'+
    _t('<div class="card" style="margin-top:14px"><h3>圖片（')+p.images.length+_t('）</h3><div class="imgs">')+p.images.map(i=>'<img loading="lazy" src="'+esc(i.src)+'" title="'+esc(i.alt)+'" onerror="this.style.display=\'none\'">').join('')+'</div></div>';

    const dzc=S&&S.designer&&S.designer.copy;
    if(dzc&&(dzc.ctas.length||dzc.nav.length))c.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>文案盤點</h3><p><b>按鈕文案：</b>')+(dzc.ctas.map(x=>'<span class="chip">'+esc(x.text)+(x.count>1?' ×'+x.count:'')+'</span>').join('')||'—')+_t('</p><p><b>導覽項目：</b>')+(dzc.nav.map(x=>'<span class="chip">'+esc(x)+'</span>').join('')||'—')+'</p></div>');
    c.querySelectorAll('tr[data-i]').forEach(r=>r.onclick=()=>{pi=+r.dataset.i;draw()})}
  draw();
})();

// ---------- motion ----------
(function(){
  if(!M)return;const m=$('#s-motion');
  const libs=Object.entries(M.libs).filter(([,v])=>v).map(([k,v])=>'<span class="chip">'+esc(k)+(typeof v==='string'?' '+esc(v):'')+'</span>').join('');
  m.innerHTML=_t('<div class="card"><h3>技術</h3>')+(libs||_t('<span class="hint">未偵測到已知 3D 函式庫</span>'))+'<span class="chip">WebGL ×'+M.webglContexts.length+'</span>'+
   (M.assets3d.length?_t('<h3 style="margin-top:12px">3D 素材</h3>')+M.assets3d.map(a=>'<div class="hint">'+esc(a)+'</div>').join(''):'')+
   (M.video?_t('<h3 style="margin-top:12px">錄影</h3><video src="')+M.video+'" controls style="max-width:100%;border-radius:8px"></video>':'')+'</div><div id="targets"></div>';
  const wrap=$('#targets',m);
  const kindName={webgl:'WebGL 3D','css-3d':'CSS 3D',canvas:'Canvas',canvas2d:'Canvas 2D',video:_t('影片'),'css-animation':_t('CSS 動畫'),'model-viewer':'model-viewer'};
  M.targets.forEach(t=>{
    const card=el('<div class="card" style="margin-top:14px"></div>');
    const modes=['idle','hover','drag'].filter(k=>t.frames[k].length);let mode=modes[0],i=0,timer=null;
    card.innerHTML='<h3>'+(kindName[t.kind]||t.kind)+' · '+esc(t.selector)+'</h3><div>'+(t.animatesOnItsOwn?_t('<span class="chip ok">會自己動</span>'):_t('<span class="chip">靜置不動</span>'))+(t.reactsToMouse?_t('<span class="chip ok">回應滑鼠</span>'):'')+'<span class="chip">'+t.box.w+'×'+t.box.h+'</span></div>'+
     '<div class="seg" style="margin-top:10px">'+modes.map(k=>'<button data-m="'+k+'">'+({idle:_t('自走'),hover:_t('滑鼠掃過'),drag:_t('拖曳')})[k]+'</button>').join('')+'</div>'+
     _t('<div class="player"><div class="stage"><img></div></div><div class="ctrl"><button class="pl">▶ 播放</button><input type="range" min="0" value="0"><span class="hint cnt"></span></div><div class="film"></div>');
    const img=$('img',card),rng=$('input',card),film=$('.film',card),cnt=$('.cnt',card);
    const set=(n)=>{const fr=t.frames[mode];i=(n+fr.length)%fr.length;img.src=fr[i];rng.value=i;cnt.textContent=(i+1)+' / '+fr.length;film.querySelectorAll('img').forEach((x,j)=>x.classList.toggle('cur',j===i))};
    const load=()=>{const fr=t.frames[mode];rng.max=fr.length-1;film.innerHTML='';fr.forEach((f,j)=>{const x=el('<img src="'+f+'" loading="lazy">');x.onclick=()=>set(j);film.append(x)});card.querySelectorAll('[data-m]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===mode));set(0)};
    card.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{mode=b.dataset.m;load()});
    rng.oninput=()=>set(+rng.value);
    $('.pl',card).onclick=(e)=>{if(timer){clearInterval(timer);timer=null;e.target.textContent=_t('▶ 播放')}else{timer=setInterval(()=>set(i+1),250);e.target.textContent=_t('⏸ 暫停')}};
    if(modes.length){load()}else card.append(el(_t('<div class="empty">沒有畫格</div>')));
    wrap.append(card);
  });
  if(!M.targets.length)wrap.append(el(_t('<div class="card empty" style="margin-top:14px">沒有偵測到 3D 或動畫元素。若網站是互動體驗頁，請調大 --wait 後重跑。</div>')));
  if(M.scroll.length){const sc=el(_t('<div class="card" style="margin-top:14px"><h3>捲動序列（拖動滑桿＝捲動頁面）</h3><div class="player"><div class="stage"><img></div></div><div class="ctrl"><input type="range" min="0" max="')+(M.scroll.length-1)+'" value="0"><span class="hint">'+M.scrollChangedFrames+' / '+M.scrollFrames+_t(' 張畫面不同</span></div></div>'));const im=$('img',sc),r=$('input',sc);im.src=M.scroll[0];r.oninput=()=>im.src=M.scroll[r.value];m.append(sc)}
  if(M.cssKeyframes.length||M.shaderSamples.length)m.append(el(_t('<div class="card" style="margin-top:14px"><h3>原始線索</h3>')+(M.cssKeyframes.length?_t('<details><summary>CSS keyframes（')+M.cssKeyframes.length+_t('）</summary><pre>')+esc(JSON.stringify(M.cssKeyframes,null,2))+'</pre></details>':'')+(M.shaderSamples.length?_t('<details><summary>Shader 片段（')+M.shaderSamples.length+_t('）</summary><pre>')+esc(M.shaderSamples.join('\n\n----\n\n'))+'</pre></details>':'')+'</div>'));
})();

// ---------- editing ----------
(function(){
  if(!S)return;const e=$('#s-edit');const E=S.editing;
  e.innerHTML='<div class="grid g2">'+(E.platforms.length?E.platforms.map(p=>_t('<div class="card"><h3>偵測到的平台</h3><div class="big" style="font-size:20px">')+esc(p.platform)+'</div><p>'+esc(p.howToEdit)+'</p>'+Object.entries(p.adminProbes).map(([k,v])=>'<span class="chip '+(v===200||v===301||v===302?'ok':'')+'">'+esc(k)+' → '+v+'</span>').join('')+'</div>').join(''):_t('<div class="card"><h3>平台</h3><p>未偵測到已知建站平台，可能是自訂程式或靜態站。</p></div>'))+
   _t('<div class="card"><h3>伺服器線索</h3><p>Server：')+esc(S.server.server||'?')+_t('<br>X-Powered-By：')+esc(S.server.poweredBy||'?')+_t('<br>Generator：')+esc(S.server.generator||'?')+_t('</p><h3>登入／後台連結</h3>')+(E.loginOrAdminLinks.map(l=>'<div class="hint">'+esc(l.text)+' → '+esc(l.href)+'</div>').join('')||_t('<span class="hint">無</span>'))+_t('<p class="hint">可直接編輯頁面（contenteditable）：')+E.contenteditablePages.length+'</p></div></div>';
})();

// ---------- health (SEO / indexability) ----------
(function(){
  const H=D.health;if(!H)return;const h=$('#s-health');
  const SEVN={critical:_t('嚴重'),high:_t('高'),medium:_t('中'),low:_t('低'),info:_t('資訊')};
  const col=(v)=>v>=80?'var(--ok)':v>=60?'var(--warn)':'#dc2626';
  let catF=null,sevF=null,view='issues';
  const VIEWS=[['issues',_t('問題清單')],['pages',_t('頁面一覽')],['crawl',_t('爬蟲與 robots')],['sitemap','Sitemap'],['perf',_t('效能')],['sec',_t('安全')]];
  function draw(){
    const cats=Object.entries(H.categories);
    let list=H.issues.filter(i=>(!catF||i.category===catF)&&(!sevF||i.severity===sevF));
    h.innerHTML='<div class="card"><div class="score"><div><div class="ring" style="--p:'+H.score+';--c:'+col(H.score)+'"><b>'+H.score+_t('</b></div><small class="hint" style="display:block;text-align:center;margin-top:4px">等級 ')+H.grade+'</small></div>'+
      '<div style="flex:1;min-width:260px">'+cats.map(([k,c])=>'<div class="cat'+(catF&&catF!==k?' off':'')+'" data-cat="'+k+'"><span>'+esc(c.label)+'</span><i><b style="width:'+c.score+'%;background:'+col(c.score)+'"></b></i><span>'+c.score+'</span></div>').join('')+_t('<div class="hint">點類別可篩選問題</div></div>')+
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
    el.innerHTML=(!catF&&!sevF&&top.length?_t('<div class="card"><h3>最該先處理的 ')+top.length+_t(' 件事</h3>')+top.map((i,n)=>'<p class="say"><b>'+(n+1)+'. '+esc(i.title)+'</b> <span class="sev '+i.severity+'">'+SEVN[i.severity]+'</span><br><span class="hint">'+esc(i.fix)+'</span></p>').join('')+'</div>':'')+
      '<div style="margin-top:12px">'+(list.length?list.map(i=>'<details class="is"><summary><span class="sev '+i.severity+'">'+SEVN[i.severity]+'</span><b>'+esc(i.title)+'</b><span class="hint">'+esc(catName(i.category))+' · '+(i.scope==='site'?_t('全站'):i.affected+' / '+i.total+_t(' 頁'))+'</span></summary><div class="bd">'+
        (i.impact?_t('<p><b>為什麼重要：</b>')+esc(i.impact)+'</p>':'')+(i.fix?_t('<div class="fix"><b>怎麼修：</b>')+esc(i.fix)+'</div>':'')+(i.detail?'<p class="hint">'+esc(i.detail)+'</p>':'')+
        (i.examples.length?_t('<b>範例</b><ul>')+i.examples.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'')+'<span class="hint mono">'+esc(i.id)+'</span></div></details>').join(''):_t('<div class="empty">沒有符合條件的問題 🎉</div>'))+'</div>'+
      _t('<details class="is" style="margin-top:14px"><summary><b>已通過的檢查（')+H.passed.length+_t('）</b></summary><div class="bd"><ul>')+H.passed.map(p=>'<li>✅ '+esc(catName(p.category))+_t('：')+esc(p.title)+'</li>').join('')+'</ul></div></details>';
  }
  function vPages(el){
    el.innerHTML=_t('<div class="card" style="overflow:auto"><table class="t"><tr><th>網址</th><th>狀態</th><th>可索引</th><th>標題</th><th>描述</th><th>H1</th><th>字數 渲染／原始</th><th>LCP</th><th>連入</th></tr>')+H.pages.map(p=>{
      const tl=p.titleLen,dl=p.descLen;return '<tr><td class="mono">'+esc(p.url.replace(/^https?:\/\/[^/]+/,'')||'/')+'</td><td>'+p.status+'</td><td>'+(p.indexable?'✅':_t('<span class="chip warn">noindex／錯誤</span>'))+'</td>'+
        '<td><span class="'+(tl===0?'poor':tl<20||tl>60?'warn2':'good')+'">'+tl+'</span></td><td><span class="'+(dl===0?'poor':dl<70||dl>160?'warn2':'good')+'">'+dl+'</span></td><td class="'+(p.h1===1?'good':'warn2')+'">'+p.h1+'</td>'+
        '<td>'+p.words+_t('／<span class="')+(p.rawWords!=null&&p.rawWords<p.words*.35?'poor':'')+'">'+(p.rawWords??'—')+'</span></td><td class="'+(p.lcpMs==null?'':p.lcpMs<=2500?'good':p.lcpMs<=4000?'warn2':'poor')+'">'+(p.lcpMs??'—')+'</td><td>'+p.inlinks+'</td></tr>'}).join('')+_t('</table><p class="hint">標題／描述為「字元寬度」（中日韓字元算 2）。建議標題 20–60、描述 70–160、h1 恰好 1。</p></div>');
  }
  function vCrawl(el){
    const f=H.facts.robots,row=(b)=>'<tr><td class="mono">'+esc(b.bot)+'</td><td>'+esc(b.who)+'</td><td>'+(b.allowed?_t('<span class="chip ok">允許</span>'):_t('<span class="chip warn">禁止</span> <span class="hint mono">')+esc(b.rule||'')+'</span>')+'</td></tr>';
    el.innerHTML=_t('<div class="grid g2"><div class="card"><h3>搜尋引擎爬蟲</h3><table class="t">')+f.searchBots.map(row).join('')+_t('</table></div><div class="card"><h3>AI 爬蟲</h3><table class="t">')+f.aiBots.map(row).join('')+_t('</table><p class="hint">訓練類（GPTBot、ClaudeBot、Google-Extended…）與搜尋／代使用者類（OAI-SearchBot、ChatGPT-User、Claude-User…）政策可以不同。</p></div></div>')+
      _t('<div class="card" style="margin-top:14px"><h3>robots.txt（HTTP ')+(f.status??'—')+_t('）')+(f.issues.length?' · <span class="chip warn">'+f.issues.length+_t(' 個語法問題</span>'):'')+'</h3>'+(f.issues.length?'<ul>'+f.issues.map(i=>_t('<li>第 ')+i.line+_t(' 行：')+esc(i.msg)+'</li>').join('')+'</ul>':'')+'<pre class="raw">'+esc((D.site&&D.site.robotsTxt&&D.site.robotsTxt.text)||_t('（無內容）'))+'</pre></div>'+
      _t('<div class="card" style="margin-top:14px"><h3>其他爬蟲相關</h3><div class="spec"><small>llms.txt</small><span>')+(H.facts.llmsTxt?_t('有'):_t('無'))+_t('</span></div><div class="spec"><small>不存在網址</small><span>回應 ')+(H.facts.soft404.status??'—')+_t('（應為 404／410）</span></div>')+(H.facts.variants?_t('<div class="spec"><small>網域變體</small><span>')+H.facts.variants.map(v=>esc(v.variant)+' → '+(v.status||v.error)).join('<br>')+'</span></div>':'')+(H.facts.linkCheckLimited?'<p class="hint">'+esc(H.facts.linkCheckLimited)+'</p>':'')+(H.links?_t('<div class="spec"><small>連結檢查</small><span>內部 ')+H.links.internalChecked+_t(' 個、外部 ')+H.links.externalChecked+_t(' 個；壞連結 ')+H.links.broken.length+_t('，外部失效 ')+H.links.externalBroken.length+'</span></div>':_t('<div class="hint">未檢查連結狀態（--no-link-check）</div>'))+'</div>';
  }
  function vSitemap(el){
    const s=H.facts.sitemap;
    el.innerHTML=_t('<div class="card"><h3>Sitemap</h3><div class="spec"><small>位置</small><span>')+(s.found.map(esc).join('<br>')||_t('<span class="chip warn">找不到</span>'))+_t('</span></div><div class="spec"><small>網址數</small><span>')+s.urlCount+_t('（含 lastmod：')+s.withLastmod+_t('）</span></div>')+(s.children.length?_t('<div class="spec"><small>子 sitemap</small><span>')+s.children.map(esc).join('<br>')+'</span></div>':'')+
      (s.sampleChecked?_t('<div class="spec"><small>抽樣檢查</small><span>')+s.sampleChecked+_t(' 筆；異常 ')+s.sampleBad.length+'</span></div>':'')+(s.sampleBad.length?'<ul>'+s.sampleBad.map(x=>'<li class="mono">'+esc(x)+'</li>').join('')+'</ul>':'')+(s.errors.length?'<p class="hint">'+s.errors.map(esc).join('<br>')+'</p>':'')+'</div>';
  }
  function vPerf(el){
    const p=H.facts.performance,fmt=(v,u)=>v==null?'—':v+u;
    const m=(label,v,u,good,poor)=>'<div class="metric"><span class="hint">'+label+'</span><b class="'+(v==null?'':v<=good?'good':v<=poor?'warn2':'poor')+'">'+fmt(v,u)+'</b></div>';
    el.innerHTML=_t('<div class="card"><h3>中位數（各頁）</h3>')+m('TTFB',p.ttfbMs,' ms',800,1800)+m('LCP',p.lcpMs,' ms',2500,4000)+m('CLS',p.cls,'',.1,.25)+m(_t('總下載量'),p.totalBytes!=null?+(p.totalBytes/1048576).toFixed(2):null,' MB',3,6)+m(_t('請求數'),p.requests,'',100,200)+m(_t('DOM 節點'),p.domNodes,'',1500,3000)+'<p class="hint">'+esc(p.note)+'</p></div>'+
      _t('<div class="card" style="margin-top:14px;overflow:auto"><table class="t"><tr><th>網址</th><th>TTFB</th><th>LCP</th><th>CLS</th><th>下載量</th></tr>')+H.pages.map(x=>'<tr><td class="mono">'+esc(x.url.replace(/^https?:\/\/[^/]+/,'')||'/')+'</td><td>'+fmt(x.ttfbMs,' ms')+'</td><td>'+fmt(x.lcpMs,' ms')+'</td><td>'+fmt(x.cls,'')+'</td><td>'+(x.bytes!=null?(x.bytes/1024).toFixed(0)+' KB':'—')+'</td></tr>').join('')+'</table></div>';
  }
  function vSec(el){
    const s=H.facts.security,c=s.certificate;
    const lab={'strict-transport-security':'HSTS','content-security-policy':'CSP','x-content-type-options':'nosniff','x-frame-options':'X-Frame-Options','referrer-policy':'Referrer-Policy','permissions-policy':'Permissions-Policy'};
    el.innerHTML=_t('<div class="card"><h3>傳輸與標頭</h3><div class="spec"><small>HTTPS</small><span>')+(s.https?_t('<span class="chip ok">是</span>'):_t('<span class="chip warn">否</span>'))+'</span></div>'+(c&&c.ok?_t('<div class="spec"><small>憑證</small><span>')+esc(c.issuer||'')+_t('，到期 ')+esc((c.validTo||'').slice(0,10))+_t('（剩 ')+c.daysLeft+_t(' 天），')+esc(c.protocol||'')+'</span></div>':'')+
      Object.entries(lab).map(([k,v])=>'<div class="spec"><small>'+v+'</small><span>'+(s.headers[k]?_t('<span class="chip ok">已設定</span> <span class="hint mono">')+esc(String(s.headers[k]).slice(0,90))+'</span>':_t('<span class="chip warn">未設定</span>'))+'</span></div>').join('')+
      (s.headers.server||s.headers['x-powered-by']?_t('<div class="spec"><small>洩漏資訊</small><span class="mono">')+esc([s.headers.server,s.headers['x-powered-by']].filter(Boolean).join(_t('、')))+'</span></div>':'')+'</div>';
  }
  draw();
})();

// ---------- history ----------
(function(){
  const H=D.history;if(!H||!H.runs.length)return;const h=$('#s-history');
  h.innerHTML='<div class="card"><h3>'+esc(H.host)+_t(' 的探索紀錄</h3><table><tr><th>#</th><th>時間</th><th>頁數</th><th>主色</th><th>標題字型</th><th>3D／動畫</th></tr>')+H.runs.slice().reverse().map(r=>'<tr><td>'+r.id+'</td><td>'+esc(new Date(r.date).toLocaleString())+'</td><td>'+(r.pages??'—')+'</td><td>'+(r.brand?'<span class="chip" style="background:'+r.brand+';color:#fff">'+r.brand+'</span>':'—')+'</td><td>'+esc(r.font||'—')+'</td><td>'+r.targets+'</td></tr>').join('')+'</table></div>'+
  _t('<div class="card" style="margin-top:14px"><h3>與上一次相比</h3>')+(H.runs.length<2?_t('<p class="hint">這是第一次紀錄；之後再探索同一個網站，就能看到改版差異。</p>'):(H.changes.length?_t('<table><tr><th>項目</th><th>之前</th><th>現在</th></tr>')+H.changes.map(c=>'<tr><td>'+esc(c.label)+'</td><td>'+esc(c.from)+'</td><td>'+esc(c.to)+'</td></tr>').join('')+'</table>':_t('<p>沒有明顯變化。</p>')))+'</div>';
})();
// ---------- capture status: say it loudly when a page came out (almost) empty ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;const bad=(S.pages||[]).filter(p=>p.emptyPage);if(!bad.length)return;
  const why=d=>!d?_t('原因不明；可試 <code>--wait 30000</code> 或 <code>--headed</code>。'):(d.alt&&d.alt.contentAppeared)?_t('<b>用瀏覽器預設身分就讀得到內容（')+d.alt.textChars+_t(' 字），用爬蟲身分讀不到</b>：網站依「識別字串」提供了不同的內容。'):(d.scripts>0&&d.dataRequests===0&&d.canvases===0&&d.textChars===0)?_t('<b>腳本有載入，卻沒有發出任何資料請求，也沒有建立任何畫面</b>：程式像是在等某個條件而停住（偵測瀏覽器或 WebGL、使用者互動、特定網址參數），或執行時出錯。請執行 <code>site-explorer diagnose &lt;網址&gt;</code>，比較「爬蟲身分」與「瀏覽器預設身分」。'):d.blockPage?_t('<b>像是防機器人／驗證頁</b>：網站把自動化瀏覽器擋在外面。可試 <code>--headed</code>（顯示瀏覽器視窗）。'):(d.canvases>0&&d.textChars<40)?_t('<b>像是 WebGL／canvas 整頁體驗</b>：畫面由 3D 繪製，網頁上幾乎沒有文字或版面元素可抽取。請看「3D／動畫」分頁與截圖。'):(d.iframes>0&&d.elements<40)?_t('內容可能在 iframe 裡，目前不會深入 iframe。'):(d.buttons>0&&d.textChars<40)?_t('可能要先點「進入」或同意 Cookie 才會顯示內容。可試 <code>--headed</code> 親手點一下。'):_t('原因不明；可試 <code>--wait 30000</code> 或 <code>--headed</code>。');
  const shot=p=>{const pg=(D.pages||[]).find(x=>x.slug===p.slug);const src=pg&&pg.shots&&pg.shots.desktop;return src?'<img src="'+esc(src)+_t('" style="max-width:260px;border:1px solid var(--line);border-radius:8px;margin-top:8px" alt="擷取當下的畫面">'):''};
  o.insertAdjacentHTML('afterbegin',_t('<div class="card" style="border-color:#dc2626;margin-bottom:14px"><h3 style="color:#dc2626">⚠️ 這次擷取不完整（')+bad.length+_t(' 頁幾乎是空的）</h3>')+bad.map(p=>'<div style="margin:8px 0"><b>'+esc(p.title||p.url)+'</b><br><small>'+esc(p.url)+'</small><br>'+(p.emptyDiag?_t('<small>DOM 元素 ')+p.emptyDiag.elements+'・canvas '+p.emptyDiag.canvases+'・iframe '+p.emptyDiag.iframes+_t('・可見文字 ')+p.emptyDiag.textChars+_t(' 字')+(p.emptyDiag.requests!=null?_t('・請求 ')+p.emptyDiag.requests+_t('（腳本 ')+p.emptyDiag.scripts+_t('、資料請求 ')+p.emptyDiag.dataRequests+_t('）'):'')+_t('・WebGL：')+esc(p.emptyDiag.webgl||_t('無'))+'</small><br>'+((p.emptyDiag.consoleErrors||[]).length?_t('<small>頁面錯誤：')+p.emptyDiag.consoleErrors.map(esc).join(_t('；'))+'</small><br>':''):'')+why(p.emptyDiag)+'<br>'+shot(p)+'</div>').join('')+'</div>');
})();
// ---------- what the page actually loaded (network, shadow DOM / iframes, accessibility tree) ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;const p=(S.pages||[]).find(x=>x.network);if(!p)return;const n=p.network,d=p.deep,a=p.aria;
  const li=x=>'<li>'+x+'</li>';
  const rows=[
    li(_t('請求 <b>')+n.total+_t('</b> 個（')+Object.entries(n.byType).sort((x,y)=>y[1]-x[1]).slice(0,6).map(([k,v])=>esc(k)+' '+v).join(_t('、'))+_t('）；第三方網域 ')+(n.thirdParty||[]).length+_t(' 個')+(n.errorCount?_t('；<b style="color:#dc2626">錯誤回應 ')+n.errorCount+_t(' 個（403/429：')+n.blockedLike+_t('）</b>'):'')),
    n.assets3d&&n.assets3d.length?li(_t('3D 資源：')+n.assets3d.map(x=>'<code>'+esc(x.url)+'</code> ('+x.status+')').join(_t('、'))):'',
    n.apis&&n.apis.length?li(_t('API／JSON：')+n.apis.slice(0,6).map(x=>'<code>'+esc(x.url)+'</code> ('+x.status+')').join(_t('、'))):'',
    n.apiTextSamples&&n.apiTextSamples.length?li(_t('API 回應裡的文字（頁面上看不到時，內容常在這裡）：<ul>')+n.apiTextSamples.slice(0,6).map(t=>li(esc(t))).join('')+'</ul>'):'',
    d?li(_t('含 shadow DOM 與 iframe 的可見文字 <b>')+d.textChars+_t('</b> 字（iframe ')+d.frameCount+_t(' 個、shadow root ')+d.shadowHosts+_t(' 個）')):'',
    a?li(_t('無障礙樹 <b>')+a.lines+_t('</b> 行：標題 ')+a.headings+_t('、連結 ')+a.links+_t('、按鈕 ')+a.buttons+_t('、圖片 ')+a.images+_t('、地標 ')+a.landmarks+_t('（pages/')+esc(p.slug)+_t('/aria.yml）')+(a.head?_t('<details><summary>展開前 40 行</summary><pre style="white-space:pre-wrap;font-size:12px">')+esc(a.head)+'</pre></details>':'')):''
  ].join('');
  o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>頁面實際載入了什麼</h3><div class="hint">')+esc(p.url)+'</div><ul>'+rows+'</ul></div>');
})();
// ---------- who watches the visitors: trackers, cookies, consent banner ----------
(function(){
  const o=$('#s-overview');if(!o||!S||!S.privacy||!S.privacy.pagesChecked)return;const v=S.privacy,CAT={analytics:_t('流量分析'),ads:_t('廣告／再行銷'),'tag-manager':_t('標籤管理'),'session-replay':_t('行為錄影／熱圖'),chat:_t('客服聊天'),social:_t('社群'),video:_t('影音嵌入'),payments:_t('金流'),maps:_t('地圖'),security:_t('防機器人'),fonts:_t('外部字型'),cmp:_t('同意管理工具')};
  const trk=new Set(['analytics','ads','tag-manager','session-replay']);
  const banner=!v.consentChecked?_t('未檢查'):v.consentBanner?_t('<b style="color:#16a34a">有</b>'):_t('<b style="color:#dc2626">沒有偵測到</b>');
  const vend=v.vendors.length?v.vendors.map(x=>'<span class="chip" style="'+(trk.has(x.cat)?'border-color:#dc2626':'')+'">'+esc(x.name)+'<small> · '+esc(CAT[x.cat]||x.cat)+(x.when==='after'?_t(' · 點同意／捲動後才出現'):'')+'</small></span>').join(' '):_t('沒有辨識到已知的第三方追蹤／嵌入服務');
  const ck=v.cookies.length?_t('<table class="t" style="width:100%;font-size:13px"><tr><th>Cookie</th><th>誰設的</th><th>有效期</th><th>Secure</th><th>HttpOnly</th></tr>')+v.cookies.slice(0,30).map(c=>'<tr><td><code>'+esc(c.name)+'</code>'+(c.thirdParty?_t(' <small>第三方</small>'):'')+'</td><td>'+esc(c.owner||'—')+(c.tracking?' ⚠️':'')+'</td><td>'+(c.days==null?_t('工作階段'):c.days+_t(' 天'))+'</td><td>'+(c.secure?_t('是'):_t('否'))+'</td><td>'+(c.httpOnly?_t('是'):_t('否'))+'</td></tr>').join('')+'</table>':_t('頁面載入時沒有設定 Cookie。');
  o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>追蹤碼與 Cookie（誰在看訪客）</h3><div class="hint">第一頁在「還沒點任何同意按鈕」時的狀態；只記名稱與旗標，不記 Cookie 的值。</div><p>Cookie 橫幅：')+banner+_t('　追蹤／廣告類服務：<b>')+v.trackingVendors.length+_t('</b> 個</p><p>')+vend+'</p>'+ck+'</div>');
})();
// ---------- phone / tablet: measured behaviour at 1440 / 768 / 390 ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;const p=(S.pages||[]).find(x=>x.responsive&&x.responsive.desktop);if(!p)return;const r=p.responsive,ks=['desktop','tablet','mobile'].filter(k=>r[k]),N={desktop:_t('桌機'),tablet:_t('平板'),mobile:_t('手機')},NV={links:_t('連結直接顯示'),toggle:_t('收進選單按鈕'),hidden:_t('連結被隱藏、找不到選單按鈕'),none:_t('沒有導覽列')};
  const row=(l,f)=>'<tr><td>'+l+'</td>'+ks.map(k=>'<td>'+f(r[k])+'</td>').join('')+'</tr>';
  const warn=[];const d=r.desktop,t=r.tablet,m=r.mobile;if(t&&t.overflowX)warn.push(_t('平板寬度出現橫向捲動（+')+t.overflowPx+_t('px）'));if(m&&d.navLinks>=3&&m.nav==='hidden')warn.push(_t('手機寬度找不到導覽選單'));if(m&&m.maxColumns>=3)warn.push(_t('手機寬度仍並排 ')+m.maxColumns+_t(' 欄'));if(m&&d.textChars>400&&m.textChars<d.textChars*0.6)warn.push(_t('手機版文字量只有桌機的 ')+Math.round(m.textChars/d.textChars*100)+'%');
  o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>手機／平板實測</h3><div class="hint">')+esc(p.url)+_t('　三種寬度各量一次，不是預設值。</div><table class="t" style="width:100%;font-size:13px"><tr><th></th>')+ks.map(k=>'<th>'+N[k]+' '+r[k].width+'px</th>').join('')+'</tr>'+row(_t('導覽'),x=>esc(NV[x.nav]||x.nav)+_t('（')+x.navLinks+_t(' 個連結）'))+row(_t('並排欄數（最多）'),x=>x.maxColumns>1?x.maxColumns:_t('單欄'))+row(_t('h1／內文字級 px'),x=>(x.h1Px==null?'—':x.h1Px)+_t('／')+(x.bodyPx==null?'—':x.bodyPx))+row(_t('橫向溢出'),x=>x.overflowX?_t('<b style="color:#dc2626">是 +')+x.overflowPx+'px</b>':_t('否'))+row(_t('可見文字量'),x=>x.textChars)+'</table>'+(warn.length?'<ul>'+warn.map(w=>'<li style="color:#dc2626">⚠️ '+esc(w)+'</li>').join('')+'</ul>':_t('<p>沒有發現明顯的響應式問題。</p>'))+'</div>');
})();
// ---------- interaction states: what appeared after clicking / scrolling / pressing keys ----------
(function(){
  const o=$('#s-overview');if(!o||!D.pages)return;const list=D.pages.filter(p=>p.states&&p.states.length>1);if(!list.length)return;
  o.insertAdjacentHTML('beforeend',_t('<div class="card" style="margin-top:14px"><h3>互動狀態（自動點擊／滾動／按鍵後出現的畫面）</h3>')+list.slice(0,4).map(p=>'<div style="margin:8px 0"><b>'+esc(p.title||p.url)+'</b> <small>'+esc(p.url)+'</small><div style="display:flex;gap:10px;overflow-x:auto;padding:6px 0">'+p.states.map(s=>'<figure style="margin:0;flex:none;width:200px"><img src="'+esc(s.src||'')+_t('" style="width:200px;border:1px solid var(--line);border-radius:6px" alt="狀態 ')+s.index+'"><figcaption style="font-size:12px">'+s.index+'. '+esc(s.action)+(s.label?_t('「')+esc(s.label)+_t('」'):'')+_t('<br>文字 ')+s.textChars+_t(' 字</figcaption></figure>')).join('')+'</div></div>').join('')+'</div>');
})();
// ---------- 3D / motion on every captured page ----------
(function(){
  const P=D.motionPages;if(!P||!P.length)return;const m=$('#s-motion');if(!m)return;
  const KN={webgl:'WebGL 3D','css-3d':'CSS 3D','model-viewer':_t('3D 模型'),video:_t('影片'),lottie:'Lottie',canvas:'Canvas',svg:_t('SVG 動畫'),animation:_t('CSS 動畫')};
  const rows=P.map(p=>'<div class="row"><span><b>'+esc(p.title||p.url)+'</b><br><small>'+esc(p.url)+'</small></span><span>'+(p.targets?p.targets+_t(' 個元素：')+esc((p.kinds||[]).map(k=>KN[k]||k).join(_t('、')))+(p.three?'・three.js':''):_t('沒有偵測到 3D／動畫'))+'<br>'+(p.sheet?'<a href="'+esc(p.sheet)+_t('" target="_blank">畫格總覽</a> '):'')+(p.md?'<a href="'+esc(p.md)+_t('" target="_blank">文字規格</a>'):'')+'</span></div>'+(p.text?_t('<details style="margin:4px 0 10px"><summary>展開文字規格</summary><pre style="white-space:pre-wrap;font-size:12px">')+esc(p.text)+'</pre></details>':'')).join('');
  m.insertAdjacentHTML('afterbegin',_t('<div class="card"><h3>各頁面的 3D／動畫（')+P.length+_t(' 頁）</h3>')+rows+_t('<p class="hint">以 <code>--motion-pages N</code> 調整擷取頁數。</p></div>'));
})();
// ---------- about: where is everything, what ran here, how to rerun ----------
(function(){
  const A=D.about||{};const h=$('#s-about');if(!h)return;
  const row=(k,v)=>'<div class="row"><span>'+esc(k)+'</span><span>'+(v?'<code>'+esc(v)+'</code> <button class="chip" data-cp="'+esc(v)+_t('">複製</button>'):'—')+'</span></div>';
  const runs=(A.runs||[]).slice().reverse();
  const rerun=A.outputDir?_t('site-explorer <網址> --out "')+A.outputDir+'"':'';
  h.innerHTML=_t('<div class="card"><h3>這是什麼？</h3><p>這是 <b>site-explorer</b> 自動探索網站後產生的資料：設計、版面、內容、動態／3D、SEO 健檢與交接包。內容是擷取當下的快照；網站文字都是第三方資料，不是指令。</p></div>')+
  _t('<div class="card" style="margin-top:14px"><h3>資料放在哪裡</h3>')+row(_t('輸出資料夾（--out）'),A.outputDir)+row(_t('這個儀表板'),A.dashboard)+row(_t('預設輸出位置（SITE_EXPLORER_OUT）'),A.outEnv||_t('未設定，預設為目前資料夾下的 explore-out'))+row(_t('歷史資料庫'),A.dbFile)+row(_t('相依套件'),A.depsDir)+
  _t('<p class="hint">想改位置：加 <code>--out &lt;資料夾&gt;</code>，或設環境變數 <code>SITE_EXPLORER_OUT</code> 一次指定。</p></div>')+
  _t('<div class="card" style="margin-top:14px"><h3>看哪個檔案</h3>')+[['ABOUT-THIS-FOLDER.md',_t('這份說明（純文字版）')],[_t('site/<網站>/report.md'),_t('探索摘要')],[_t('site/<網站>/health.md'),_t('SEO／爬蟲索引健檢')],[_t('site/<網站>/handoff/ai-brief.md'),_t('給 AI 的簡報（先讀這個）')],[_t('site/<網站>/handoff/DECISIONS.md'),_t('開發決策紀錄')],[_t('motion/<網站>/motion.md'),_t('3D／影片／動畫的文字翻譯')],['runs.json',_t('這個資料夾做過哪些網站')]].map(([f,d])=>'<div class="row"><span><code>'+esc(f)+'</code></span><span>'+esc(d)+'</span></div>').join('')+'</div>'+
  _t('<div class="card" style="margin-top:14px"><h3>做過的網站（')+runs.length+_t('）</h3>')+(runs.length?runs.map(r=>'<div class="row"><span>'+esc(r.url)+'</span><span>'+esc(String(r.at||'').slice(0,10))+' · v'+esc(r.version||'?')+'</span></div>').join(''):_t('<p class="hint">尚無紀錄。</p>'))+'</div>'+
  _t('<div class="card" style="margin-top:14px"><h3>重新產生</h3>')+(rerun?'<code>'+esc(rerun)+'</code> <button class="chip" data-cp="'+esc(rerun)+_t('">複製</button>'):'—')+_t('<p class="hint">工具版本 ')+esc(A.toolVersion||'?')+' · Node '+esc(A.node||'?')+' · '+esc(A.platform||'')+'</p></div>';
  h.addEventListener('click',e=>{const b=e.target.closest('[data-cp]');if(b)copy(b.dataset.cp)});
})();

// ===================================================================== v2: visual overview, detail switch, export-to-AI tab, detail tab
const BRAND=(T&&T.color&&/^#[0-9a-f]{6}$/i.test(T.color.brand||''))?T.color.brand:null;
if(BRAND)document.documentElement.style.setProperty('--site',BRAND);
const kb=(n)=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const stripData=(k,v)=>(typeof v==='string'&&v.startsWith('data:')?_t('(內嵌檔案 ')+kb(v.length*0.75)+')':v);
function download(name,text,type){try{const u=URL.createObjectURL(new Blob([text],{type:type||'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)}catch(e){toast(_t('下載失敗：')+e.message)}}
function copyText(t,msg){const done=()=>toast(msg||_t('已複製'));if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,()=>fallback())}else fallback();function fallback(){const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();try{document.execCommand('copy');done()}catch{toast(_t('無法自動複製，請手動選取'))}ta.remove()}}

// ---------- detail switch ----------
function setDetail(on){document.body.classList.toggle('detail',!!on);const c=$('#dtsw');if(c)c.checked=!!on;try{localStorage.setItem('se-detail',on?'1':'0')}catch{}if(!on&&(location.hash==='#data')&&$('#tabs button[data-k=overview]'))show('overview')}
(function(){
  $('header').insertAdjacentHTML('beforeend',_t('<label class="dtsw" title="顯示每一頁的技術細節、原始資料與 JSON"><input type="checkbox" id="dtsw"> <span>詳細資料</span></label>'));
  $('#dtsw').onchange=(e)=>setDetail(e.target.checked);
  let on=false;try{on=localStorage.getItem('se-detail')==='1'}catch{}if(on)setDetail(true);
})();

// ---------- page viewer (modal) ----------
function openPage(p){
  const old=$('#pgmodal');if(old)old.remove();
  const views=[['desktop',_t('桌機')],['tablet',_t('平板')],['mobile',_t('手機')]].filter(([k])=>p.shots&&p.shots[k]);
  const blocks=(p.blocks||[]).map((b,i)=>'<div class="row"><span>'+(i+1)+'. '+esc(b.kind)+'</span><span>'+Math.round(b.h||0)+'px'+(b.columns>1?' · '+b.columns+_t(' 欄'):'')+'</span></div>').join('');
  const m=el('<div id="pgmodal" class="modal" role="dialog" aria-modal="true"><div class="mbox"><div class="mtop"><div><b>'+esc(p.title||p.url)+'</b><div class="hint">'+esc(p.url)+_t('</div></div><button class="chip" id="mclose">關閉 ✕</button></div><div class="mbody"><div class="mimg"><div class="seg" id="mseg">')+views.map(([k,l],i)=>'<button data-v="'+k+'" aria-pressed="'+(i===0)+'">'+l+'</button>').join('')+_t('</div><div class="mscroll"><img id="mimg" alt="頁面截圖" src="')+esc(views.length?p.shots[views[0][0]]:'')+_t('"></div></div><div class="mside"><h3>區塊（')+(p.blocks||[]).length+_t('）</h3>')+(blocks||_t('<div class="hint">沒有區塊資料</div>'))+_t('<div class="dt"><h3 style="margin-top:14px">詳細資料</h3><div class="row"><span>狀態</span><span>')+esc(p.status)+_t('</span></div><div class="row"><span>頁面高度</span><span>')+esc(p.docHeight)+_t('px</span></div><div class="row"><span>標題數／連結／圖片</span><span>')+(p.headings||[]).length+' / '+p.linkCount+' / '+(p.images||[]).length+_t('</span></div><div class="row"><span>表單</span><span>')+((p.forms||[]).length)+_t('</span></div><div class="row"><span>手機橫向溢出</span><span>')+(p.mobileOverflow?_t('是'):_t('否'))+'</span></div></div></div></div></div></div>');
  document.body.append(m);const close=()=>{m.remove();document.removeEventListener('keydown',esc_)};const esc_=(e)=>{if(e.key==='Escape')close()};document.addEventListener('keydown',esc_);
  m.addEventListener('click',(e)=>{if(e.target===m)close()});$('#mclose',m).onclick=close;
  $('#mseg',m).onclick=(e)=>{const b=e.target.closest('button');if(!b)return;m.querySelectorAll('#mseg button').forEach(x=>x.setAttribute('aria-pressed',x===b));$('#mimg',m).src=p.shots[b.dataset.v];$('#mimg',m).style.maxWidth=b.dataset.v==='mobile'?'390px':b.dataset.v==='tablet'?'768px':'100%'};
}

// ---------- visual hero + page wall + live motion preview (top of overview) ----------
(function(){
  const o=$('#s-overview');if(!o||!S)return;
  const pages=D.pages||[];const home=pages.find(p=>p.shots&&p.shots.desktop)||pages[0];if(!home)return;
  const sh=home.shots||{};const host=(()=>{try{return new URL(S.startUrl).host}catch{return ''}})();
  const dev=(cls,img,bar)=>img?'<div class="dv '+cls+'">'+(bar?'<div class="bar"><i></i><i></i><i></i><span>'+esc(host)+'</span></div>':'')+'<div class="scr"><img alt="" src="'+esc(img)+'"></div></div>':'';
  const plat=(S.editing&&S.editing.platforms||[]).map(p=>p.platform);
  const c=(T&&T.color)||{};const pal=(T&&T.palette||[]).slice(0,6);
  const fonts=T&&T.typography&&T.typography.fontStack?[T.typography.fontStack.heading,T.typography.fontStack.body].filter((x,i,a)=>x&&a.indexOf(x)===i):[];
  const nMotion=(M&&M.targets?M.targets.length:0)||((D.motionPages||[]).reduce((n,x)=>n+(x.targets||0),0));
  const H=D.health;const col=(v)=>v>=80?'var(--ok)':v>=60?'var(--warn)':'#dc2626';
  const hero=el('<div class="hero">'+
    '<div class="devs">'+dev('d',sh.desktop,true)+dev('t',sh.tablet)+dev('m',sh.mobile)+'</div>'+
    _t('<div class="hinfo"><div class="eyebrow">網站探索報告</div><h2>')+esc(host)+'</h2><div class="hint">'+esc(S.startUrl)+'</div>'+
    '<div class="hchips">'+[pages.length+_t(' 頁'),plat.length?esc(plat.join(' / ')):'',nMotion?nMotion+_t(' 個 3D／動畫'):'',(S.privacy&&S.privacy.trackingVendors&&S.privacy.trackingVendors.length)?S.privacy.trackingVendors.length+_t(' 個追蹤服務'):''].filter(Boolean).map(x=>'<span class="chip">'+x+'</span>').join('')+'</div>'+
    '<div class="hk">'+(H?'<div class="hkpi"><div class="ring sm" style="--p:'+H.score+';--c:'+col(H.score)+'"><b>'+H.score+'</b></div><div><b>'+esc(H.grade)+'</b><div class="hint">'+(H.verdict?esc(H.verdict.label):_t('健檢'))+'</div></div></div>':'')+
      (pal.length?'<div class="hkpi" style="flex-direction:column;align-items:flex-start"><div class="swr">'+pal.map(x=>'<button title="'+esc(x.hex)+_t('（點一下複製）" data-cp="')+esc(x.hex)+'" style="background:'+css(x.hex)+'"></button>').join('')+'</div><div class="hint">'+esc(c.brand||pal[0].hex)+_t(' · 點色塊複製</div></div>'):'')+
      (fonts.length?'<div class="hkpi" style="flex-direction:column;align-items:flex-start"><div class="spec2" style="font-family:'+css(fonts[0])+_t(',serif">Aa 字型</div><div class="hint">')+fonts.map(esc).join(' / ')+'</div></div>':'')+'</div>'+
    _t('<div class="dt hint" style="margin-top:8px">詳細資料：爬取 ')+S.seconds+_t(' 秒・')+(S.skippedByRobots||[]).length+_t(' 頁因 robots.txt 略過・身分 ')+esc(S.userAgent||'')+'</div>'+
    '<div class="cta">'+(D.exportKit?_t('<button class="go" data-go="export">匯出給 AI →</button>'):'')+(M||D.motionPages?_t('<button data-go="motion">看 3D／動畫</button>'):'')+(H?_t('<button data-go="health">看健檢</button>'):'')+_t('<button data-go="layout">看排版</button></div></div></div>'));
  hero.addEventListener('click',(e)=>{const g=e.target.closest('[data-go]');if(g)show(g.dataset.go);const cp=e.target.closest('[data-cp]');if(cp)copy(cp.dataset.cp)});
  // page wall
  const mp=D.motionPages||[];const has3d=(p)=>mp.some(x=>x.url===p.url&&x.targets>0)||(M&&M.targets&&M.targets.length&&p===pages[0]);
  const wall=el(_t('<div class="card" style="margin-top:14px"><h3>每一頁長什麼樣（點開看全頁）</h3><div class="wall">')+pages.map((p,i)=>'<button class="wc" data-i="'+i+'"><div class="th">'+(p.shots&&p.shots.desktop?'<img alt="" loading="lazy" src="'+esc(p.shots.desktop)+'">':_t('<div class="noimg">沒有截圖</div>'))+'</div><div class="wt"><b>'+esc(p.title||_t('(無標題)'))+'</b><span class="hint">'+esc((()=>{try{return new URL(p.url).pathname}catch{return p.url}})())+'</span><span>'+(p.status&&p.status>=400?'<span class="chip warn">'+p.status+'</span>':'')+(p.emptyPage?_t('<span class="chip warn">內容空白</span>'):'')+(has3d(p)?_t('<span class="chip">3D／動畫</span>'):'')+'<span class="chip ok">'+(p.blocks||[]).length+_t(' 區塊</span></span><span class="dt hint">')+(p.headings||[]).length+_t(' 標題・')+p.linkCount+_t(' 連結・')+(p.images||[]).length+_t(' 圖・高 ')+p.docHeight+'px'+(p.mobileOverflow?_t('・手機溢出'):'')+'</span></div></button>').join('')+'</div></div>');
  wall.addEventListener('click',(e)=>{const b=e.target.closest('.wc');if(b)openPage(pages[+b.dataset.i])});
  // live motion preview: the captured frames play on a loop (paused when off-screen, still when the visitor prefers reduced motion)
  let live=null;
  const targets=(M&&M.targets||[]).filter(t=>t.frames&&t.frames.idle&&t.frames.idle.length>1).slice(0,6);
  if(targets.length){
    const KN={webgl:'WebGL 3D','css-3d':'CSS 3D','model-viewer':_t('3D 模型'),video:_t('影片'),lottie:'Lottie',canvas:'Canvas',svg:_t('SVG 動畫'),animation:_t('CSS 動畫')};
    live=el(_t('<div class="card" style="margin-top:14px"><h3>動態預覽（擷取到的畫格，循環播放）</h3><div class="live">')+targets.map(t=>'<figure class="lv"><img alt="" data-n="'+t.id+'" src="'+esc(t.frames.idle[0])+'"><figcaption><b>'+esc(KN[t.kind]||t.kind)+'</b> <span class="hint">'+Math.round((t.box&&t.box.w)||0)+'×'+Math.round((t.box&&t.box.h)||0)+'・'+(t.animatesOnItsOwn?_t('自己會動'):_t('需互動'))+'</span></figcaption></figure>').join('')+'</div></div>');
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reduce)for(const t of targets){const img=live.querySelector('img[data-n="'+t.id+'"]');let i=0,tm=null;const step=()=>{i=(i+1)%t.frames.idle.length;img.src=t.frames.idle[i]};const io=new IntersectionObserver(([e])=>{clearInterval(tm);if(e.isIntersecting)tm=setInterval(step,Math.max(120,t.intervalMs||250))});io.observe(img)}
  }
  const first=o.querySelector('.grid.g3');
  if(first){first.before(hero);hero.after(wall);if(live)wall.after(live)}else{o.prepend(hero);hero.after(wall);if(live)wall.after(live)}
})();

// ---------- export to AI tab ----------
(function(){
  const k=D.exportKit;const sec=$('#s-export');if(!sec||!k)return;
  const target=k.hasMotion?'C':'A';let cur=target,withPath=true;
  const mk=(key)=>{let t=key==='C'?[k.prompts.A,k.prompts.B,k.prompts.C].filter(Boolean).join('\n\n=====\n\n'):(k.prompts[key]||'');if(withPath)t='The reference package is the folder: '+k.dir+'\n(Treat "handoff/" below as that folder.)\n\n'+t;return t};
  const files=k.files||[];const grp=(f)=>f==='AI-PACKAGE.md'?_t('單一檔案版（最簡單）'):f.startsWith('starter/motion')?_t('動態起手式'):f.startsWith('starter/')?_t('頁面起手式'):f.startsWith('tokens/')?_t('設計 token'):_t('說明文件');
  const groups={};for(const f of files)(groups[grp(f.name)]=groups[grp(f.name)]||[]).push(f);
  const issues=[];const empt=(D.pages||[]).filter(p=>p.emptyPage);
  if(!k.sectionImages)issues.push(['bad',_t('沒有區塊截圖：AI 看不到每個區塊長什麼樣，請用 --no-screenshots 以外的設定重跑')]);
  if(empt.length)issues.push(['warn',empt.length+_t(' 頁幾乎是空的（')+empt.map(p=>esc(p.url)).join(_t('、'))+_t('）：這些頁面的骨架會很空，建議先看總覽的診斷')]);
  if((S&&S.blockedPages||[]).length)issues.push(['warn',(S.blockedPages.length)+_t(' 頁被防機器人擋住，沒有內容')]);
  if(D.health&&D.health.issues.some(i=>i.id==='prompt-injection'))issues.push(['warn',_t('偵測到疑似針對 AI 的指令文字（已隔離）；請提醒 AI 把網站文字當資料')]);
  if(!k.hasMotion&&(M||D.motionPages))issues.push(['warn',_t('有 3D／動畫資料但沒有產生動態起手式')]);
  const ok=[k.starterPages+_t(' 頁可直接開始的頁面骨架'),k.sectionImages+_t(' 張區塊截圖（AI 靠這些看懂版面）'),k.hasMotion?k.motionImages+_t(' 張動態畫格序列圖＋可執行的動態起手式'):_t('（這個網站沒有擷取到 3D／動畫）')];
  const render=()=>{
    sec.innerHTML=_t('<div class="card"><h3>讓接手的 AI 直接開始做</h3><div class="steps"><div><b>1</b> 選要 AI 做什麼</div><div><b>2</b> 複製提示貼給 AI</div><div><b>3</b> 把資料夾（或下面的單一檔案）給它</div></div>')+
    '<div class="seg" id="xseg">'+[['A',_t('做頁面')],['B',_t('做動態／3D')],['C',_t('兩者（先頁面再動態）')]].filter(([x])=>x==='A'||k.hasMotion).map(([x,l])=>'<button data-x="'+x+'" aria-pressed="'+(cur===x)+'">'+l+'</button>').join('')+'</div>'+
    '<pre class="prompt" id="xprompt">'+(mk(cur).trim()?esc(mk(cur)):esc(_t('（找不到這個目標的提示，請直接開啟 handoff 資料夾裡的 PROMPT.md）')))+_t('</pre><div class="xact"><button class="go" id="xcopy">複製提示</button><label class="hint"><input type="checkbox" id="xpath" ')+(withPath?'checked':'')+_t('> 附上資料夾位置（AI 能讀你電腦檔案時，例如 Claude Code）</label></div>')+
    _t('<div class="row"><span>資料夾</span><span><code>')+esc(k.dir)+'</code> <button class="chip" data-cp="'+esc(k.dir)+_t('">複製路徑</button></span></div>')+
    (k.hasMotion?_t('<div class="row"><span>預覽動態起手式</span><span><code>npx serve "')+esc(k.dir)+'"</code> <button class="chip" data-cp="npx serve &quot;'+esc(k.dir)+_t('&quot;">複製</button> <span class="hint">→ 開 /starter/motion/</span></span></div>'):'')+'</div>'+
    _t('<div class="card" style="margin-top:14px"><h3>交給 AI 之前</h3>')+ok.map(x=>'<p class="say">✅ '+x+'</p>').join('')+issues.map(([t,x])=>'<p class="say">'+(t==='bad'?'❌':'⚠️')+' '+x+'</p>').join('')+'</div>'+
    (D.verify?_t('<div class="card" style="margin-top:14px"><h3>重建驗證：starter 和原站像不像　<span class="hint">')+D.verify.overall+_t('／100（')+esc(D.verify.grade)+_t('）</span></h3><p class="hint">衡量版面（高度、明暗、顏色），不比文字；每列的圖是 原站｜重建｜差異熱圖。</p>')+D.verify.pages.map(p=>'<div class="hint" style="margin:10px 0 4px">'+esc(p.page)+' — '+p.score+'</div>'+p.sections.map(x=>x.status==='ok'?'<div class="row"><span>'+esc(x.name)+' <span class="hint">'+x.score+_t('（')+esc(x.grade)+_t('）· 高度 ')+x.refHeight+'→'+x.gotHeight+'px</span></span><span>'+(x.diff?'<img src="'+esc(x.diff)+'" alt="'+esc(x.name)+_t(' 差異圖" loading="lazy" style="max-width:100%;width:560px;border-radius:6px">'):'')+'</span></div>':'<div class="row"><span>'+esc(x.name)+'</span><span class="hint">'+esc(x.status)+'</span></div>').join('')).join('')+'</div>':'')+
    _t('<div class="card" style="margin-top:14px"><h3>檔案（可直接複製或下載）</h3>')+Object.entries(groups).map(([g,fs_])=>'<div class="hint" style="margin:10px 0 4px">'+g+'</div>'+fs_.map(f=>'<div class="row"><span><code>'+esc(f.name)+'</code> <span class="hint">'+kb(f.text.length)+'</span></span><span><button class="chip" data-fc="'+esc(f.name)+_t('">複製</button> <button class="chip" data-fd="')+esc(f.name)+_t('">下載</button></span></div>')).join('')).join('')+_t('<p class="hint">AI 讀不了資料夾時：複製或下載 <code>AI-PACKAGE.md</code> 貼給它，再附上 <code>media/</code> 內的區塊截圖與影格序列圖（AI 要看圖才看得懂版面與動態）。</p></div>');
  };
  render();
  sec.addEventListener('click',(e)=>{
    const sg=e.target.closest('#xseg button');if(sg){cur=sg.dataset.x;render();return}
    if(e.target.id==='xcopy'){copyText(mk(cur),_t('已複製提示，貼給 AI 即可'));return}
    const cp=e.target.closest('[data-cp]');if(cp){copy(cp.dataset.cp);return}
    const fc=e.target.closest('[data-fc]');if(fc){const f=files.find(x=>x.name===fc.dataset.fc);if(f)copyText(f.text,_t('已複製 ')+f.name);return}
    const fd=e.target.closest('[data-fd]');if(fd){const f=files.find(x=>x.name===fd.dataset.fd);if(f)download(f.name.split('/').pop(),f.text)}
  });
  sec.addEventListener('change',(e)=>{if(e.target.id==='xpath'){withPath=e.target.checked;render()}});
})();

// ---------- detail tab: per-page technical data + raw JSON explorers ----------
(function(){
  const sec=$('#s-data');if(!sec)return;
  const reg=[];const jval=(v)=>v===null?'<span class="jn">null</span>':typeof v==='string'?'<span class="js" title="'+esc(v.slice(0,500))+'">"'+esc(v.length>160?v.slice(0,160)+'…':v)+'"</span>':'<span class="jn">'+esc(String(v))+'</span>';
  const clean=(v)=>JSON.parse(JSON.stringify(v,stripData));
  function node(v,key,depth){
    if(v===null||typeof v!=='object')return '<div class="jl"><span class="jk">'+esc(key)+'</span> '+jval(v)+'</div>';
    const n=Array.isArray(v)?v.length:Object.keys(v).length;if(!n)return '<div class="jl"><span class="jk">'+esc(key)+'</span> <span class="jn">'+(Array.isArray(v)?'[]':'{}')+'</span></div>';
    reg.push(v);return '<details class="jd" data-r="'+(reg.length-1)+'"'+(depth<1?' open':'')+'><summary><span class="jk">'+esc(key)+'</span> <span class="hint">'+(Array.isArray(v)?'['+n+']':'{'+n+'}')+'</span></summary><div class="jb">'+(depth<1?kids(v,depth+1):'')+'</div></details>';
  }
  function kids(v,d){const ents=Array.isArray(v)?v.map((x,i)=>[i,x]):Object.entries(v);const lim=ents.slice(0,80);return lim.map(([k,x])=>node(x,k,d)).join('')+(ents.length>80?_t('<div class="hint">… 還有 ')+(ents.length-80)+_t(' 項（請用下載 JSON 看全部）</div>'):'')}
  sec.addEventListener('toggle',(e)=>{const d=e.target;if(d.tagName==='DETAILS'&&d.open&&d.dataset.r&&!d.dataset.done){d.dataset.done='1';d.querySelector('.jb').innerHTML=kids(reg[+d.dataset.r],2)}},true);
  const rawCards=[[_t('site.json（探索結果）'),S&&Object.assign({},S,{pages:undefined}),'site.json'],[_t('tokens（設計 token）'),T,'tokens.json'],[_t('motion（3D／動畫）'),M&&Object.assign({},M,{targets:(M.targets||[]).map(t=>Object.assign({},t,{frames:undefined}))}),'motion.json'],[_t('health（健檢）'),D.health,'health.json'],[_t('history（歷史）'),D.history,'history.json'],[_t('export kit（匯出檔案清單）'),D.exportKit&&{dir:D.exportKit.dir,prompts:Object.keys(D.exportKit.prompts),files:D.exportKit.files.map(f=>f.name),counts:{starterPages:D.exportKit.starterPages,images:D.exportKit.images}},'export-kit.json']].filter(x=>x[1]);
  const rows=(D.pages||[]).map(p=>{const sp=(S&&S.pages||[]).find(x=>x.slug===p.slug)||{};const hp=(D.health&&D.health.pages||[]).find(x=>x.url===p.url)||{};const r=sp.responsive||{};const cols=['desktop','tablet','mobile'].map(v=>r[v]?(r[v].maxColumns>1?r[v].maxColumns:1):'—').join('/');
    return '<tr><td>'+esc((()=>{try{return new URL(p.url).pathname}catch{return p.url}})())+'</td><td>'+esc(p.status)+'</td><td>'+p.docHeight+'</td><td>'+(p.headings||[]).length+'</td><td>'+p.linkCount+'</td><td>'+(p.images||[]).length+'</td><td>'+(p.blocks||[]).length+'</td><td>'+(hp.words??'—')+'</td><td>'+(hp.lcpMs??'—')+'</td><td>'+(hp.ttfbMs??'—')+'</td><td>'+(hp.bytes?kb(hp.bytes):'—')+'</td><td>'+cols+'</td><td>'+(sp.network?sp.network.total:'—')+'</td><td>'+(p.mobileOverflow?'⚠️':'')+'</td></tr>'}).join('');
  sec.innerHTML=_t('<div class="card"><h3>逐頁技術資料</h3><div style="overflow:auto"><table class="t"><tr><th>路徑</th><th>狀態</th><th>高 px</th><th>標題</th><th>連結</th><th>圖片</th><th>區塊</th><th>字數</th><th>LCP ms</th><th>TTFB ms</th><th>下載量</th><th>欄數 桌/平/手</th><th>請求數</th><th>手機溢出</th></tr>')+rows+_t('</table></div><p class="hint">空白 ＝ 這次沒有量到。完整單位與意義見 SPEC.md。</p></div>')+
   _t('<div class="card" style="margin-top:14px"><h3>原始資料（展開看每一層；大型清單只顯示前 80 項）</h3>')+rawCards.map(([title,obj,fn],i)=>'<div class="jroot"><div class="jhead"><b>'+esc(title)+'</b> <button class="chip" data-dl="'+i+_t('">下載 JSON</button> <button class="chip" data-cj="')+i+_t('">複製 JSON</button></div>')+node(clean(obj),_t('(根)'),0)+'</div>').join('')+'</div>';
  sec.addEventListener('click',(e)=>{const d=e.target.closest('[data-dl]'),c=e.target.closest('[data-cj]');const i=d?+d.dataset.dl:c?+c.dataset.cj:-1;if(i<0)return;const txt=JSON.stringify(clean(rawCards[i][1]),null,2);if(d)download(rawCards[i][2],txt,'application/json');else copyText(txt,_t('已複製 JSON'))});
})();

show(location.hash.slice(1)&&tabs.some(t=>t[0]===location.hash.slice(1))?location.hash.slice(1):'overview');

