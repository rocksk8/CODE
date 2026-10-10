#!/usr/bin/env node
// "Why did this page come out empty?" in one paste:  diagnose.mjs <url> [--headed] [--out ./diagnose-out]
// Opens the page the way the crawler does and again with the browser's own default identity, and reports what each run saw.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './launch.mjs';
import { findUrl } from './args.mjs';
import { guardInternal, isMain } from './util.mjs';
import { attachNetworkRecorder, deepContent } from './observe.mjs';

const UA = 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

export async function probe(browser, url, { label, userAgent, outDir, waitMs = 15000 }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(userAgent ? { userAgent } : {}) });
  await guardInternal(ctx, url);
  const page = await ctx.newPage(); const errors = [], failed = []; const net = attachNetworkRecorder(page);
  page.on('console', (m) => { if (m.type() === 'error' && errors.length < 3) errors.push(m.text().slice(0, 140)); });
  page.on('requestfailed', (r) => { if (failed.length < 3) failed.push(`${r.failure()?.errorText || 'failed'} ${new URL(r.url()).host}`); });
  const res = { label, userAgent: userAgent || '(瀏覽器預設)' };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    res.status = resp?.status(); res.finalUrl = page.url();
    const h = resp?.headers() || {}; res.server = h.server || null;
    res.protection = ['cf-ray', 'x-datadome', 'x-akamai-transformed', 'x-iinfo', 'x-sucuri-id', 'x-amzn-waf-action'].filter((k) => h[k] !== undefined).concat(/cloudflare|akamai|incapsula|imperva|datadome|sucuri/i.test(h.server || '') ? [h.server] : []);
    await page.waitForLoadState('load', { timeout: 12000 }).catch(() => {});
    const t0 = Date.now(); let ready = false;
    while (Date.now() - t0 < waitMs) { ready = await page.evaluate(() => !!document.body && (document.body.innerText.trim().length > 80 || document.querySelectorAll('h1,h2,h3,p,a[href],button,nav,main,header').length > 6)).catch(() => false); if (ready) break; await page.waitForTimeout(500); }
    res.contentAppeared = ready; res.waitedMs = Date.now() - t0;
    res.dom = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')]; const txt = (document.body?.innerText || '').trim();
      let gl = null; try { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (g) { const e = g.getExtension('WEBGL_debug_renderer_info'); gl = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl ok'; } } catch {}
      return { title: document.title.slice(0, 80), elements: all.length, textChars: txt.length, sample: txt.slice(0, 120).replace(/\s+/g, ' '), canvases: document.querySelectorAll('canvas').length, iframes: document.querySelectorAll('iframe').length, links: document.querySelectorAll('a[href]').length, buttons: document.querySelectorAll('button,[role=button]').length, shadowHosts: all.filter((e) => e.shadowRoot).length, webgl: gl, webdriver: navigator.webdriver, blockWords: /just a moment|access denied|attention required|captcha|verify you are human|are you a robot|unusual traffic|enable javascript|forbidden/i.test(document.title + ' ' + txt.slice(0, 500)) };
    });
    res.deep = await deepContent(page).catch(() => null); res.network = net.summary(page.url());
    res.cookies = (await ctx.cookies()).map((c) => c.name).filter((n) => /datadome|_abck|incap_ses|cf_clearance|bm_sz|ak_bmsc|__cf_bm|reese84/i.test(n));
    fs.mkdirSync(outDir, { recursive: true }); res.screenshot = path.join(outDir, `${label}.png`); await page.screenshot({ path: res.screenshot });
  } catch (e) { res.error = String(e.message).split('\n')[0].slice(0, 160); }
  res.consoleErrors = errors; res.failedRequests = failed;
  await ctx.close().catch(() => {});
  return res;
}

