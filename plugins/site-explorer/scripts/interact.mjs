// Many "experience" sites only reveal their content after a visitor does something: click an "enter" button, scroll, press a key.
// This walks through those states the way a visitor would, records every state that actually changes, and stops when nothing changes.
// It never submits forms, never logs in, never leaves the site, and never clicks anything that looks like buying, deleting or subscribing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deepContent, ariaTree } from './observe.mjs';

const GO = /^(enter|start|begin|explore|discover|continue|next|skip|play|launch|let'?s go|get started|learn more|accept( all)?|ok|got it|agree|i agree|close|dismiss|進入|開始|探索|發現|繼續|下一步|跳過|播放|了解更多|接受|同意|知道了|關閉)\b/i;
const NO = /(buy|purchase|checkout|pay|order|delete|remove|unsubscribe|subscribe|sign ?up|sign ?in|log ?in|log ?out|register|submit|send|download|install|donate|購買|結帳|付款|訂購|刪除|移除|訂閱|註冊|登入|登出|送出|提交|下載|捐款)/i;

async function candidates(page, origin) {
  return page.evaluate((originStr) => {
    const out = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && +cs.opacity > 0.05; };
    const seen = new Set();
    for (const el of document.querySelectorAll('button,[role=button],a[href],[onclick],summary')) {
      if (!vis(el) || el.closest('form') || el.matches('[type=submit],[type=reset]') || el.disabled) continue;
      const label = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!label) continue;
      if (el.tagName === 'A') { const h = (el.getAttribute('href') || '').trim(); if (h && !h.startsWith('#') && !/^javascript:\s*(void\(0\))?;?$/i.test(h)) continue; } // links with a real destination are the crawler's business (robots.txt, queue), never a click
      const r = el.getBoundingClientRect(); const key = label + '|' + Math.round(r.x / 20) + '|' + Math.round(r.y / 20); if (seen.has(key)) continue; seen.add(key);
      el.setAttribute('data-se-i', String(out.length));
      out.push({ i: out.length, label, tag: el.tagName.toLowerCase(), area: Math.round(r.width * r.height), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) });
    }
    return out.slice(0, 40);
  }, origin).catch(() => []);
}

async function signature(page) {
  const d = await deepContent(page).catch(() => null); const aria = await ariaTree(page).catch(() => null);
  const shot = await page.screenshot({ type: 'jpeg', quality: 30, clip: { x: 0, y: 0, width: 640, height: 400 } }).catch(() => Buffer.alloc(0));
  const text = await page.evaluate(() => (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 240)).catch(() => '');
  const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
  return { id: h((aria?.text || '').slice(0, 1500) + '|' + (d?.textChars || 0) + '|' + h(shot)), textChars: d?.textChars || 0, aria, text, url: page.url() };
}

/**
 * @returns {Promise<{states: object[], stoppedBecause: string}>}
 * Each state: { index, action, label, url, textChars, text, ariaHead, screenshot }
 */
export async function exploreStates(page, { outDir, maxSteps = 6, settleMs = 700, budgetMs = 12000, allowed = () => true, log = () => {} } = {}) {
  const t0 = Date.now(); // hard time budget: a page that never settles must not stall the crawl
  fs.mkdirSync(outDir, { recursive: true });
  // a button's script may still navigate: any main-frame navigation to a robots-disallowed or foreign-origin URL is refused before the request leaves
  const startOrigin = new URL(page.url()).origin; let blockedNav = 0;
  const guard = (route) => { const rq = route.request(); if (rq.isNavigationRequest() && rq.frame() === page.mainFrame()) { let ok = false; try { ok = new URL(rq.url()).origin === startOrigin && allowed(rq.url()); } catch {} if (!ok) { blockedNav++; return route.abort('blockedbyclient'); } } return route.fallback(); };
  await page.route('**/*', guard);
  try {
    return await run();
  } finally { await page.unroute('**/*', guard).catch(() => {}); }
  async function run() {
  const origin = new URL(page.url()).origin; const clicked = new Set(); const states = []; let stalls = 0; let stopped = 'maxSteps';
  let cur = await signature(page); const seenIds = new Set([cur.id]);
  const record = async (action, label, sig) => {
    const idx = states.length + 1; const file = path.join(outDir, `state-${idx}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    states.push({ index: idx, action, label: label || '', url: sig.url, textChars: sig.textChars, text: sig.text, ariaHead: (sig.aria?.text || '').split('\n').slice(0, 25).join('\n').slice(0, 2500), screenshot: path.basename(file) });
  };
  await record('初始畫面', '', cur);
  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() - t0 > budgetMs) { stopped = 'timeBudget'; break; }
    let action = null, label = '';
    const cands = (await candidates(page, origin)).filter((c) => !clicked.has(c.label) && !NO.test(c.label));
    const best = cands.filter((c) => GO.test(c.label)).sort((a, b) => b.area - a.area)[0] || (cur.textChars < 40 ? cands.sort((a, b) => b.area - a.area)[0] : null);
    try {
      if (best) { clicked.add(best.label); action = '點擊'; label = best.label; await page.locator(`[data-se-i="${best.i}"]`).first().click({ timeout: 3000 }); }
      else if (stalls === 0) { action = '滾輪向下'; await page.mouse.move(640, 400); await page.mouse.wheel(0, 900); }
      else if (stalls === 1) { action = '按空白鍵'; await page.keyboard.press('Space'); }
      else if (stalls === 2) { action = '按向下鍵'; await page.keyboard.press('ArrowDown'); }
      else if (stalls === 3) { action = '按向右鍵'; await page.keyboard.press('ArrowRight'); }
      else { stopped = 'noMoreActions'; break; }
    } catch { stalls++; continue; }
    await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(settleMs);
    const next = await signature(page);
    if (next.id !== cur.id && !seenIds.has(next.id)) { seenIds.add(next.id); stalls = 0; cur = next; await record(action, label, next); log(`   互動 ${states.length - 1}：${action}${label ? '「' + label + '」' : ''} → 畫面改變`); }
    else { stalls++; if (stalls > 4) { stopped = 'nothingChanges'; break; } }
  }
  fs.writeFileSync(path.join(outDir, 'states.json'), JSON.stringify({ states, stoppedBecause: stopped, blockedNavigations: blockedNav }, null, 2));
  return { states, stoppedBecause: stopped, blockedNavigations: blockedNav };
  }
}
