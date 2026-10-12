#!/usr/bin/env node
// Graphical front end:  site-explorer ui   — a small web page on this computer (127.0.0.1 only) to type an address, pick a mode, watch progress and open past reports.
// It only starts the normal CLI as a child process; every option is validated here first. Anything crawled stays inside the run folder and is served with a sandbox policy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _t, LANG } from './i18n.mjs';
import { normalizeUrl } from './args.mjs';
import { isMain } from './util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'site-explorer.mjs');
const MODES = { check: { cmd: 'check', pages: 8, max: 30 }, full: { cmd: 'explore', pages: 12, max: 60 } };
const RUN_ID = /^r\d{8}-\d{6}-[0-9a-f]{4}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Turn the form values into CLI arguments, or an error message. Nothing the browser sends reaches the command line unchecked. */
export function buildArgs(body, outDir) {
  const url = normalizeUrl(body?.url);
  if (!url) return { error: _t('請輸入網址，例如 example.com') };
  const mode = MODES[body.mode] ? body.mode : 'check';
  const m = MODES[mode];
  const pages = body.maxPages == null || body.maxPages === '' ? m.pages : Number(body.maxPages);
  if (!Number.isInteger(pages) || pages < 1 || pages > m.max) return { error: _t`頁數必須是 1 到 ${m.max} 的整數` };
  const lang = body.lang === 'en' ? 'en' : 'zh';
  const args = [m.cmd, url, '--no-open', '--max-pages', String(pages), '--out', outDir];
  if (lang === 'en') args.push('--lang', 'en');
  if (mode === 'full' && body.motion === false) args.push('--no-motion');
  if (body.a11y === true) args.push('--a11y');
  return { url, mode, args };
}

/** The things a first-time user needs to know before pressing the button. */
export async function checkEnv() {
  let browser = false; try { const { launchBrowser } = await import('./launch.mjs'); const b = await launchBrowser(); await b.close(); browser = true; } catch {}
  return { browser, node: process.versions.node };
}
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/** Score, grade and the first three things to fix of a finished run (read from the files the explorer wrote). */
export function runSummary(runDir) {
  try {
    const sites = path.join(runDir, 'out', 'site'); const name = fs.readdirSync(sites).find((n) => fs.existsSync(path.join(sites, n, 'site.json'))); if (!name) return null;
    const sd = path.join(sites, name); const h = rd(path.join(sd, 'health.json')); const tf = rd(path.join(sd, 'top-fixes.json')) || [];
    return { score: Number.isFinite(h?.score) ? h.score : null, grade: h?.grade || null, pages: h?.pagesAnalyzed ?? null, fixes: tf.slice(0, 3).map((f) => ({ title: String(f.title || '').slice(0, 200), why: String(f.why || '').slice(0, 300), severity: String(f.severity || ''), effort: Number(f.effort) || 2, prompt: String(f.prompt || '').slice(0, 4000) })), dashboard: fs.existsSync(path.join(runDir, 'out', 'dashboard.html')) };
  } catch { return null; }
}
/** "[3/9] label" lines in the explorer's output -> where the run is. */
export function progressOf(log) { let m, last = null; const re = /^\[(\d+)\/(\d+)\]\s*(.*)$/gm; while ((m = re.exec(log))) last = { step: Number(m[1]), total: Number(m[2]), label: m[3].slice(0, 120) }; return last; }

