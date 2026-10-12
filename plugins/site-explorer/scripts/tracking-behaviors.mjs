#!/usr/bin/env node
// Tracking BEHAVIOUR, not just tracker names: session-replay / heatmap services, browser fingerprinting (canvas, WebGL, audio, font probing) and
// keystroke capture (typed text that leaves for another site). Works like privacy scanners such as Blacklight: hooks installed before the page's own
// scripts run record how the page uses fingerprinting-prone APIs; a harmless probe types a random token into one text box (never submits) and watches
// where it goes. Heuristics: a hit is a reason to look, not proof of misuse (anti-fraud and payment scripts also read canvas).
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

/** Browser-side, added with addInitScript: records, never changes behaviour. Result: window.__seFp. */
export function fingerprintHooks() {
  const rec = (window.__seFp = window.__seFp || { canvas: [], webgl: [], audio: [], measureText: 0, measureSrc: '' });
  const src = () => { try { const m = (new Error().stack || '').split('\n').slice(3).join(' ').match(/https?:\/\/[^\s)]+/); if (!m) return ''; const u = new URL(m[0].replace(/:\d+:\d+$/, '').replace(/:\d+$/, '')); return u.origin + u.pathname; } catch { return ''; } };
  const wrap = (proto, name, fn) => { try { const orig = proto && proto[name]; if (typeof orig !== 'function') return; proto[name] = function (...a) { try { fn.call(this, a); } catch {} return orig.apply(this, a); }; } catch {} };
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, CV = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  const drewText = new WeakSet();
  wrap(C2D, 'fillText', function () { if (this.canvas) drewText.add(this.canvas); });
  wrap(C2D, 'strokeText', function () { if (this.canvas) drewText.add(this.canvas); });
  wrap(C2D, 'measureText', function () { rec.measureText++; if (!rec.measureSrc) rec.measureSrc = src(); });
  const read = (api) => function () { const c = this.canvas || this; if (c && drewText.has(c) && c.width <= 700 && c.height <= 300 && rec.canvas.length < 20) rec.canvas.push({ api, w: c.width, h: c.height, src: src() }); };
  wrap(CV, 'toDataURL', read('toDataURL')); wrap(CV, 'toBlob', read('toBlob')); wrap(C2D, 'getImageData', read('getImageData'));
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) wrap(Ctx && Ctx.prototype, 'getParameter', function (a) { if ((a[0] === 37445 || a[0] === 37446) && rec.webgl.length < 10) rec.webgl.push({ param: a[0] === 37446 ? 'UNMASKED_RENDERER' : 'UNMASKED_VENDOR', src: src() }); });
  try { if (window.OfflineAudioContext) { const O = window.OfflineAudioContext; window.OfflineAudioContext = new Proxy(O, { construct(t, a, nt) { try { if (rec.audio.length < 5) rec.audio.push({ src: src() }); } catch {} return Reflect.construct(t, a, nt); } }); } } catch {}
}

