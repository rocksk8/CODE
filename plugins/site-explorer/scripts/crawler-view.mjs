#!/usr/bin/env node
// "What does a crawler get, compared with what a visitor sees?"   crawler-view.mjs --site <crawl folder> [--pages 8]
// For a few crawled pages: fetch the raw HTML as a plain browser, Googlebot, Bingbot, GPTBot and ClaudeBot (no JavaScript, no cookies) and compare it
//   1. with the rendered page (what the live browser showed)       -> content that only exists after JavaScript runs
//   2. between the identities                                      -> blocked or different answers for some crawlers
//   3. JSON-LD values with the visible text                        -> a price/name in the data that the page does not show
//   4. canonical and hreflang with what those addresses really do  -> broken or non-reciprocal alternates
// Only your own site should be checked this way: the bot names are labels, not the bots' real network addresses, so a firewall that verifies the real bot may answer differently (the report says so).
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';
import { isMain, gfetch, mayFetch, readCappedBuffer, decodeBody, stripMarkup } from './util.mjs';
import { BANNER, clean } from './untrusted.mjs';

export const PROFILES = [
  { id: 'browser', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  { id: 'googlebot', ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  { id: 'bingbot', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
  { id: 'gptbot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot' },
  { id: 'claudebot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' }
];

// ---------------------------------------------------------------- text helpers (pure)
const WORD = /[\p{L}\p{N}]+/gu, CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
/** Lower-case words; runs of CJK characters become overlapping pairs (there are no spaces to split on). */
export function tokens(text) {
  const out = [];
  for (const w of String(text || '').toLowerCase().match(WORD) || []) {
    if (CJK.test(w)) { const cs = [...w]; if (cs.length === 1) out.push(cs[0]); for (let i = 0; i + 1 < cs.length; i++) out.push(cs[i] + cs[i + 1]); }
    else if (w.length > 1 || /\d/.test(w)) out.push(w);
  }
  return out;
}
const setOf = (a) => new Set(a);
/** 0..1: how much of two texts' vocabulary they share. */
export function similarity(a, b) {
  const A = setOf(tokens(a)), B = setOf(tokens(b)); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++; return inter / (A.size + B.size - inter);
}
/** Share (0..1) of the rendered page's distinct words that are not in the raw HTML, plus a few lines that only exist after scripts ran. */
export function jsOnly(rawText, renderedText) {
  const R = setOf(tokens(rawText)); const rt = tokens(renderedText); const uniq = [...new Set(rt)];
  if (uniq.length < 8) return { share: 0, words: uniq.length, examples: [] };
  const missing = uniq.filter((w) => !R.has(w));
  const examples = []; for (const line of String(renderedText).split(/(?<=[.!?。！？])\s+|\n+/)) { const t = tokens(line); if (t.length >= 4 && t.filter((w) => !R.has(w)).length / t.length > 0.8) { examples.push(clean(line, 120)); if (examples.length >= 3) break; } }
  return { share: +(missing.length / uniq.length).toFixed(3), words: uniq.length, examples };
}
export function titleOf(html) { const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html || ''); return m ? clean(m[1].replace(/&amp;/g, '&'), 160) : ''; }
export function h1Of(html) { const m = /<h1[^>]*>([\s\S]{0,600}?)<\/h1>/i.exec(html || ''); return m ? clean(stripMarkup(m[1]), 160) : ''; }

// ---------------------------------------------------------------- JSON-LD facts vs visible text (pure)
export function extractJsonLd(html) {
  const out = []; const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]{0,200000}?)<\/script>/gi; let m;
  while ((m = re.exec(html || '')) && out.length < 20) { try { const j = JSON.parse(m[1]); for (const n of Array.isArray(j) ? j : j && j['@graph'] ? j['@graph'] : [j]) if (n && typeof n === 'object') out.push(n); } catch {} }
  return out;
}
const FACT_PROPS = new Set(['name', 'headline', 'price', 'lowPrice', 'highPrice', 'ratingValue', 'reviewCount', 'ratingCount', 'telephone', 'email']);
/** [{ type, prop, value }] for the few properties readers actually see on the page (name, headline, price, rating …). */
export function jsonLdFacts(nodes) {
  const facts = []; const walk = (n, type, depth) => {
    if (!n || typeof n !== 'object' || depth > 4 || facts.length > 60) return;
    if (Array.isArray(n)) { for (const x of n.slice(0, 20)) walk(x, type, depth + 1); return; }
    const t = [].concat(n['@type'] || type || []).filter((x) => typeof x === 'string')[0] || type || '';
    for (const [k, v] of Object.entries(n)) {
      if (k.startsWith('@')) continue;
      if (FACT_PROPS.has(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) facts.push({ type: t, prop: k, value: String(v).trim().slice(0, 200) });
      else if (v && typeof v === 'object') walk(v, t, depth + 1);
    }
  };
  for (const n of nodes) walk(n, '', 0); return facts;
}
const norm = (s) => String(s).toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[“”"'‘’`]/g, '').trim();
const numbersIn = (text) => { const set = new Set(); for (const m of String(text).matchAll(/\d[\d.,]*\d|\d/g)) { const raw = m[0]; set.add(raw); set.add(raw.replace(/,(?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '')); set.add(raw.replace(/,/g, '.')); } return set; };
/** Facts from the data that the visible text does not contain (numbers are compared as numbers: 1,299.00 matches 1299). */
export function factsMissing(facts, visibleText) {
  const vt = norm(visibleText); const nums = numbersIn(visibleText); const bad = [];
  for (const f of facts) {
    if (/^(price|lowPrice|highPrice|ratingValue|reviewCount|ratingCount)$/.test(f.prop)) {
      const n = Number(String(f.value).replace(/,/g, '')); if (!Number.isFinite(n)) continue;
      const cands = new Set([String(n), n.toFixed(2), n.toFixed(1), String(f.value)]); let ok = false;
      for (const c of cands) if (nums.has(c) || nums.has(c.replace(/\.0+$/, ''))) ok = true;
      if (!ok) for (const x of nums) { const y = Number(x.replace(/,/g, '')); if (Number.isFinite(y) && Math.abs(y - n) < 1e-9) ok = true; }
      if (!ok) bad.push(f);
    } else if (f.value.length >= 3 && !vt.includes(norm(f.value))) bad.push(f);
  }
  return bad;
}

// ---------------------------------------------------------------- fetching
async function getRaw(url, ua, timeout = 15000) {
  try {
    const r = await gfetch(url, { headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' }, signal: AbortSignal.timeout(timeout) });
    const ct = r.headers.get('content-type') || ''; const buf = await readCappedBuffer(r, 3_000_000);
    const html = buf && /html|xml|^$/i.test(ct) ? decodeBody(buf, ct) : '';
    return { status: r.status, finalUrl: r.url || url, contentType: ct.split(';')[0], bytes: buf ? buf.length : 0, html, retryAfter: r.headers.get('retry-after') || null, server: r.headers.get('server') || null };
  } catch (e) { return { status: 0, error: clean(e.message || String(e), 120), finalUrl: url, html: '', bytes: 0 }; }
}

// ---------------------------------------------------------------- analysis
export function compareProfiles(base, other) {
  const bt = stripMarkup(base.html), ot = stripMarkup(other.html);
  return { statusDiff: base.status !== other.status, titleDiff: !!(titleOf(base.html) && titleOf(other.html) && titleOf(base.html) !== titleOf(other.html)), similarity: other.status === 200 && base.status === 200 ? +similarity(bt, ot).toFixed(3) : null, bytesRatio: base.bytes ? +(other.bytes / base.bytes).toFixed(2) : null };
}

export async function analyzePage({ url, renderedHtml }, { profiles = PROFILES, fetchRaw = getRaw, delayMs = 150 } = {}) {
  const raws = {}; for (const p of profiles) { raws[p.id] = await fetchRaw(url, p.ua); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); }
  const base = raws.browser; const rendered = renderedHtml ? stripMarkup(renderedHtml) : null;
  const rawText = stripMarkup(base.html);
  const page = { url: clean(url, 300), profiles: {}, js: null, facts: null, canonical: null };
  for (const p of profiles) { const r = raws[p.id]; const cmp = p.id === 'browser' ? null : compareProfiles(base, r); page.profiles[p.id] = { status: r.status, error: r.error || null, bytes: r.bytes, title: titleOf(r.html), h1: h1Of(r.html), server: r.server ? clean(r.server, 40) : null, ...(cmp || {}) }; }
  if (base.status === 200 && rendered) page.js = jsOnly(rawText, rendered);
  if (base.status === 200 && rendered) { const nodes = extractJsonLd(base.html.length ? base.html : renderedHtml); const facts = jsonLdFacts(nodes); if (facts.length) page.facts = { total: facts.length, missing: factsMissing(facts, rendered).slice(0, 8).map((f) => ({ type: clean(f.type, 40), prop: f.prop, value: clean(f.value, 80) })) }; }
  page._base = { html: base.html }; return page;
}

export function buildIssues(pages, extra = {}) {
  const issues = []; const add = (id, severity, title, o = {}) => issues.push({ id, severity, title, ...o });
  const n = pages.length || 1;
  const jsPages = pages.filter((p) => p.js && p.js.share >= 0.5 && p.js.words >= 30);
  if (jsPages.length) add('crawler-js-only', 'high', _t`${jsPages.length} 頁的大部分文字要執行 JavaScript 才會出現`, { affected: jsPages.length, total: n, why: _t('不執行 JavaScript 的爬蟲（以及多數 AI 爬蟲）在原始回應裡看不到這些內容，搜尋與 AI 引用只會看到空殼。'), fix: _t('改成伺服器端渲染或靜態輸出，至少讓標題、主要文字與連結出現在原始 HTML。'), examples: jsPages.slice(0, 3).map((p) => `${p.url}（${Math.round(p.js.share * 100)}%）`) });
  const partial = pages.filter((p) => p.js && p.js.share >= 0.2 && p.js.share < 0.5 && p.js.words >= 30);
  if (partial.length) add('crawler-js-partial', 'medium', _t`${partial.length} 頁有一部分文字要執行 JavaScript 才會出現`, { affected: partial.length, total: n, why: _t('這部分內容不會被不執行 JavaScript 的爬蟲看到。'), fix: _t('把重要文字放進原始 HTML，其餘互動內容再由腳本補上。'), examples: partial.flatMap((p) => p.js.examples).slice(0, 3) });
  for (const id of ['googlebot', 'bingbot']) {
    const bl = pages.filter((p) => p.profiles[id] && p.profiles[id].status !== 0 && p.profiles.browser.status === 200 && p.profiles[id].status !== 200);
    if (bl.length) add('crawler-blocked-' + id, 'high', _t`${bl.length} 頁對 ${id} 回應的狀態碼和一般瀏覽器不同`, { affected: bl.length, total: n, why: _t('一般瀏覽器拿到頁面，搜尋引擎爬蟲卻被擋或被導走，這些頁面可能不會被收錄。若網站的防火牆會驗證爬蟲的真實來源位址，用名稱假冒的請求被擋是正常的，請在防火牆或搜尋主控台確認。'), fix: _t('檢查 WAF／CDN 的機器人規則，並用搜尋引擎官方的網址檢查工具確認。'), examples: bl.slice(0, 3).map((p) => `${p.url} → ${p.profiles[id].status}`) });
  }
  for (const id of ['gptbot', 'claudebot']) {
    const bl = pages.filter((p) => p.profiles[id] && p.profiles.browser.status === 200 && p.profiles[id].status !== 200 && p.profiles[id].status !== 0);
    if (bl.length) add('crawler-blocked-' + id, 'info', _t`${bl.length} 頁會擋掉 ${id}`, { affected: bl.length, total: n, why: _t('如果這是你的決定（不讓 AI 訓練或引用）就沒問題；如果不是，AI 搜尋就不會引用這些頁面。'), fix: _t('在防火牆或 robots.txt 確認是否為刻意設定。'), examples: bl.slice(0, 3).map((p) => `${p.url} → ${p.profiles[id].status}`) });
  }
  const diff = pages.filter((p) => Object.entries(p.profiles).some(([id, r]) => id !== 'browser' && r.status === 200 && p.profiles.browser.status === 200 && r.similarity != null && r.similarity < 0.6));
  if (diff.length) add('crawler-different-content', 'high', _t`${diff.length} 頁給爬蟲的內容和給瀏覽器的內容差很多`, { affected: diff.length, total: n, why: _t('同一個網址對不同身分回傳明顯不同的文字。若不是刻意的（例如行動版或機器人驗證頁），搜尋引擎可能視為內容偽裝。'), fix: _t('比對兩種身分拿到的 HTML，確認沒有只給爬蟲的文字或隱藏連結。'), examples: diff.slice(0, 3).map((p) => p.url) });
  const titleDiff = pages.filter((p) => Object.entries(p.profiles).some(([id, r]) => id !== 'browser' && r.titleDiff));
  if (titleDiff.length && !diff.length) add('crawler-title-differs', 'medium', _t`${titleDiff.length} 頁的標題在不同身分下不一樣`, { affected: titleDiff.length, total: n, why: _t('搜尋結果顯示的標題可能和訪客看到的不同。'), fix: _t('讓所有身分取得相同的 <title>。'), examples: titleDiff.slice(0, 3).map((p) => p.url) });
  const fm = pages.filter((p) => p.facts && p.facts.missing.length);
  if (fm.length) add('crawler-data-mismatch', 'high', _t`${fm.length} 頁的結構化資料有值沒有出現在畫面上`, { affected: fm.length, total: n, why: _t('結構化資料（價格、名稱、評分）應和使用者看到的一致，否則搜尋引擎可能拒絕顯示豐富結果，嚴重時被視為誤導。'), fix: _t('讓 JSON-LD 的值和頁面上可見的文字一致，或移除不一致的欄位。'), examples: fm.slice(0, 3).map((p) => `${p.url}：${p.facts.missing.slice(0, 2).map((f) => `${f.prop}=${f.value}`).join('、')}`) });
  for (const c of extra.canonical || []) issues.push(c);
  return issues;
}

/** canonical + hreflang: do the addresses they name exist, stay put, and point back? */
export async function checkLinks(page, { fetchRaw = getRaw, maxAlt = 6 } = {}) {
  const html = page._base?.html || ''; const out = [];
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).slice(0, 400);
  const attr = (t, n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(t); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''; };
  let canon = ''; const alts = [];
  for (const t of tags) { const rel = attr(t, 'rel').toLowerCase(); const href = attr(t, 'href'); let abs = ''; try { abs = new URL(href, page.url).href; } catch { continue; } if (/\bcanonical\b/.test(rel) && !canon) canon = abs; if (/\balternate\b/.test(rel) && attr(t, 'hreflang')) alts.push({ lang: clean(attr(t, 'hreflang'), 20), href: abs }); }
  const res = { canonical: null, hreflang: [] };
  if (canon && canon !== page.url) { if (mayFetch(canon, page.url)) { const r = await fetchRaw(canon, PROFILES[0].ua); res.canonical = { url: clean(canon, 300), status: r.status, final: clean(r.finalUrl || canon, 300), moved: !!r.finalUrl && r.finalUrl !== canon }; } }
  for (const a of alts.slice(0, maxAlt)) {
    if (!mayFetch(a.href, page.url)) continue; const r = await fetchRaw(a.href, PROFILES[0].ua);
    const back = r.status === 200 && new RegExp(page.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '') + '/?["\']', 'i').test(r.html);
    res.hreflang.push({ lang: a.lang, url: clean(a.href, 300), status: r.status, reciprocal: a.href === page.url ? true : back });
  }
  return res;
}
export function linkIssues(perPage) {
  const issues = []; const bad = perPage.filter((x) => x.links.canonical && (x.links.canonical.status !== 200 || x.links.canonical.moved));
  if (bad.length) issues.push({ id: 'crawler-canonical-broken', severity: 'high', title: _t`${bad.length} 頁的 canonical 指向打不開或會轉址的網址`, affected: bad.length, why: _t('canonical 要指向一個直接回應 200 的網址，否則搜尋引擎可能忽略它。'), fix: _t('把 canonical 改成最終、可直接開啟的網址。'), examples: bad.slice(0, 3).map((x) => `${x.url} → ${x.links.canonical.url}（${x.links.canonical.status}）`) });
  const alt = perPage.flatMap((x) => x.links.hreflang.filter((h) => h.status !== 200 || !h.reciprocal).map((h) => ({ page: x.url, ...h })));
  if (alt.length) issues.push({ id: 'crawler-hreflang', severity: 'medium', title: _t`${alt.length} 個 hreflang 對應頁打不開，或沒有回指本頁`, affected: alt.length, why: _t('hreflang 必須雙向互相指向，否則搜尋引擎會忽略整組語言版本。'), fix: _t('讓每個語言版本都列出所有版本（包含自己），並確認網址可開啟。'), examples: alt.slice(0, 3).map((h) => `${h.page} ⇄ ${h.url}（${h.status}${h.status === 200 ? '，沒有回指' : ''}）`) });
  return issues;
}

export function renderMd(r) {
  const L = [BANNER, '', _t('# 爬蟲看到的 vs 訪客看到的'), '', _t`檢查了 ${r.pages.length} 頁。身分只是名稱，不是這些爬蟲的真實來源位址；會驗證來源的防火牆可能因此給不同回應。`, ''];
  if (!r.issues.length) L.push(_t('沒有發現差異。'), '');
  for (const i of r.issues) { L.push(`## ${i.severity.toUpperCase()}｜${i.title}`, '', i.why ? `- ${_t('為什麼')}：${i.why}` : '', i.fix ? `- ${_t('怎麼做')}：${i.fix}` : '', ...(i.examples || []).map((e) => `- ${clean(e, 200)}`), ''); }
  L.push(`## ${_t('每頁')}`, '', `| ${_t('網址')} | browser | googlebot | bingbot | gptbot | claudebot | ${_t('只有 JS 才有的文字')} |`, '|---|---|---|---|---|---|---|');
  for (const p of r.pages) { const c = (id) => { const x = p.profiles[id]; if (!x) return '—'; if (x.error) return 'ERR'; return x.similarity != null ? `${x.status} (${Math.round(x.similarity * 100)}%)` : String(x.status); }; L.push(`| ${p.url} | ${c('browser')} | ${c('googlebot')} | ${c('bingbot')} | ${c('gptbot')} | ${c('claudebot')} | ${p.js ? Math.round(p.js.share * 100) + '%' : '—'} |`); }
  return L.join('\n');
}

export async function runCrawlerView(siteDir, { max = 8, fetchRaw = getRaw, delayMs = 150 } = {}) {
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
  const pages = (site.pages || []).filter((p) => p.status === 200 || p.status == null).slice(0, max); const out = [];
  for (const p of pages) {
    let renderedHtml = null; try { renderedHtml = fs.readFileSync(path.join(siteDir, 'pages', p.slug, 'page.html'), 'utf8'); } catch {}
    const a = await analyzePage({ url: p.url, renderedHtml }, { fetchRaw, delayMs }); a.links = await checkLinks(a, { fetchRaw }); delete a._base; out.push(a);
  }
  const issues = [...buildIssues(out), ...linkIssues(out)];
  const result = { checked: out.length, pages: out.map(({ links, ...rest }) => ({ ...rest, links })), issues };
  fs.writeFileSync(path.join(siteDir, 'crawler-view.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(siteDir, 'crawler-view.md'), renderMd(result) + '\n');
  return result;
}

if (isMain(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--site'); const max = arg('--pages') == null ? 8 : Number(arg('--pages'));
  if (!dir || !fs.existsSync(path.join(dir, 'site.json')) || !Number.isInteger(max) || max < 1 || max > 30) { console.error(_t('用法：crawler-view.mjs --site <含 site.json 的資料夾> [--pages 8]')); process.exit(1); }
  const r = await runCrawlerView(path.resolve(dir), { max });
  console.log(_t`已比對 ${r.checked} 頁，發現 ${r.issues.length} 項差異 → crawler-view.md`);
}