export function verdict(a, b) {
  const ok = (r) => r && !r.error && r.contentAppeared;
  if (ok(a) && ok(b)) return '兩種身分都讀得到內容。若爬取仍是空的，問題在爬取後的處理，請把 report.md 前 40 行也貼給我。';
  if (!ok(a) && ok(b)) return '用瀏覽器預設身分讀得到、用爬蟲身分讀不到：網站很可能依「識別字串」擋掉不認識的程式。';
  if (ok(a) && !ok(b)) return '爬蟲身分讀得到，瀏覽器預設身分讀不到（少見）。';
  const x = b || a;
  if (x?.error) return '連網址都打不開：' + x.error;
  if (x?.deep && x.deep.textChars > 80 && x.deep.mainTextChars < 40) return '內容在 iframe 或 shadow DOM 裡（主文件幾乎沒有文字）：新版爬取已會把這些算進去。';
  if (x?.network?.blockedLike > 0 || x?.dom?.blockWords || x?.protection?.length || x?.cookies?.length) return '兩種身分都讀不到，且有防護跡象（防機器人服務／驗證頁）。可改試 --headed 親自開視窗，或請網站提供允許名單。';
  if (x?.dom && x.dom.canvases > 0 && x.dom.textChars < 40) return '兩種身分都沒有文字，但有 canvas：很可能是整頁 WebGL 體驗，網頁上本來就沒有可抽取的文字或版面。請改用 3D 擷取與截圖。';
  if (x?.dom && x.dom.webgl == null) return '這個瀏覽器環境沒有 WebGL，3D 頁面畫不出來。可試 --headed。';
  return '原因不明；請把完整輸出和截圖給我。';
}

async function main() {
  const url = findUrl(args);
  if (!url) { console.error('用法：site-explorer diagnose <網址> [--headed]\n  用爬蟲身分與瀏覽器預設身分各打開一次，回報看到什麼（狀態碼、防護跡象、DOM、WebGL、截圖）。'); process.exit(1); }
  const outDir = path.resolve(opt('out', './diagnose-out'));
  const browser = await launchBrowser({ headless: !args.includes('--headed') });
  console.log(`診斷 ${url}（每種身分最多等 15 秒）\n`);
  const a = await probe(browser, url, { label: 'crawler-identity', userAgent: UA, outDir });
  const b = await probe(browser, url, { label: 'browser-default', userAgent: null, outDir });
  await browser.close();
  for (const r of [a, b]) {
    console.log(`── ${r.label}`);
    console.log(`   身分：${r.userAgent}`);
    if (r.error) { console.log(`   ✖ ${r.error}`); continue; }
    console.log(`   HTTP ${r.status}　最終網址：${r.finalUrl}`);
    console.log(`   伺服器：${r.server || '?'}　防護跡象：${[...r.protection, ...r.cookies].join('、') || '無'}`);
    console.log(`   內容出現：${r.contentAppeared ? '是' : '否'}（等了 ${(r.waitedMs / 1000).toFixed(1)} 秒）　標題：「${r.dom.title}」`);
    console.log(`   DOM 元素 ${r.dom.elements}・可見文字 ${r.dom.textChars} 字・連結 ${r.dom.links}・按鈕 ${r.dom.buttons}・canvas ${r.dom.canvases}・iframe ${r.dom.iframes}・shadow root ${r.dom.shadowHosts}`);
    console.log(`   WebGL：${r.dom.webgl || '無'}　webdriver 旗標：${r.dom.webdriver}　疑似驗證頁字樣：${r.dom.blockWords ? '有' : '無'}`);
    if (r.deep) console.log(`   含 shadow DOM／iframe 的可見文字：${r.deep.textChars} 字（iframe ${r.deep.frameCount} 個、shadow root ${r.deep.shadowHosts} 個）`);
    if (r.network) { const n = r.network; console.log(`   網路：請求 ${n.total} 個（${Object.entries(n.byType).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join('、')}）・錯誤回應 ${n.errorCount}（其中 403/429 共 ${n.blockedLike}）・失敗 ${n.failedCount}`);
      if (n.assets3d.length) console.log(`   3D 資源：${n.assets3d.slice(0, 5).map((a) => `${a.url} (${a.status})`).join('；')}`);
      if (n.apis.length) console.log(`   API／JSON：${n.apis.slice(0, 5).map((a) => `${a.url} (${a.status})`).join('；')}`);
      if (n.errors.length) console.log(`   錯誤的請求：${n.errors.slice(0, 5).map((e) => `${e.status} ${e.url}`).join('；')}`);
      if (n.apiTextSamples.length) console.log(`   API 回應裡的文字：${n.apiTextSamples.slice(0, 3).join(' | ').slice(0, 300)}`); }
    if (r.dom.sample) console.log(`   文字開頭：${r.dom.sample}`);
    if (r.consoleErrors.length) console.log(`   主控台錯誤：${r.consoleErrors.join(' | ')}`);
    if (r.failedRequests.length) console.log(`   失敗的請求：${r.failedRequests.join(' | ')}`);
    console.log(`   截圖：${r.screenshot}`);
  }
  console.log(`\n結論：${verdict(a, b)}`);
}
if (isMain(import.meta.url)) await main();
