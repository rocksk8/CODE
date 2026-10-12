// Dashboard pages for the newer checks (security, speed, privacy, technology, screen comparison, custom extraction) and the overview's
// "results at a glance" board. Runs after report-client.js and uses its helpers ($, el, esc, _t, show, D, tabs).
(function () {
  const CK = D.checks || {}, IC = { ok: '✅', warn: '🟡', bad: '🔴', info: 'ℹ️' };
  const V = (id) => (D.verdicts || []).find((v) => v.id === id);
  const has = (k) => tabs.some((t) => t[0] === k);
  // plain-language explanations of the jargon that appears on these pages (shown on hover / long-press)
  const GL = {
    LCP: _t('最大內容繪製：頁面上最大的圖或文字出現所花的時間。Google 建議 2.5 秒內。'),
    CLS: _t('版面位移：載入時畫面跳動的程度。Google 建議 0.1 以下，數字越小越穩。'),
    TTFB: _t('伺服器回應時間：按下連結到收到第一個位元組。Google 建議 0.8 秒內。'),
    FCP: _t('首次內容繪製：畫面第一次出現東西的時間。Google 建議 1.8 秒內。'),
    CSP: _t('內容安全政策：告訴瀏覽器只能載入哪些來源的腳本，能擋掉大部分被植入的惡意腳本。'),
    HSTS: _t('強制 HTTPS：告訴瀏覽器以後只能用加密連線造訪這個網站。'),
    TLS: _t('加密連線協定。1.0 和 1.1 已經過時，建議只開 1.2 和 1.3。'),
    SRI: _t('子資源完整性：確保外部腳本沒有被偷偷換掉。'),
  };
  const gl = (t) => '<span class="gl" title="' + esc(GL[t] || '') + '">' + esc(t) + '</span>';
  const banner = (v) => (v ? '<div class="vban ' + v.status + '"><div class="ic">' + IC[v.status] + '</div><div><h2>' + esc(v.headline) + '</h2><p>' + esc(v.next || '') + '</p></div></div>' : '');
  const sec = (k) => $('#s-' + k);

  // ---------- overview: how to read + results at a glance ----------
  (function () {
    const o = $('#s-overview'); if (!o) return;
    let hide = false; try { hide = localStorage.getItem('se-how') === '1'; } catch {}
    const list = (D.verdicts || []).filter((v) => has(v.tab));
    let html = '';
    if (!hide) html += '<div class="how" id="how"><span>' + _t('怎麼讀這份報告：上面的分頁分成四區——<b>看網站</b>（設計、排版、內容）、<b>檢查</b>（健檢、安全、速度、隱私、技術）、<b>比較</b>（畫面比對、歷史、自訂擷取）、<b>交付</b>（匯出給 AI）。') + '</span><span>' + _t('卡片顏色：<b>綠</b>＝沒事、<b>黃</b>＝值得看、<b>紅</b>＝要處理、<b>藍</b>＝只是資訊。點卡片看詳細。') + '</span><button id="howx" title="' + esc(_t('不再顯示')) + '">✕</button></div>';
    if (list.length) html += '<div class="board">' + list.map((v) => '<button class="vc ' + v.status + '" data-tab="' + esc(v.tab) + '"><span class="t">' + IC[v.status] + ' ' + esc(v.title) + '</span><span class="h">' + esc(v.headline) + '</span>' + (v.next ? '<span class="n">' + esc(v.next) + '</span>' : '') + '<span class="go">' + _t('看詳細 →') + '</span></button>').join('') + '</div>';
    o.insertAdjacentHTML('afterbegin', html);
    o.querySelectorAll('.vc').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
    const x = $('#howx'); if (x) x.onclick = () => { try { localStorage.setItem('se-how', '1'); } catch {} $('#how').remove(); };
  })();

  // ---------- security ----------
  (function () {
    const d = CK.security, s = sec('security'); if (!d || !s) return;
    const g = (x) => (x ?? '—');
    let h = banner(V('security')) + '<div class="mt"><div class="m"><small>' + _t('安全標頭') + '</small><b>' + esc(g(d.headers?.grade)) + '</b><i>' + esc(g(d.headers?.score)) + _t(' 分') + '</i></div><div class="m"><small>' + _t('加密連線') + '</small><b>' + esc(d.tls ? g(d.tls.grade) : '—') + '</b><i>' + (d.tls ? '' : esc(_t('未檢查'))) + '</i></div></div>';
    h += '<div class="card"><h3>' + _t('安全標頭：每一項在檢查什麼') + '</h3><table class="t"><tr><th>' + _t('檢查項目') + '</th><th>' + _t('分數') + '</th><th>' + _t('結果') + '</th><th>' + _t('怎麼修') + '</th></tr>' +
      (d.headers?.tests || []).map((t) => '<tr><td>' + (/Content-Security/.test(t.name) ? gl('CSP') + ' ' : /Strict-Transport/.test(t.name) ? gl('HSTS') + ' ' : /Integrity/.test(t.name) ? gl('SRI') + ' ' : '') + esc(t.name) + '</td><td class="' + (t.points < 0 ? 'warn2' : 'good') + '">' + (t.points > 0 ? '+' : '') + t.points + '</td><td>' + esc(t.result) + '</td><td>' + esc(t.fix || '—') + '</td></tr>').join('') + '</table></div>';
    if (d.tls) {
      h += '<div class="card" style="margin-top:14px"><h3>' + gl('TLS') + ' ' + _t('加密連線') + '</h3>' + (d.tls.versions && Object.keys(d.tls.versions).length ? '<p>' + _t('伺服器接受的版本：') + ' ' + Object.entries(d.tls.versions).map(([k, v]) => '<span class="chip ' + (v ? (/1\.[01]$/.test(k) ? 'warn' : 'ok') : '') + '">' + esc(k) + ' ' + (v ? '✔' : '✖') + '</span>').join('') + '</p>' : '') +
        '<table class="t"><tr><th>' + _t('檢查項目') + '</th><th>' + _t('結果') + '</th><th>' + _t('怎麼修') + '</th></tr>' + (d.tls.tests || []).map((t) => '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.result) + '</td><td>' + esc(t.fix || '—') + '</td></tr>').join('') + '</table></div>';
    }
    h += '<p class="hint">' + _t('這是依公開資訊做的設定檢查，不是弱點掃描；評等用來比較不同次的結果，不是認證。') + '</p>';
    s.innerHTML = h;
  })();

  // ---------- speed ----------
  (function () {
    const d = CK.perf, s = sec('perf'); if (!d || !s) return;
    const m = d.medians || {};
    const rate = (k, v) => { const T = { lcpMs: [2500, 4000], cls: [0.1, 0.25], ttfbMs: [800, 1800], fcpMs: [1800, 3000] }[k]; return !T || !Number.isFinite(v) ? '' : v <= T[0] ? 'ok' : v <= T[1] ? 'warn' : 'bad'; };
    const sec_ = (v) => (Number.isFinite(v) ? (v / 1000).toFixed(2) + ' ' + _t('秒') : '—');
    const cards = [
      ['lcpMs', gl('LCP'), sec_(m.lcpMs), _t('主要內容多快出現')], ['fcpMs', gl('FCP'), sec_(m.fcpMs), _t('畫面多快開始有東西')], ['ttfbMs', gl('TTFB'), sec_(m.ttfbMs), _t('伺服器多快回應')],
      ['cls', gl('CLS'), Number.isFinite(m.cls) ? String(m.cls) : '—', _t('載入時畫面會不會跳動')], ['loadMs', _t('完全載入'), sec_(m.loadMs), _t('所有資源載入完成')],
      ['totalKB', _t('頁面大小'), Number.isFinite(m.totalKB) ? m.totalKB + ' KB' : '—', _t('越小越快、越省流量')], ['requests', _t('請求數'), m.requests ?? '—', _t('載入了幾個檔案')],
      ['thirdPartyRequests', _t('第三方網域數'), m.thirdPartyRequests ?? '—', _t('有幾個外部網站參與載入')], ['renderBlockingScripts', _t('擋住畫面的腳本'), m.renderBlockingScripts ?? '—', _t('越少越好')], ['domNodes', _t('頁面元素數'), m.domNodes ?? '—', _t('太多會讓手機變慢')],
    ];
    let h = banner(V('perf')) + '<div class="mt">' + cards.map(([k, t, val, sub]) => '<div class="m ' + rate(k, m[k]) + '"><small>' + t + '</small><b>' + esc(String(val)) + '</b><i>' + esc(sub) + '</i></div>').join('') + '</div>';
    const viol = d.result?.violations || [];
    h += '<div class="card"><h3>' + _t('效能預算') + '</h3>' + (d.budget ? (viol.length ? '<table class="t"><tr><th>' + _t('頁面') + '</th><th>' + _t('指標') + '</th><th>' + _t('實際') + '</th><th>' + _t('上限') + '</th><th>' + _t('等級') + '</th></tr>' + viol.slice(0, 40).map((v) => '<tr><td>' + esc(v.url) + '</td><td>' + esc(v.metric) + '</td><td>' + esc(v.value) + '</td><td>' + esc(v.max) + '</td><td>' + esc(v.level) + '</td></tr>').join('') + '</table>' : '<p class="good">' + _t('所有頁面都在預算內') + '</p>') : '<p class="hint">' + _t('沒有設定預算。用 <code>--budget 檔案.json</code> 設定上限，超標時會以結束代碼 4 結束，適合放進自動化流程。') + '</p>') + '</div>';
    if ((d.rows || []).length > 1) h += '<div class="card" style="margin-top:14px"><h3>' + _t('每頁數據') + '</h3><table class="t"><tr><th>' + _t('頁面') + '</th><th>LCP</th><th>TTFB</th><th>KB</th><th>' + _t('請求') + '</th></tr>' + d.rows.map((r) => '<tr><td>' + esc(r.url) + '</td><td>' + esc(r.metrics.lcpMs ?? '—') + '</td><td>' + esc(r.metrics.ttfbMs ?? '—') + '</td><td>' + esc(r.metrics.totalKB ?? '—') + '</td><td>' + esc(r.metrics.requests ?? '—') + '</td></tr>').join('') + '</table></div>';
    h += '<p class="hint">' + _t('這是這台電腦上實測的數值（實驗室數據），會因網路與電腦而浮動；顏色依 Google 公布的「良好／需改善」界線。') + '</p>';
    s.innerHTML = h;
  })();

  // ---------- privacy ----------
  (function () {
    const d = CK.privacy, s = sec('privacy'); if (!d || !s) return;
    const KIND = { canvas: _t('讀取畫了文字的 canvas（canvas 指紋）'), webgl: _t('讀取顯示卡型號（WebGL 指紋）'), audio: _t('使用離線音訊運算（音訊指紋）'), fonts: _t('大量量測文字寬度（字型探測）') };
    const PARTY = { 'first-party': _t('同網站'), 'third-party': _t('第三方'), unknown: _t('來源不明') };
    let h = banner(V('privacy'));
    h += '<div class="card"><h3>' + _t('錄製訪客操作／熱點圖的服務') + '</h3>' + ((d.replay || []).length ? d.replay.map((r) => '<p><b>' + esc(r.name) + '</b> <span class="hint">' + esc(r.evidence) + '</span></p>').join('') + '<p class="hint">' + _t('這類服務會記錄訪客的滑鼠、點擊與捲動，部分會錄下畫面。通常需要在隱私權政策與同意橫幅中說明。') + '</p>' : '<p class="good">' + _t('沒有發現') + '</p>') + '</div>';
    h += '<div class="card" style="margin-top:14px"><h3>' + _t('瀏覽器指紋') + '</h3>' + ((d.fingerprint || []).length ? '<table class="t">' + d.fingerprint.map((f) => '<tr><td>' + esc(KIND[f.kind] || f.kind) + '</td><td class="mono">' + esc(f.src || '?') + '</td><td><span class="chip ' + (f.party === 'first-party' ? '' : 'warn') + '">' + esc(PARTY[f.party] || f.party) + '</span></td></tr>').join('') + '</table><p class="hint">' + _t('指紋可以在不用 Cookie 的情況下認出同一台裝置。防詐騙與支付腳本也會讀，所以這是「值得查」，不是「有問題」。') + '</p>' : '<p class="good">' + _t('沒有發現') + '</p>') + '</div>';
    const ks = d.keystroke || {};
    h += '<div class="card" style="margin-top:14px"><h3>' + _t('輸入的文字會不會被送到別的網站') + '</h3>' + (!ks.pagesTested ? '<p class="hint">' + _t('沒有可測的文字輸入框，或這次是登入狀態所以略過。') + '</p>' : (ks.leaks || []).length ? '<p class="warn2"><b>' + _t('在輸入框打的隨機字串被送往：') + '</b></p>' + ks.leaks.map((l) => '<p class="mono">' + esc(l.host) + ' <span class="hint">(' + esc(l.where) + ')</span></p>').join('') : '<p class="good">' + _t('在輸入框打了一段隨機文字（沒有送出表單），沒有看到它被送往其他網站。') + '</p>') + '<p class="hint">' + _t('測試只會在一個一般文字框輸入隨機字串並清掉，不會按送出；有密碼欄的頁面與疑似付款欄位一律不測。') + '</p></div>';
    s.innerHTML = h;
  })();

  // ---------- technology ----------
  (function () {
    const d = CK.tech, s = sec('tech'); if (!d || !s) return;
    const CAT = { cms: _t('內容管理系統／建站平台'), commerce: _t('電商'), framework: _t('前端／後端框架'), library: _t('函式庫'), animation: _t('動畫／3D'), fonts: _t('字型服務'), server: _t('網頁伺服器'), language: _t('程式語言'), cdn: _t('CDN'), hosting: _t('主機／部署平台') };
    const CONF = { high: _t('把握高'), medium: _t('把握中'), low: _t('只有一個線索') };
    let h = banner(V('tech'));
    if (!(d.items || []).length) h += '<div class="empty">' + _t('沒有辨識出已知的技術——可能是手寫的網站，或是這份規則還不認得它用的工具。') + '</div>';
    for (const c of Object.keys(CAT)) {
      const items = (d.items || []).filter((i) => i.category === c); if (!items.length) continue;
      h += '<div class="card" style="margin-bottom:12px"><h3>' + esc(CAT[c]) + '</h3>' + items.map((i) => '<details class="is"><summary><b>' + esc(i.name) + '</b>' + (i.version ? ' <span class="chip">' + esc(i.version) + '</span>' : '') + ' <span class="chip ' + (i.confidence === 'high' ? 'ok' : '') + '">' + esc(CONF[i.confidence] || '') + '</span></summary><div style="padding:6px 14px 12px">' + _t('依據：') + (i.evidence || []).map((e) => '<div class="mono">' + esc(e) + '</div>').join('') + '</div></details>').join('') + '</div>';
    }
    h += '<p class="hint">' + _t('只列出有證據的項目；網站可以隱藏標頭、改名檔案，所以沒列出來不代表沒用。') + '</p>';
    s.innerHTML = h;
  })();

  // ---------- screen comparison ----------
  (function () {
    const d = CK.visual, s = sec('visual'); if (!d || !s) return;
    const VP = { desktop: _t('桌機'), tablet: _t('平板'), mobile: _t('手機') };
    const rows = d.rows || [], changed = rows.filter((r) => r.status !== 'same');
    let h = banner(V('visual')) + '<p class="hint">' + _t('每張整頁截圖和你核准過的基準逐像素比對；每張容許 ') + esc(d.threshold) + _t('% 的像素不同（可用 --visual-threshold 調整）。紅色是變動處。') + '</p>';
    if (!changed.length) h += '<div class="empty">' + _t('所有畫面都和基準一致。') + '</div>';
    h += changed.map((r) => '<div class="card" style="margin-bottom:12px"><h3>' + esc(r.slug) + ' · ' + esc(VP[r.viewport] || r.viewport) + ' · ' + (r.status === 'changed' ? esc(String(r.changedPct)) + _t('% 不同') : r.status === 'missing' ? esc(_t('這次沒有截圖')) : esc(_t('無法比對'))) + '</h3>' + (r.diff || r.now ? '<div class="vs">' + (r.now ? '<figure><img loading="lazy" src="' + esc(r.now) + '"><figcaption>' + _t('現在') + '</figcaption></figure>' : '') + (r.diff ? '<figure><img loading="lazy" src="' + esc(r.diff) + '"><figcaption>' + _t('差異（紅色＝變動處）') + '</figcaption></figure>' : '') + '</div>' : '') + '</div>').join('');
    h += '<div class="card"><h3>' + _t('這個改版是想要的嗎？') + '</h3><p>' + _t('是：重新執行同一個指令並加上 <code>--approve</code>，把現在的樣子存成新的基準。') + '</p><p>' + _t('不是：修好網站後再執行 <code>--compare</code>，直到全部一致。') + '</p></div>';
    s.innerHTML = h;
  })();

  // ---------- custom extraction ----------
  (function () {
    const d = CK.extract, s = sec('extract'); if (!d || !s) return;
    const rules = d.rules || [];
    s.innerHTML = '<div class="vban info"><div class="ic">ℹ️</div><div><h2>' + esc(V('extract')?.headline || '') + '</h2><p>' + _t('用你自己寫的規則從每一頁抽出資料（價格、SKU、訂單編號…），完整表格也在 extractions.csv。') + '</p></div></div>' +
      '<div class="card"><table class="t"><tr><th>' + _t('頁面') + '</th>' + rules.map((r) => '<th>' + esc(r.name) + '</th>').join('') + '</tr>' + (d.rows || []).map((row) => '<tr><td>' + esc(row.url) + '</td>' + rules.map((r) => { const x = (row.extract || {})[r.name]; return '<td>' + (x && x.error ? '<span class="warn2">' + esc(_t('規則有誤或逾時')) + '</span>' : esc(((x && x.values) || []).join(' | ')) || '<span class="hint">—</span>') + '</td>'; }).join('') + '</tr>').join('') + '</table></div>';
  })();

  // ---------- files: offline archive and Figma layers (in the details tab) ----------
  (function () {
    const files = CK.files || []; const t = sec('data'); if (!files.length || !t) return;
    const arch = files.filter((f) => f.kind === 'archive'), fig = files.filter((f) => f.kind === 'figma');
    t.insertAdjacentHTML('afterbegin', '<div class="card" style="margin-bottom:14px"><h3>' + _t('離線封存與 Figma 圖層') + '</h3>' +
      (arch.length ? '<p>' + _t('離線單檔網頁（雙擊就能開，不需要網路）：') + '</p>' + arch.map((f) => '<a class="lnk" target="_blank" href="' + esc(f.href) + '">' + esc(f.slug) + '</a>').join('') : '') +
      (fig.length ? '<p>' + _t('Figma 圖層 SVG（拖進 Figma 畫布即可編輯）：') + '</p>' + fig.map((f) => '<a class="lnk" target="_blank" href="' + esc(f.href) + '">' + esc(f.slug) + '</a>').join('') : '') + '</div>');
  })();
})();