/** Node-side, after the page has loaded: read the hooks and run the keystroke probe on one text box. Never submits anything. */
export async function collectBehaviors(page, { auth = false } = {}) {
  const fp = await page.evaluate(() => window.__seFp || null).catch(() => null);
  // the page can overwrite window.__seFp with anything: keep only well-formed entries
  const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').slice(0, 20).map((x) => ({ api: typeof x.api === 'string' ? x.api.slice(0, 30) : '', src: typeof x.src === 'string' ? x.src.slice(0, 300) : '', param: typeof x.param === 'string' ? x.param.slice(0, 30) : '' })) : []);
  const out = { fp: fp && typeof fp === 'object' ? { canvas: list(fp.canvas), webgl: list(fp.webgl), audio: list(fp.audio), measureText: Number.isFinite(fp.measureText) ? Math.min(fp.measureText, 1e6) : 0, measureSrc: typeof fp.measureSrc === 'string' ? fp.measureSrc.slice(0, 300) : '' } : null, keystrokes: { tested: false, reason: null, leaks: [] } };
  if (auth) { out.keystrokes.reason = 'logged-in session'; return out; }
  try {
    const target = await page.evaluateHandle(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 20 && r.height > 10 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.disabled && !el.readOnly; };
      const hasPw = !!document.querySelector('input[type=password]'); // anywhere on the page, form or not: a login box is never probed
      const SENSITIVE = /pass|pwd|card|cc-|cvv|cvc|iban|ssn|otp|one-time|token|secret|pin\b|credit|account|routing|tax|birth|信用卡|卡號|卡号|密碼|密码|驗證碼|验证码|身分證|身份证|帳號|账号|銀行|银行|付款|支付/i;
      const ok = (el) => (el.tagName === 'TEXTAREA' || /^(text|search|email|tel|url)$/i.test(el.type || 'text')) && vis(el) && !hasPw && !SENSITIVE.test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder} ${el.getAttribute('aria-label') || ''} ${el.inputMode || ''}`) && !(el.form && /(login|signin|sign-in|checkout|payment|登入|結帳)/i.test(`${el.form.id} ${el.form.className} ${el.form.action}`));
      return [...document.querySelectorAll('input:not([type]), input[type], textarea')].find(ok) || null;
    });
    const el = target.asElement(); if (!el) { out.keystrokes.reason = 'no suitable text box'; return out; }
    const token = 'seprobe' + Math.random().toString(16).slice(2, 10); const here = new URL(page.url()).hostname; const seen = [];
    const onReq = (r) => { try { const u = new URL(r.url()); if (sameSite(u.hostname, here) || !/^https?:$/.test(u.protocol)) return; const body = r.postData() || ''; if (r.url().includes(token)) seen.push({ host: u.hostname, where: 'url' }); else if (body.includes(token)) seen.push({ host: u.hostname, where: 'body' }); } catch {} };
    page.on('request', onReq);
    try {
      await el.focus({ timeout: 2000 });
      // keyboard input goes to whatever has focus: if the page moved focus elsewhere (a password box, say), type nothing
      const same = await page.evaluate((e) => document.activeElement === e, el).catch(() => false);
      if (!same) { out.keystrokes.reason = 'focus moved away'; return out; }
      await page.keyboard.type(token, { delay: 12 }); await page.waitForTimeout(1500);
    } finally { page.off('request', onReq); }
    try { await el.fill('', { timeout: 1500 }); } catch {}
    out.keystrokes = { tested: true, reason: null, leaks: [...new Map(seen.map((s) => [s.host + s.where, s])).values()].slice(0, 10) };
  } catch (e) { out.keystrokes.reason = String(e.message).split('\n')[0].slice(0, 80); }
  return out;
}

// services that record what visitors do on a page (replay / heatmap / auto-capture); matched on the script and request addresses
const REPLAY = [
  ['Hotjar', /static\.hotjar\.com|script\.hotjar\.com|hotjar\.io/i], ['Microsoft Clarity', /clarity\.ms/i], ['FullStory', /fullstory\.com/i], ['Mouseflow', /mouseflow\.com/i],
  ['LogRocket', /logrocket\.(com|io)|lr-ingest\.io|lr-in\.com|lr-in-prod\.com/i], ['Smartlook', /smartlook\.com/i], ['Lucky Orange', /luckyorange\.(com|net)/i], ['Inspectlet', /inspectlet\.com/i],
  ['Crazy Egg', /crazyegg\.com/i], ['Heap', /heapanalytics\.com|heap-api\.com/i], ['PostHog', /posthog\.com|i\.posthog/i],
];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'idv', 'mil']);
const site = (h) => { if (/^[\d.]+$/.test(h) || String(h).includes(':')) return String(h); const p = String(h).split('.'); if (p.length >= 3 && p[p.length - 1].length === 2 && SLD.has(p[p.length - 2])) return p.slice(-3).join('.'); return p.slice(-2).join('.'); };
export const sameSite = (a, b) => a === b || site(a) === site(b);

export function analyzeBehaviors(pages) {
  const live = (pages || []).filter((p) => p && (!p.status || p.status < 400));
  const replay = new Map(), fingerprint = [], keystroke = { tested: 0, leaks: [] };
  for (const p of live) {
    const urls = [...(p.editing?.scripts || []), ...(p.tech?.urls || [])].map(String);
    for (const [name, re] of REPLAY) { const u = urls.find((x) => re.test(x)); if (u && !replay.has(name)) replay.set(name, clean(u.replace(/^https?:\/\//, ''), 90)); }
    const b = p.behaviors; if (!b) continue; const here = hostOf(p.url);
    const f = b.fp; if (f) {
      const scripts = (list) => [...new Set(list.map((x) => x.src).filter(Boolean))];
      const party = (s) => (sameSite(hostOf(s), here) ? 'first-party' : 'third-party');
      for (const s of scripts(f.canvas)) fingerprint.push({ kind: 'canvas', src: clean(s, 120), party: party(s), page: p.url });
      for (const s of scripts(f.webgl)) fingerprint.push({ kind: 'webgl', src: clean(s, 120), party: party(s), page: p.url });
      for (const s of scripts(f.audio)) fingerprint.push({ kind: 'audio', src: clean(s, 120), party: party(s), page: p.url });
      if (f.measureText > 40) fingerprint.push({ kind: 'fonts', src: clean(f.measureSrc || '', 120), party: f.measureSrc ? party(f.measureSrc) : 'unknown', page: p.url, count: f.measureText });
    }
    if (b.keystrokes?.tested) { keystroke.tested++; for (const l of b.keystrokes.leaks || []) keystroke.leaks.push({ host: clean(l.host, 80), where: l.where, page: p.url }); }
  }
  const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
  const fp = uniq(fingerprint, (x) => x.kind + x.src);
  const flags = { replay: replay.size > 0, fingerprintThirdParty: fp.some((x) => x.party !== 'first-party'), keystrokeLeak: keystroke.leaks.length > 0 };
  return { pagesChecked: live.length, replay: [...replay].map(([name, evidence]) => ({ name, evidence })), fingerprint: fp, keystroke: { pagesTested: keystroke.tested, leaks: uniq(keystroke.leaks, (x) => x.host + x.where) }, flags };
}

export function renderBehaviorsMd(r) {
  const L = [BANNER, '', _t('# 追蹤行為檢查'), '', _t('這不只看有哪些追蹤服務，而是看頁面實際做了什麼：有沒有錄製訪客操作、有沒有讀取瀏覽器指紋、輸入的文字會不會被送到別的網站。這些是啟發式判斷：有命中是「值得查」的理由，不是濫用的證據（防詐騙與支付腳本也會讀 canvas）。'), ''];
  L.push(_t('## 錄製訪客操作／熱點圖的服務'), '', ...(r.replay.length ? r.replay.map((x) => `- **${x.name}** — \`${x.evidence.replace(/`/g, '')}\``) : [_t('（沒有發現）')]), '');
  L.push(_t('## 瀏覽器指紋'), '');
  const K = { canvas: _t('讀取畫了文字的 canvas（canvas 指紋）'), webgl: _t('讀取顯示卡型號（WebGL 指紋）'), audio: _t('使用離線音訊運算（音訊指紋的常見手法）'), fonts: _t('大量量測文字寬度（字型探測）') };
  L.push(...(r.fingerprint.length ? r.fingerprint.map((x) => `- ${K[x.kind]}：\`${(x.src || '?').replace(/`/g, '')}\`（${x.party === 'first-party' ? _t('同網站') : x.party === 'third-party' ? _t('第三方') : _t('來源不明')}）`) : [_t('（沒有發現）')]), '');
  L.push(_t('## 輸入文字是否被送到別的網站'), '');
  if (!r.keystroke.pagesTested) L.push(_t('（沒有可測的文字輸入框，或這次是登入狀態所以略過。）'));
  else if (!r.keystroke.leaks.length) L.push(_t`在 ${r.keystroke.pagesTested} 頁各輸入一段隨機文字（不送出表單），沒有看到它被送往其他網站。`);
  else L.push(_t`**輸入的隨機文字被送往：**`, ...r.keystroke.leaks.map((x) => `- \`${x.host}\`（${x.where === 'url' ? _t('網址') : _t('請求內容')}）`));
  L.push('', _t('> 測試只會在一個一般文字框輸入隨機字串並清掉，不會按送出；有密碼欄的表單與疑似付款／驗證欄位一律不測。'), '');
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：tracking-behaviors.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const pages = (site.pages || []).map((p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const r = analyzeBehaviors(pages);
  fs.writeFileSync(path.join(dir, 'tracking-behaviors.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(dir, 'tracking-behaviors.md'), renderBehaviorsMd(r) + '\n');
  console.log(_t`追蹤行為：錄製服務 ${r.replay.length}・指紋線索 ${r.fingerprint.length}・輸入外流 ${r.keystroke.leaks.length} → ${path.join(dir, 'tracking-behaviors.md')}`);
}