export function startUi({ port = 0, baseDir = path.resolve(process.env.SITE_EXPLORER_UI_OUT || './site-explorer-runs'), host = '127.0.0.1' } = {}) {
  const token = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(baseDir, { recursive: true });
  let current = null; // { id, url, mode, child, log, exit }
  let env = null; const getEnv = async (fresh) => { if (!env || fresh) env = await checkEnv(); return env; };
  const stamp = () => { const d = new Date(), p = (n, l = 2) => String(n).padStart(l, '0'); return `r${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`; };
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(obj)); };
  const listRuns = () => fs.readdirSync(baseDir).filter((n) => RUN_ID.test(n)).sort().reverse().slice(0, 30).map((id) => {
    const dir = path.join(baseDir, id); const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'ui-run.json'), 'utf8')); } catch { return {}; } })();
    return { id, url: meta.url || '', mode: meta.mode || '', at: meta.at || null, exit: meta.exit ?? null, dashboard: fs.existsSync(path.join(dir, 'out', 'dashboard.html')), running: current?.id === id && current.exit == null };
  });

  const server = http.createServer((req, res) => {
    // only this computer, only under its own name (a web page elsewhere cannot rebind its name to us)
    const hostOk = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '');
    if (!hostOk) { res.writeHead(403); return res.end('forbidden'); }
    let u; try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    const p = u.pathname;
    const authed = u.searchParams.get('k') === token || req.headers['x-se-token'] === token;

    if (p.startsWith('/runs/')) { // static files of one run, with the token in the first path segment so links work from the page
      const m = /^\/runs\/([^/]+)\/(.*)$/.exec(p); if (!m || !RUN_ID.test(m[1])) { res.writeHead(404); return res.end(); }
      if (u.searchParams.get('k') !== token && !(req.headers.cookie || '').includes('se_k=' + token)) { res.writeHead(403); return res.end('forbidden'); }
      let rel; try { rel = decodeURIComponent(m[2]) || 'dashboard.html'; } catch { res.writeHead(400); return res.end(); }
      const root = path.resolve(baseDir, m[1], 'out'); const file = path.resolve(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      let real; try { real = fs.realpathSync(file); if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw 0; if (!fs.statSync(real).isFile()) throw 0; } catch { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(real).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': 'sandbox allow-scripts allow-downloads allow-popups allow-forms', 'set-cookie': `se_k=${token}; Path=/runs/; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store' });
      return fs.createReadStream(real).pipe(res);
    }
    if (!authed) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(_t('請使用 site-explorer ui 印出的完整網址開啟。')); }

    if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'cache-control': 'no-store' }); return res.end(page(token)); }
    if (req.method === 'GET' && p === '/api/runs') return json(res, 200, { runs: listRuns(), current: current ? { id: current.id, kind: current.kind || 'run', url: current.url, running: current.exit == null, exit: current.exit, log: current.log.slice(-6000), progress: progressOf(current.log), summary: current.kind !== 'setup' && current.exit === 0 ? runSummary(path.join(baseDir, current.id)) : null } : null });
    if (req.method === 'GET' && p === '/api/env') { getEnv(u.searchParams.get('fresh') === '1').then((e) => json(res, 200, e)); return; }
    if (req.method === 'GET' && p.startsWith('/api/summary/')) { const id = p.slice('/api/summary/'.length); if (!RUN_ID.test(id)) return json(res, 404, {}); return json(res, 200, runSummary(path.join(baseDir, id)) || {}); }
    if (req.method === 'POST' && p === '/api/setup') {
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json only' });
      req.resume(); req.on('end', () => {
        if (current && current.exit == null) return json(res, 409, { error: _t('已經有一個探索在執行，請等它結束或先停止。') });
        const child = spawn(process.execPath, [bin, 'setup', '--yes'], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
        current = { id: 'setup', kind: 'setup', url: '', mode: 'setup', child, log: '', exit: null };
        const add = (d) => { current.log = (current.log + String(d).replace(/\x1b\[[0-9;]*m/g, '')).slice(-60000); }; child.stdout.on('data', add); child.stderr.on('data', add);
        child.on('close', (code) => { if (current && current.kind === 'setup' && current.exit == null) { current.exit = code ?? -1; env = null; } }); child.on('error', (e) => { add(String(e.message)); if (current) current.exit = -1; });
        json(res, 200, { ok: true });
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/run') {
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json only' });
      let size = 0, buf = ''; req.on('data', (d) => { size += d.length; if (size > 4000) req.destroy(); else buf += d; });
      req.on('end', () => {
        if (current && current.exit == null) return json(res, 409, { error: _t('已經有一個探索在執行，請等它結束或先停止。') });
        let body; try { body = JSON.parse(buf); } catch { return json(res, 400, { error: 'bad json' }); }
        const id = stamp(); const runDir = path.join(baseDir, id); const outDir = path.join(runDir, 'out'); // the explorer insists on creating its own, empty folder
        const built = buildArgs(body, outDir); if (built.error) return json(res, 400, { error: built.error });
        fs.mkdirSync(runDir, { recursive: true });
        const meta = { url: built.url, mode: built.mode, at: new Date().toISOString(), exit: null };
        const save = () => { try { fs.writeFileSync(path.join(runDir, 'ui-run.json'), JSON.stringify(meta)); } catch {} };
        save();
        const child = spawn(process.execPath, [bin, ...built.args], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
        current = { id, url: built.url, mode: built.mode, child, log: '', exit: null };
        const add = (d) => { current.log = (current.log + String(d).replace(/\x1b\[[0-9;]*m/g, '')).slice(-60000); };
        child.stdout.on('data', add); child.stderr.on('data', add);
        const done = (code) => { if (current && current.id === id && current.exit == null) { current.exit = code ?? -1; meta.exit = current.exit; save(); } };
        child.on('close', done); child.on('error', (e) => { add(String(e.message)); done(-1); });
        json(res, 200, { id });
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/stop') { if (current && current.exit == null) { try { current.child.kill('SIGTERM'); } catch {} } return json(res, 200, { ok: true }); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, token, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/?k=${token}`, baseDir, stop: () => { try { current?.child.kill('SIGTERM'); } catch {} server.close(); } }));
  });
}

function page(token) {
  const mark = (() => { try { return 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'report', 'brand', 'mark.png')).toString('base64'); } catch { return ''; } })();
  const logo = (() => { try { return 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'report', 'brand', 'logo-on-dark.png')).toString('base64'); } catch { return ''; } })();
  const T = JSON.stringify({ running: _t('執行中…'), done: _t('完成'), failed: _t('失敗（結束代碼 '), start: _t('開始探索'), none: _t('還沒有紀錄'), openDash: _t('開啟儀表板'), openFix: _t('最該先處理的事'), quick: _t('快速檢查'), full: _t('完整探索'), stopped: _t('已停止'), copy: _t('複製給 AI 的指令'), copied: _t('已複製'), quickfix: _t('很快'), someTime: _t('需要一點時間'), hard: _t('較費工'), score: _t('健檢分數'), top3: _t('最該先處理的 3 件事'), nothing: _t('沒有發現需要立刻處理的問題。'), step: _t('步驟'), where: _t('結果資料夾'), nobrowser: _t('找不到可用的瀏覽器（Chrome／Edge／Chromium）。按下面的按鈕下載一份，之後就能開始探索（只需要一次）。') });
  return `<!doctype html><html lang="${LANG === 'en' ? 'en' : 'zh-Hant'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>site-explorer</title>${mark ? `<link rel="icon" href="${mark}">` : ''}
<style>:root{--bg:#f3f5f8;--card:#fff;--tx:#16181d;--mu:#5d6572;--ln:#e3e8ef;--ac:#0e7bb3;--ac2:#fff;--bad:#b42318;--ok:#067647;--top:#0b1220;--brand:linear-gradient(90deg,#f6d85a,#e2794d 34%,#7abfa9 67%,#43b4e0)}@media(prefers-color-scheme:dark){:root{--bg:#0b0e14;--card:#141923;--tx:#e8eaee;--mu:#9aa3af;--ln:#252c3a;--ac:#5cc3ee;--ac2:#06141c;--bad:#f97066;--ok:#47cd89;--top:#070a10}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif}header{display:flex;align-items:center;gap:16px;padding:0 24px;height:64px;background:var(--top);color:#fff;border-bottom:3px solid transparent;border-image:var(--brand) 1}header img{height:34px;width:auto}header b{font-size:15px;font-weight:600;padding-left:16px;border-left:1px solid #ffffff33}main{max-width:860px;margin:0 auto;padding:20px 16px 48px;display:grid;gap:16px}.card{background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:18px}h2{margin:0 0 12px;font-size:16px}label{display:block;font-size:13px;color:var(--mu);margin:12px 0 4px}input[type=text],input[type=number],select{width:100%;padding:10px 12px;border:1px solid var(--ln);border-radius:8px;background:var(--bg);color:var(--tx);font:inherit}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.opts{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}.opts label{display:flex;gap:6px;align-items:center;margin:0;color:var(--tx)}.modes{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mode{border:1px solid var(--ln);border-radius:10px;padding:12px;cursor:pointer}.mode input{margin-right:6px}.mode small{display:block;color:var(--mu);margin-top:2px}.mode:has(input:checked){border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid var(--ln);background:var(--card);color:var(--tx);cursor:pointer}button.go{background:var(--ac);color:var(--ac2);border-color:var(--ac);font-weight:600}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--ac);outline-offset:2px}.bar{display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap}.err{color:var(--bad);min-height:1.4em;font-size:13px}pre{margin:10px 0 0;padding:12px;background:var(--bg);border:1px solid var(--ln);border-radius:8px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}.run{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--ln)}.run:first-of-type{border-top:0}.run div{min-width:0}.run .u{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.run small{color:var(--mu)}.run a{color:var(--ac);text-decoration:none;margin-left:12px;white-space:nowrap}.st{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--ln)}.st.ok{color:var(--ok)}.st.bad{color:var(--bad)}details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::before{content:'▸ ';color:var(--mu)}details[open]>summary::before{content:'▾ '}#envbar{border-color:var(--bad)}#envbar p{margin:0 0 10px}progress{width:100%;height:10px;accent-color:var(--ac)}.sum .score{font-size:34px;font-weight:700;line-height:1}.sum .grade{margin-left:8px;color:var(--mu)}.fix{padding:12px 0;border-top:1px solid var(--ln)}.fix b{display:block}.fix small{color:var(--mu);display:block;margin:2px 0 8px}.tag{display:inline-block;padding:0 8px;margin-left:6px;border:1px solid var(--ln);border-radius:99px;font-size:12px;color:var(--mu)}@media(max-width:560px){.row,.modes{grid-template-columns:1fr}.run{flex-direction:column;align-items:flex-start}.run a{margin:6px 12px 0 0}}</style></head><body>
<header>${logo ? `<img src="${logo}" alt="">` : ''}<b>site-explorer</b></header><main>
<section class="card" id="envbar" hidden><p id="envmsg"></p><button class="go" id="setup">${esc(_t('下載瀏覽器（約 150 MB）'))}</button></section>
<section class="card"><h2>${esc(_t('探索一個網站'))}</h2>
<label for="url">${esc(_t('網址'))}</label><input id="url" type="text" inputmode="url" autocomplete="off" placeholder="example.com">
<label>${esc(_t('模式'))}</label><div class="modes"><label class="mode"><input type="radio" name="mode" value="check" checked><b>${esc(_t('快速檢查'))}</b><small>${esc(_t('最多 8 頁、不擷取 3D，幾分鐘內看到最該先處理的事'))}</small></label><label class="mode"><input type="radio" name="mode" value="full"><b>${esc(_t('完整探索'))}</b><small>${esc(_t('設計、排版、3D／動畫、健檢與交接包，耗時較久'))}</small></label></div>
<div class="row"><div><label for="pages">${esc(_t('最多頁數'))}</label><input id="pages" type="number" min="1" max="60" placeholder="8"></div><div><label for="lang">${esc(_t('報告語言'))}</label><select id="lang"><option value="zh">${esc(_t('中文'))}</option><option value="en">English</option></select></div></div>
<div class="opts"><label><input type="checkbox" id="motion" checked> ${esc(_t('擷取 3D／動畫（完整探索）'))}</label><label><input type="checkbox" id="a11y"> ${esc(_t('無障礙檢查（較慢）'))}</label></div>
<div class="bar"><button class="go" id="go">${esc(_t('開始探索'))}</button><button id="stop" hidden>${esc(_t('停止'))}</button><span class="err" id="err" role="alert"></span></div></section>
<section class="card sum" id="sum" hidden></section>
<details class="card" id="cur" hidden open><summary><b id="curt"></b></summary><progress id="prog" max="1" value="0" hidden></progress><small id="progl"></small><pre id="log" aria-live="polite"></pre></details>
<section class="card"><h2>${esc(_t('最近的探索'))}</h2><div id="runs"></div></section></main>
<script>const K=${JSON.stringify(token)},T=${T},$=(s)=>document.querySelector(s);
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
let busy=false,shown='';
const ls={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
if(ls.get('se_url'))$('#url').value=ls.get('se_url');if(ls.get('se_mode')==='full'){document.querySelector('input[name=mode][value=full]').checked=true;$('#pages').placeholder='12'}if(ls.get('se_lang'))$('#lang').value=ls.get('se_lang');
async function env(fresh){let e;try{e=await (await fetch('/api/env?k='+K+(fresh?'&fresh=1':''))).json()}catch{return}
 $('#envbar').hidden=e.browser;if(!e.browser){$('#envmsg').textContent=T.nobrowser}}
$('#setup').onclick=async()=>{$('#setup').disabled=true;await fetch('/api/setup?k='+K,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});poll()};
function sumHtml(c){const s=c.summary;if(!s)return '';let h='<h2>'+esc(T.score)+'</h2><div><span class="score">'+(s.score==null?'—':esc(s.score))+'</span><span class="grade">'+esc(s.grade||'')+'</span></div><h2 style="margin-top:16px">'+esc(T.top3)+'</h2>';
 h+=s.fixes.length?s.fixes.map((f,i)=>'<div class="fix"><b>'+(i+1)+'. '+esc(f.title)+'<span class="tag">'+esc(f.effort===1?T.quickfix:f.effort===3?T.hard:T.someTime)+'</span></b><small>'+esc(f.why)+'</small><button data-i="'+i+'">'+esc(T.copy)+'</button></div>').join(''):'<small>'+esc(T.nothing)+'</small>';
 if(s.dashboard)h+='<div class="bar"><a class="go" style="padding:10px 18px;border-radius:8px;text-decoration:none;background:var(--ac);color:var(--ac2);font-weight:600" href="/runs/'+c.id+'/dashboard.html?k='+K+'" target="_blank" rel="noopener noreferrer">'+esc(T.openDash)+'</a></div>';return h}
function mode0(){return document.querySelector('input[name=mode]:checked').value}
function modeVal(){return document.querySelector('input[name=mode]:checked').value}
const syncMode=()=>{$('#pages').placeholder=modeVal()==='full'?'12':'8';$('#motion').disabled=modeVal()!=='full'};document.querySelectorAll('input[name=mode]').forEach((r)=>r.addEventListener('change',syncMode));syncMode();
$('#go').onclick=async()=>{$('#err').textContent='';ls.set('se_url',$('#url').value);ls.set('se_mode',modeVal());ls.set('se_lang',$('#lang').value);shown='';$('#sum').hidden=true;$('#cur').open=true;const b={url:$('#url').value,mode:modeVal(),lang:$('#lang').value,motion:$('#motion').checked,a11y:$('#a11y').checked};if($('#pages').value!=='')b.maxPages=Number($('#pages').value);
 const r=await fetch('/api/run?k='+K,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok){$('#err').textContent=j.error||'error';return}poll()};
$('#stop').onclick=()=>fetch('/api/stop?k='+K,{method:'POST'});
async function poll(){let j;try{j=await (await fetch('/api/runs?k='+K,{cache:'no-store'})).json()}catch{return}
 const c=j.current;busy=!!(c&&c.running);$('#go').disabled=busy;$('#stop').hidden=!busy;if(c&&c.kind==='setup'&&!c.running){$('#setup').disabled=false;env(true)}
 if(c){const pr=c.progress;$('#prog').hidden=!(c.running&&pr);if(pr){$('#prog').max=pr.total;$('#prog').value=pr.step;$('#progl').textContent=T.step+' '+pr.step+'/'+pr.total+' · '+pr.label}else $('#progl').textContent='';$('#cur').hidden=false;if(c.summary&&shown!==c.id){shown=c.id;const sm=$('#sum');sm.innerHTML=sumHtml(c);sm.hidden=false;$('#cur').open=false;sm.querySelectorAll('button[data-i]').forEach((b)=>b.onclick=async()=>{try{await navigator.clipboard.writeText(c.summary.fixes[+b.dataset.i].prompt);b.textContent=T.copied}catch{b.textContent='✗'}})}$('#curt').textContent=(c.running?T.running:(c.exit===0?T.done:T.failed+c.exit+'）'))+'  '+c.url;const l=$('#log');const atEnd=l.scrollTop+l.clientHeight>=l.scrollHeight-8;l.textContent=c.log;if(atEnd)l.scrollTop=l.scrollHeight}
 $('#runs').innerHTML=j.runs.length?j.runs.map((r)=>{const st=r.running?'<span class="st">'+esc(T.running)+'</span>':r.exit===0?'<span class="st ok">'+esc(T.done)+'</span>':r.exit==null?'':'<span class="st bad">'+esc(r.exit)+'</span>';
  return '<div class="run"><div><div class="u">'+esc(r.url||r.id)+'</div><small>'+esc(r.at?new Date(r.at).toLocaleString():'')+' · '+esc(r.mode==='full'?T.full:T.quick)+'</small> '+st+'</div><div>'+(r.dashboard?'<a href="/runs/'+r.id+'/dashboard.html?k='+K+'" target="_blank" rel="noopener noreferrer">'+esc(T.openDash)+'</a>':'')+'</div></div>'}).join(''):'<small>'+esc(T.none)+'</small>';
 setTimeout(poll,busy?1500:5000)}
env();poll();</script></body></html>`;
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const port = arg('--port') == null ? 0 : Number(arg('--port'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error(_t('--port 必須是 0 到 65535 的整數。')); process.exit(1); }
  const ui = await startUi({ port, baseDir: arg('--out') ? path.resolve(arg('--out')) : undefined }).catch((e) => { console.error(String(e.code === 'EADDRINUSE' ? _t('這個連接埠已被使用，請改用 --port。') : e.message)); process.exit(1); });
  console.log(_t`圖形介面已啟動（只有這台電腦連得到）：\n  ${ui.url}\n探索結果存在：${ui.baseDir}\n按 Ctrl+C 結束。`);
  if (!process.argv.includes('--no-open')) { const [cmd, a] = process.platform === 'darwin' ? ['open', [ui.url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', ui.url]] : ['xdg-open', [ui.url]]; try { spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {} }
  process.on('SIGINT', () => { ui.stop(); process.exit(0); });
}
