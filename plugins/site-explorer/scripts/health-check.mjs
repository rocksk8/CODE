#!/usr/bin/env node
// Website health check: SEO, crawlability/indexability, links, performance (lab), mobile, security, structured data, AI-crawler readiness.
//   health-check.mjs --site <crawl dir> [--no-link-check] [--max-links 120]
// Reads the crawl output (site.json + pages/*/page.json), makes a small number of polite extra requests
// (robots.txt, sitemaps, link status, a 404 probe), writes health.json + health.md and stores a summary in site.json.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isMain, readCappedBuffer, mayFetch, gfetch } from './util.mjs';
import { fetchRobots, isAllowed, groupFor, AI_BOTS, SEARCH_BOTS } from './robots.mjs';
import { intOpt, normalizeFlags } from './args.mjs';
import { cleanDeep, clean, safe, BANNER, sanitizeDoc } from './untrusted.mjs';
import { validateNodes, hasContextOk } from './structured.mjs';
import { responsiveFindings } from './responsive.mjs';

const UA = 'Mozilla/5.0 (compatible; site-explorer-claude-plugin)';
const SEV = { critical: 40, high: 20, medium: 8, low: 3, info: 0 };
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const CATEGORIES = { indexability: ['索引與爬取', 25], onpage: ['頁面 SEO', 20], links: ['連結', 10], performance: ['效能（實驗室數據）', 15], mobile: ['行動版', 10], security: ['安全與傳輸', 10], structured: ['結構化資料與社群', 5], ai: ['AI 爬蟲友善度', 5] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => h.replace(/^www\./, '');
const isLocal = (host) => /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|\[?::1\]?)$/i.test(host) || !host.includes('.') || /\.(local|localhost|internal|test)$/i.test(host);
const norm = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; } };
const textLen = (s) => [...String(s || '')].reduce((n, ch) => n + (/[㐀-鿿぀-ヿ가-힯]/.test(ch) ? 2 : 1), 0); // CJK glyphs are ~2x wide in SERPs

async function http(url, { method = 'HEAD', redirect = 'manual', timeout = 10000 } = {}) {
  try {
    let r = await gfetch(url, { method, redirect, headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
    if (method === 'HEAD' && [403, 405, 501].includes(r.status)) r = await gfetch(url, { method: 'GET', redirect, headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
    return { status: r.status, location: r.headers.get('location'), headers: Object.fromEntries(r.headers.entries()), url: r.url };
  } catch (e) { return { status: null, error: String(e.cause?.code || e.message).slice(0, 80) }; }
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); await sleep(60); } })); return out; }

function tlsInfo(host, port = 443) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, servername: host, timeout: 8000 }, () => {
      const c = s.getPeerCertificate(); const proto = s.getProtocol(); const idErr = tls.checkServerIdentity(host, c);
      const to = c && c.valid_to ? new Date(c.valid_to) : null;
      resolve({ ok: true, protocol: proto, validTo: to && to.toISOString(), daysLeft: to ? Math.floor((to - Date.now()) / 86400000) : null, issuer: c.issuer && (c.issuer.O || c.issuer.CN), hostnameMatches: !idErr, authorized: s.authorized });
      s.end();
    });
    s.on('error', (e) => resolve({ ok: false, error: String(e.code || e.message).slice(0, 60) })); s.on('timeout', () => { resolve({ ok: false, error: 'timeout' }); s.destroy(); });
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]));
// tolerant of namespace prefixes, attributes, CDATA, any child order (<lastmod> or <image:image> before <loc>)
export function parseSitemap(xml) {
  const blocks = (tag) => { // linear scan: an unclosed tag stops the loop instead of backtracking
    const open = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>`, 'gi'), close = new RegExp(`</(?:[\\w-]+:)?${tag}>`, 'gi'); const out = [];
    for (let m; out.length < 100000 && (m = open.exec(xml));) { close.lastIndex = open.lastIndex; const c = close.exec(xml); if (!c) break; out.push(xml.slice(open.lastIndex, c.index)); open.lastIndex = close.lastIndex; }
    return out;
  };
  const field = (b, name) => { const m = b.match(new RegExp(`<(?!image:|video:|news:|xhtml:)(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?\\s*([\\s\\S]*?)\\s*(?:\\]\\]>)?\\s*</(?:[\\w-]+:)?${name}>`, 'i')); return m ? decodeEntities(m[1].trim()) : null; };
  const rows = (tag) => blocks(tag).map((b) => ({ loc: field(b, 'loc'), lastmod: field(b, 'lastmod') })).filter((r) => r.loc);
  return { sitemaps: rows('sitemap'), urls: rows('url') };
}
// gzip (.xml.gz or Content-Encoding-less gz bodies); output is capped so a zip bomb cannot eat memory
async function fetchSitemapText(url, timeout = 15000) {
  const r = await gfetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) return { status: r.status };
  let buf = await readCappedBuffer(r, 25_000_000); if (!buf) return { status: r.status, error: 'sitemap 超過 25 MB' };
  if (buf.length > 25_000_000) return { status: r.status, error: 'sitemap 超過 25 MB' };
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf, { maxOutputLength: 50_000_000 }); } catch { return { status: r.status, error: 'gzip 解壓失敗或超過 50 MB' }; } }
  return { status: r.status, xml: buf.toString('utf8') };
}

export async function runHealth(siteDir, opts = {}) {
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
  const injection = []; // site text that looks like instructions aimed at an AI
  const pages = site.pages.map((p) => { const f = path.join(siteDir, 'pages', p.slug, 'page.json'); if (!fs.existsSync(f)) return null; const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j.seo) return null; return { slug: p.slug, url: p.url, status: p.status, blocked: p.blocked, /* perf = numbers + resource URLs; URLs only reach the report via add(), which sanitises */ seo: { ...cleanDeep({ ...j.seo, perf: undefined }, `page[${p.slug}].seo`, injection, { max: 400, quarantine: false }), perf: j.seo?.perf }, links: cleanDeep(j.content?.links || [], `page[${p.slug}].links`, injection, { quarantine: false }), title: clean(j.title), responsive: j.responsive || null, pageErrors: cleanDeep(j.pageErrors || [], `page[${p.slug}].errors`, injection, { quarantine: false }) }; }).filter((p) => p && p.seo);
  const origin = new URL(site.finalOrigin || site.startUrl).origin, host = new URL(origin).hostname, https = origin.startsWith('https:');
  const live = pages.filter((p) => !p.status || p.status < 400); // error pages are reported once (status-errors), not scored as content
  const total = live.length || 1;
  const issues = [], passed = [], facts = {};
  const add = (category, severity, id, title, { detail = '', affected = 1, examples = [], impact = '', fix = '', scope = 'site', total: totalOverride } = {}) => issues.push({ id, category, severity, title, detail: safe(detail, 300), affected, total: scope === 'site' ? 1 : (totalOverride ?? total), scope, examples: examples.slice(0, 6).map((e) => safe(e, 300)), impact, fix }); // examples / detail echo site data: sanitise
  const ok = (category, title) => passed.push({ category, title });
  const perPage = (pred) => live.filter(pred);
  const urls = (arr) => arr.map((p) => p.url);

  // ---------------------------------------------------------------- robots.txt
  const robots = await fetchRobots(origin, UA);
  const rp = robots.parsed;
  facts.robots = { status: robots.status, exists: !!rp, sitemaps: rp?.sitemaps || [], issues: rp?.issues || [], bytes: rp?.bytes || 0 };
  if (!rp) add('indexability', 'low', 'robots-missing', robots.status === 404 ? '沒有 robots.txt' : `無法取得 robots.txt（${robots.status ?? robots.error}）`, { impact: '爬蟲沒有明確的抓取指引，也無法在此宣告 sitemap。', fix: '在網站根目錄建立 /robots.txt，至少包含 `User-agent: *` 與 `Sitemap: https://你的網域/sitemap.xml`。' });
  else {
    ok('indexability', 'robots.txt 存在且可解析');
    if (rp.issues.length) add('indexability', 'medium', 'robots-syntax', `robots.txt 有 ${rp.issues.length} 個語法問題`, { examples: rp.issues.map((i) => `第 ${i.line} 行：${i.msg}`), impact: '無法解析的規則會被忽略，可能讓你想擋的路徑被抓取，或想開的路徑被擋。', fix: '修正上列行數；改用標準指令（User-agent / Allow / Disallow / Sitemap）。' });
    const g = isAllowed(rp, 'Googlebot', '/');
    facts.robots.googlebotHome = g;
    if (!g.allowed) add('indexability', 'critical', 'robots-blocks-all', 'robots.txt 擋住了 Googlebot 抓取首頁', { detail: g.rule, impact: '搜尋引擎無法抓取網站，會逐漸從索引消失。', fix: '移除 `Disallow: /`（或對應規則）。若是測試環境請確認上線前已改回。' });
    else ok('indexability', 'Googlebot 可抓取首頁');
    const blockedPages = pages.filter((p) => { const u = new URL(p.url); return !isAllowed(rp, 'Googlebot', u.pathname + u.search).allowed; });
    if (blockedPages.length) add('indexability', 'high', 'robots-blocks-pages', `${blockedPages.length} 個已抓到的頁面被 robots.txt 對 Googlebot 擋住`, { affected: blockedPages.length, scope: 'page', examples: urls(blockedPages), impact: '被擋的頁面不會被抓取內容；若有外部連結仍可能以「無描述」形式出現在結果中。', fix: '確認是否刻意；若要從搜尋結果移除，應使用 noindex（且不可同時被 robots 擋住）。' });
    const res = [...new Set(pages.flatMap((p) => [...(p.seo.perf?.largest || []).map((l) => l.url)]).concat((site.designer?.fonts?.faces || []).map((f) => f.src)).filter((u) => u && /^https?:/.test(u) && new URL(u).origin === origin))];
    const blockedRes = res.filter((u) => { const x = new URL(u); return !isAllowed(rp, 'Googlebot', x.pathname + x.search).allowed; });
    if (blockedRes.length) add('indexability', 'high', 'robots-blocks-resources', `robots.txt 擋住了 ${blockedRes.length} 個頁面資源（CSS／JS／圖片）`, { affected: blockedRes.length, examples: blockedRes, impact: 'Google 需要載入 CSS／JS 才能正確渲染與判斷行動版友善度。', fix: '放行 /wp-content/、/assets/、/static/ 等資源路徑。' });
    const gr = groupFor(rp, 'Googlebot'); if (gr?.crawlDelay && gr.crawlDelay > 10) add('indexability', 'low', 'robots-crawl-delay', `Crawl-delay 設為 ${gr.crawlDelay} 秒`, { impact: 'Google 忽略此指令，但 Bing 等會照做，可能大幅拖慢收錄。', fix: '除非伺服器真的承受不住，否則移除。' });
    facts.robots.aiBots = AI_BOTS.map(([bot, who]) => ({ bot, who, ...isAllowed(rp, bot, '/') }));
    facts.robots.searchBots = SEARCH_BOTS.map(([bot, who]) => ({ bot, who, ...isAllowed(rp, bot, '/') }));
  }
  if (!rp) { facts.robots.aiBots = AI_BOTS.map(([bot, who]) => ({ bot, who, allowed: true, rule: null })); facts.robots.searchBots = SEARCH_BOTS.map(([bot, who]) => ({ bot, who, allowed: true, rule: null })); }

  // ---------------------------------------------------------------- sitemap
  const candidates = [...new Set([...(rp?.sitemaps || []), origin + '/sitemap.xml', origin + '/sitemap_index.xml'])].slice(0, 6);
  const sm = { found: [], urls: [], children: [], errors: [] };
  const MAX_CHILDREN = 20;
  for (const c of candidates) {
    if (!mayFetch(c, origin)) continue;
    try {
      const got = await fetchSitemapText(c);
      if (got.error) { sm.errors.push(`${c}：${got.error}`); continue; }
      if (!got.xml) { sm.errors.push(`${c} → ${got.status}`); continue; }
      if (!/<(?:[\w-]+:)?(urlset|sitemapindex)/i.test(got.xml)) { sm.errors.push(`${c} 不是有效的 sitemap XML`); continue; }
      sm.found.push(c);
      const parsed = parseSitemap(got.xml); sm.urls.push(...parsed.urls);
      sm.childrenTotal = (sm.childrenTotal || 0) + parsed.sitemaps.length;
      for (const child of parsed.sitemaps.slice(0, MAX_CHILDREN)) {
        try { if (!mayFetch(child.loc, origin)) continue; const cg = await fetchSitemapText(child.loc); if (cg.xml) { sm.children.push(child.loc); sm.urls.push(...parseSitemap(cg.xml).urls); } else sm.errors.push(`${child.loc} → ${cg.error || cg.status}`); } catch { sm.errors.push(`${child.loc} 無法取得`); }
      }
      if (parsed.sitemaps.length > MAX_CHILDREN) sm.errors.push(`sitemap index 有 ${parsed.sitemaps.length} 個子 sitemap，只讀了前 ${MAX_CHILDREN} 個（網址數與「不在 sitemap」的判斷僅供參考）`);
      if (sm.urls.length) break;
    } catch (e) { sm.errors.push(`${c} 無法連線`); }
  }
  const smUrls = [...new Map(sm.urls.map((u) => [norm(u.loc), u])).values()].slice(0, 5000);
  facts.sitemap = { found: sm.found, children: sm.children, childrenTotal: sm.childrenTotal || 0, urlCount: smUrls.length, withLastmod: smUrls.filter((u) => u.lastmod).length, errors: sm.errors };
  if (!sm.found.length) add('indexability', 'medium', 'sitemap-missing', '找不到 sitemap.xml', { examples: sm.errors, impact: '搜尋引擎較難發現深層或新頁面，收錄速度變慢。', fix: '產生 sitemap.xml，並在 robots.txt 加上 `Sitemap:` 行，同時提交到 Google Search Console 與 Bing Webmaster。' });
  else if (!smUrls.length) add('indexability', 'medium', 'sitemap-empty', 'sitemap 存在，但解析不到任何網址', { examples: [...sm.found, ...sm.errors], impact: '搜尋引擎拿不到你想被收錄的網址清單。', fix: '確認 sitemap 格式（<urlset><url><loc>…）；若是壓縮檔或 index，確認子 sitemap 可存取且內容不是空的。' });
  else {
    ok('indexability', `sitemap 存在（${smUrls.length} 筆網址）`);
    if (rp && !rp.sitemaps.length) add('indexability', 'low', 'sitemap-not-in-robots', 'robots.txt 沒有宣告 Sitemap', { impact: '少了一個讓所有爬蟲都能發現 sitemap 的管道。', fix: '在 robots.txt 加入 `Sitemap: ' + sm.found[0] + '`。' });
    const crossHost = smUrls.filter((u) => { try { return strip(new URL(u.loc).hostname) !== strip(host); } catch { return false; } });
    if (crossHost.length) add('indexability', 'high', 'sitemap-cross-host', `sitemap 內有 ${crossHost.length} 個不同網域的網址`, { affected: crossHost.length, examples: crossHost.map((u) => u.loc), impact: 'sitemap 只能列出同一網域（含協定與 www 版本一致）的網址，其他會被忽略。', fix: '移除或改為正確網域。' });
    const wrongProto = smUrls.filter((u) => https && u.loc.startsWith('http:'));
    if (wrongProto.length) add('indexability', 'medium', 'sitemap-http', `網站是 HTTPS，但 sitemap 內有 ${wrongProto.length} 個 http:// 網址`, { affected: wrongProto.length, examples: wrongProto.map((u) => u.loc), fix: '全部改為 https。' });
    if (smUrls.length && !facts.sitemap.withLastmod) add('indexability', 'low', 'sitemap-lastmod', 'sitemap 沒有 lastmod', { impact: '爬蟲無法判斷哪些頁面最近更新。', fix: '加入準確的 <lastmod>（只有真的更新才變動）。' });
    const inMap = new Set(smUrls.map((u) => norm(u.loc)));
    const idx = (p) => !/noindex/i.test(p.seo.robotsMeta || '') && !/noindex/i.test(p.seo.http?.headers?.['x-robots-tag'] || '');
    const notInMap = perPage((p) => p.status === 200 && idx(p) && !inMap.has(norm(p.url)) && !inMap.has(norm(p.seo.canonical || '')));
    if (smUrls.length && notInMap.length) add('indexability', 'low', 'sitemap-missing-pages', `${notInMap.length} 個可索引頁面不在 sitemap 中`, { affected: notInMap.length, scope: 'page', examples: urls(notInMap), fix: '確認 sitemap 是否自動涵蓋所有應被收錄的頁面。' });
    const noindexInMap = perPage((p) => !idx(p) && inMap.has(norm(p.url)));
    if (noindexInMap.length) add('indexability', 'high', 'sitemap-noindex', `${noindexInMap.length} 個 noindex 頁面卻列在 sitemap 中`, { affected: noindexInMap.length, scope: 'page', examples: urls(noindexInMap), impact: '給搜尋引擎矛盾的訊號（要我收錄 vs 不要收錄）。', fix: '把 noindex 頁面從 sitemap 移除，或拿掉 noindex。' });
    const sample = smUrls.filter((u) => { try { return new URL(u.loc).origin === origin; } catch { return false; } }).slice(0, 25);
    const crawled = new Map(pages.map((p) => [norm(p.url), p.status]));
    const res = await pool(sample, 4, async (u) => crawled.has(norm(u.loc)) ? { url: u.loc, status: crawled.get(norm(u.loc)) } : { url: u.loc, ...(await http(u.loc)) });
    const bad = res.filter((r) => r.status && (r.status >= 400 || (r.status >= 300 && r.status < 400)));
    facts.sitemap.sampleChecked = res.length; facts.sitemap.sampleBad = bad.map((b) => `${b.status} ${b.url}`);
    if (bad.length) add('indexability', bad.some((b) => b.status >= 400) ? 'high' : 'medium', 'sitemap-bad-urls', `sitemap 抽樣 ${res.length} 筆中有 ${bad.length} 筆不是 200`, { affected: bad.length, examples: bad.map((b) => `${b.status} ${b.url}`), impact: 'sitemap 應只包含最終、可索引、回應 200 的網址；否則浪費抓取預算並降低 sitemap 可信度。', fix: '移除 404／重新導向的網址，改列最終網址。' });
    else if (res.length) ok('indexability', `sitemap 抽樣 ${res.length} 筆皆回應 200`);
  }

  // ---------------------------------------------------------------- per-page indexability
  const nonOk = pages.filter((p) => p.status && p.status >= 400);
  if (nonOk.length) add('indexability', 'high', 'status-errors', `${nonOk.length} 個頁面回應 4xx／5xx`, { affected: nonOk.length, total: pages.length, scope: 'page', examples: nonOk.map((p) => `${p.status} ${p.url}`), fix: '修復頁面或移除指向它的連結／sitemap 項目。' });
  if (!live.length && pages.length) add('indexability', 'critical', 'no-live-pages', '爬到的頁面全部是錯誤頁（4xx／5xx），沒有任何可索引內容', { affected: pages.length, total: pages.length, scope: 'page', examples: pages.map((p) => `${p.status} ${p.url}`), impact: '搜尋引擎與使用者看到的是一個壞掉的網站；其他檢查沒有可分析的內容。', fix: '先讓起始網址回應 200。' });
  const noindexed = perPage((p) => /noindex/i.test(p.seo.robotsMeta || '') || /noindex/i.test(p.seo.http?.headers?.['x-robots-tag'] || ''));
  if (noindexed.length) add('indexability', noindexed.length === total ? 'critical' : 'medium', 'noindex', `${noindexed.length} 個頁面標示 noindex（不會被收錄）`, { affected: noindexed.length, scope: 'page', examples: noindexed.map((p) => `${p.url}（${p.seo.robotsMeta || p.seo.http.headers['x-robots-tag']}）`), impact: noindexed.length === total ? '全站不會出現在搜尋結果。' : '這些頁面不會出現在搜尋結果。', fix: '若非刻意，移除 meta robots／X-Robots-Tag 中的 noindex。' });
  const nofollow = perPage((p) => /nofollow/i.test(p.seo.robotsMeta || ''));
  if (nofollow.length) add('indexability', 'medium', 'nofollow-page', `${nofollow.length} 個頁面的 meta robots 含 nofollow`, { affected: nofollow.length, scope: 'page', examples: urls(nofollow), impact: '頁面上的所有連結都不傳遞權重，也不被爬蟲跟隨。', fix: '除非刻意，否則移除。' });
  const noCanon = perPage((p) => !p.seo.canonical && p.status === 200);
  if (noCanon.length) add('indexability', noCanon.length === total ? 'medium' : 'low', 'canonical-missing', `${noCanon.length} 個頁面沒有 canonical`, { affected: noCanon.length, scope: 'page', examples: urls(noCanon), impact: '網址帶參數、大小寫、結尾斜線等變體可能被視為重複內容。', fix: '每頁加上指向自己最終網址的 <link rel="canonical">。' });
  const canonElsewhere = perPage((p) => p.seo.canonical && norm(p.seo.canonical) !== norm(p.seo.http?.finalUrl || p.url) && norm(p.seo.canonical) !== norm(p.url));
  if (canonElsewhere.length) add('indexability', 'medium', 'canonical-other', `${canonElsewhere.length} 個頁面的 canonical 指向別的網址`, { affected: canonElsewhere.length, scope: 'page', examples: canonElsewhere.map((p) => `${p.url} → ${p.seo.canonical}`), impact: '這些頁面不會被獨立收錄（權重轉給 canonical 目標）。', fix: '確認是否刻意；分頁／篩選頁通常要自我指向或指向主頁。' });
  const canonCross = perPage((p) => { try { return p.seo.canonical && strip(new URL(p.seo.canonical).hostname) !== strip(host); } catch { return false; } });
  if (canonCross.length) add('indexability', 'high', 'canonical-cross-host', `${canonCross.length} 個頁面的 canonical 指向其他網域`, { affected: canonCross.length, scope: 'page', examples: canonCross.map((p) => `${p.url} → ${p.seo.canonical}`), impact: '整頁權重與收錄資格轉移到別的網域。', fix: '改成本站網址（若是刻意的跨站轉載則忽略）。' });
  // every redirect we saw (pages that were deduplicated by final URL are only known through site.redirects)
  const redirs = (site.redirects || []).map((r) => ({ url: r.from, final: r.to, hops: r.hops || [], chainStatuses: (r.hops || []).map((h) => h.status) }));
  const chains = redirs.filter((r) => r.hops.length >= 2);
  if (chains.length) add('indexability', 'medium', 'redirect-chain', `${chains.length} 個網址經過 2 次以上重新導向`, { affected: chains.length, examples: chains.map((r) => `${r.hops.map((h) => h.status + ' ' + h.url).join(' → ')} → ${r.final}`), impact: '每多一跳都延遲載入並稀釋權重，爬蟲通常只跟隨約 5 跳。', fix: '讓舊網址一步直接導向最終網址。' });
  const temp = redirs.filter((r) => r.hops.some((h) => [302, 307].includes(h.status)));
  if (temp.length) add('indexability', 'low', 'redirect-temporary', `${temp.length} 個網址使用暫時性重新導向（302／307）`, { affected: temp.length, examples: temp.map((r) => `${r.url} → ${r.final}`), impact: '搜尋引擎可能保留舊網址在索引中，且不完整傳遞權重。', fix: '永久搬移請用 301／308。' });
  const crossRedirect = redirs.filter((r) => { try { return strip(new URL(r.final).hostname) !== strip(host); } catch { return false; } });
  if (crossRedirect.length) add('indexability', 'low', 'redirect-offsite', `${crossRedirect.length} 個內部網址導向其他網域`, { affected: crossRedirect.length, examples: crossRedirect.map((r) => `${r.url} → ${r.final}`), fix: '確認是否刻意（例如品牌網域遷移）。' });

  // rendering gap: what a non-JS crawler sees
  const gap = perPage((p) => p.seo.raw && !p.seo.raw.error && p.status === 200 && p.seo.words >= 80 && p.seo.raw.words < p.seo.words * 0.35);
  if (gap.length) add('indexability', gap.length === total ? 'high' : 'medium', 'js-dependent', `${gap.length} 個頁面的主要內容要執行 JavaScript 才看得到`, { affected: gap.length, scope: 'page', examples: gap.map((p) => `${p.url}：原始 HTML ${p.seo.raw.words} 字 vs 渲染後 ${p.seo.words} 字${p.seo.raw.csrShell ? '（空殼 #root／#app）' : ''}`), impact: 'Google 會渲染 JS 但延遲且有預算限制；多數 AI 爬蟲與社群預覽爬蟲完全不執行 JS，只會看到空殼。', fix: '改用伺服器端渲染（SSR）、靜態生成（SSG）或預先渲染；至少讓標題、h1、主要文字、canonical 出現在原始 HTML。' });
  // nothing to read EITHER way: not "fine without JavaScript" but "no text for any crawler" (full-page canvas/WebGL, or a script that never rendered)
  const noText = perPage((p) => p.status === 200 && p.seo.raw && !p.seo.raw.error && p.seo.raw.words < 20 && p.seo.words < 20 && !/(login|signin|cart|checkout|404)/i.test(p.url));
  if (noText.length) add('indexability', noText.length === total ? 'high' : 'medium', 'no-text-anywhere', `${noText.length} 個頁面在原始 HTML 與渲染後都幾乎沒有文字`, { affected: noText.length, scope: 'page', examples: noText.map((p) => `${p.url}：原始 ${p.seo.raw.words} 字、渲染後 ${p.seo.words} 字`), impact: '搜尋引擎與 AI 爬蟲都讀不到這些頁面的內容，等於沒有可被索引的文字。常見原因：整頁由 WebGL／canvas 繪製，或腳本在爬蟲環境沒有執行成功。', fix: '為每個這類頁面提供可被讀取的文字替代：標題（h1）、簡介段落、影像／3D 的文字說明（alt、aria-label），或伺服器端預先渲染的 HTML。' });
  else if (pages.some((p) => p.seo.raw && !p.seo.raw.error && p.seo.raw.words >= 20)) ok('indexability', '主要內容在原始 HTML 中即可讀取（不需執行 JavaScript）');
  const rawMissing = perPage((p) => p.seo.raw && !p.seo.raw.error && ((p.seo.title && !p.seo.raw.title) || (p.seo.h1Count && !p.seo.raw.h1Count) || (p.seo.canonical && !p.seo.raw.canonical)));
  if (rawMissing.length && !gap.length) add('indexability', 'medium', 'head-js-only', `${rawMissing.length} 個頁面的 title／h1／canonical 只在 JS 執行後才出現`, { affected: rawMissing.length, scope: 'page', examples: urls(rawMissing), fix: '把這些標籤放進伺服器回傳的 HTML。' });

  // soft 404 + host/protocol canonicalisation
  const probe = await http(origin + '/__se-404-probe-' + Math.random().toString(36).slice(2, 8), { method: 'GET', redirect: 'follow' });
  facts.soft404 = { status: probe.status };
  facts.unreachable = robots.status == null && probe.status == null;
  const fresh = Date.now() - Date.parse(site.crawledAt || 0) < 15 * 60 * 1000; // a crawl from minutes ago; old crawl data says nothing about whether the site is up NOW
  const browserOk = fresh && pages.some((p) => p.status === 200); // the browser crawl just got pages: only this script's own requests failed (proxy / VPN / corporate network)
  if (facts.unreachable && browserOk) add('indexability', 'info', 'extra-checks-blocked', '健檢額外的網路請求（robots.txt、sitemap、連結狀態、轉址）連不上，這些檢查已略過', { detail: String(robots.error || probe.error || ''), impact: '瀏覽器能開啟網站，但健檢程式自己的連線被擋（常見於公司網路、VPN 或 Proxy）。所以這份報告沒有包含 robots／sitemap／連結狀態的結果。', fix: '在能直接連網的環境重跑；或設定環境變數 SITE_EXPLORER_PROXY。' });
  else if (facts.unreachable) add('indexability', 'critical', 'site-unreachable', '健檢時網站完全連不上（robots.txt 與測試網址都沒有回應）', { detail: String(robots.error || probe.error || ''), impact: '沒有回應就無法驗證 robots、sitemap、連結與狀態碼；這次的分數不可信，請不要拿它和上一次比較。', fix: '確認網站是否在線上、網路是否通，之後重新執行。' });
  if (probe.status === 200) add('indexability', 'high', 'soft-404', '不存在的網址回應 200（soft 404）', { examples: [probe.url], impact: '搜尋引擎會把大量無內容頁面當成真實頁面收錄，浪費抓取預算並拉低品質評價。', fix: '不存在的頁面必須回傳 404 或 410 狀態碼（即使畫面顯示「找不到頁面」）。' });
  else if (probe.status === 404 || probe.status === 410) ok('indexability', '不存在的網址正確回應 404／410');
  if (!isLocal(host)) {
    const variants = [...new Set([`http://${strip(host)}/`, `http://www.${strip(host)}/`, `https://${strip(host)}/`, `https://www.${strip(host)}/`])];
    const vr = await pool(variants, 2, async (v) => { const r = await http(v, { method: 'GET', redirect: 'follow' }); return { variant: v, status: r.status, final: r.url, error: r.error }; });
    facts.variants = vr;
    const finals = new Set(vr.filter((v) => v.status === 200).map((v) => v.final.replace(/\/$/, '')));
    if (finals.size > 1) add('indexability', 'high', 'host-variants', 'http／https、www／非 www 沒有統一導向同一個網址', { examples: vr.map((v) => `${v.variant} → ${v.status} ${v.final || v.error}`), impact: '同一內容有多個可存取版本，權重被分散，且容易被判定為重複內容。', fix: '選定一個標準網址（建議 https + 單一 www 形式），其他全部 301 導向它。' });
    else if (finals.size === 1) ok('indexability', 'http／https、www／非 www 都導向同一個網址');
  }

  // ---------------------------------------------------------------- on-page
  const dupe = (get) => { const m = new Map(); for (const p of live) { const v = (get(p) || '').trim().toLowerCase(); if (v) (m.get(v) || m.set(v, []).get(v)).push(p); } return [...m.values()].filter((a) => a.length > 1); };
  const noTitle = perPage((p) => !p.seo.title.trim()); if (noTitle.length) add('onpage', 'high', 'title-missing', `${noTitle.length} 個頁面沒有 <title>`, { affected: noTitle.length, scope: 'page', examples: urls(noTitle), impact: '標題是最重要的排名與點擊因素，缺少時搜尋引擎會自行拼湊。', fix: '為每頁撰寫獨特、描述該頁內容的標題。' });
  const tShort = perPage((p) => p.seo.title.trim() && textLen(p.seo.title) < 20), tLong = perPage((p) => textLen(p.seo.title) > 60);
  if (tLong.length) add('onpage', 'low', 'title-long', `${tLong.length} 個頁面標題過長（> 60 字元寬）`, { affected: tLong.length, scope: 'page', examples: tLong.map((p) => `${textLen(p.seo.title)}：${p.seo.title.slice(0, 70)}`), impact: '在搜尋結果中會被截斷。', fix: '把關鍵資訊放前面，控制在約 50–60 字元寬（中日韓字元算 2）。' });
  if (tShort.length) add('onpage', 'low', 'title-short', `${tShort.length} 個頁面標題過短（< 20）`, { affected: tShort.length, scope: 'page', examples: tShort.map((p) => `${p.seo.title}`), fix: '加入主要關鍵字與品牌，描述頁面實際內容。' });
  const dt = dupe((p) => p.seo.title); if (dt.length) add('onpage', 'medium', 'title-duplicate', `${dt.length} 組頁面共用相同標題`, { affected: dt.flat().length, scope: 'page', examples: dt.map((g) => `「${g[0].seo.title.slice(0, 40)}」：${g.map((p) => p.url).join('、')}`), impact: '搜尋引擎難以分辨哪頁該排名。', fix: '每頁標題獨特。' });
  const noDesc = perPage((p) => !(p.seo.description || '').trim() && p.status === 200); if (noDesc.length) add('onpage', 'medium', 'description-missing', `${noDesc.length} 個頁面沒有 meta description`, { affected: noDesc.length, scope: 'page', examples: urls(noDesc), impact: '搜尋結果的摘要由搜尋引擎隨機擷取，點擊率通常較低。', fix: '撰寫 70–160 字元、含行動呼籲的獨特描述。' });
  const dLen = perPage((p) => p.seo.description && (textLen(p.seo.description) < 70 || textLen(p.seo.description) > 160)); if (dLen.length) add('onpage', 'low', 'description-length', `${dLen.length} 個頁面的 description 長度不理想（建議 70–160）`, { affected: dLen.length, scope: 'page', examples: dLen.map((p) => `${textLen(p.seo.description)}：${p.url}`), fix: '調整到 70–160 字元寬。' });
  const dd = dupe((p) => p.seo.description); if (dd.length) add('onpage', 'low', 'description-duplicate', `${dd.length} 組頁面共用相同 description`, { affected: dd.flat().length, scope: 'page', examples: dd.map((g) => g.map((p) => p.url).join('、')), fix: '每頁獨特。' });
  const noH1 = perPage((p) => p.seo.h1Count === 0 && p.status === 200); if (noH1.length) add('onpage', 'medium', 'h1-missing', `${noH1.length} 個頁面沒有 h1`, { affected: noH1.length, scope: 'page', examples: urls(noH1), impact: 'h1 是頁面主題的最強結構訊號，也是螢幕閱讀器的導覽點。', fix: '每頁一個描述主題的 h1。' });
  const multiH1 = perPage((p) => p.seo.h1Count > 1); if (multiH1.length) add('onpage', 'low', 'h1-multiple', `${multiH1.length} 個頁面有多個 h1`, { affected: multiH1.length, scope: 'page', examples: multiH1.map((p) => `${p.seo.h1Count} 個：${p.url}`), fix: '保留一個主 h1，其餘降為 h2。' });
  const skips = perPage((p) => p.seo.headingSkips > 0); if (skips.length) add('onpage', 'low', 'heading-skips', `${skips.length} 個頁面標題層級跳級（如 h2 直接到 h4）`, { affected: skips.length, scope: 'page', examples: urls(skips), fix: '標題依序遞進，不要為了樣式而跳級。' });
  const thin = perPage((p) => p.status === 200 && p.seo.words < 150 && !/(login|signin|cart|checkout|404)/i.test(p.url)); if (thin.length) add('onpage', 'medium', 'thin-content', `${thin.length} 個頁面文字內容偏少（< 150 字）`, { affected: thin.length, scope: 'page', examples: thin.map((p) => `${p.seo.words} 字：${p.url}`), impact: '內容稀薄的頁面較難排名，大量出現會拉低整站品質評價。', fix: '補充實質內容，或合併、noindex 價值低的頁面。' });
  const noLang = perPage((p) => !p.seo.lang); if (noLang.length) add('onpage', 'medium', 'lang-missing', `${noLang.length} 個頁面的 <html> 沒有 lang`, { affected: noLang.length, scope: 'page', examples: urls(noLang), impact: '影響語言判斷、翻譯提示與螢幕閱讀器發音。', fix: '例如 <html lang="zh-Hant-TW">。' });
  const dec = (t) => { try { return decodeURIComponent(t); } catch { return t; } };
  const badUrl = perPage((p) => { const u = new URL(p.url), path_ = dec(u.pathname); return dec(p.url).length > 115 || /[A-Z]/.test(path_) || /_/.test(path_) || [...u.searchParams].length > 3; }); // judge the decoded path: %E7%94%A2 is not "uppercase" if (badUrl.length) add('onpage', 'low', 'url-hygiene', `${badUrl.length} 個網址不夠乾淨（過長、含大寫、底線或過多參數）`, { affected: badUrl.length, scope: 'page', examples: urls(badUrl), fix: '使用小寫、連字號、簡短且有意義的路徑。' });
  const missAlt = live.reduce((n, p) => n + p.seo.images.missingAlt, 0), imgTotal = live.reduce((n, p) => n + p.seo.images.total, 0);
  if (missAlt) add('onpage', missAlt / Math.max(1, imgTotal) > 0.3 ? 'medium' : 'low', 'img-alt', `${missAlt} / ${imgTotal} 張圖片缺少 alt 屬性`, { affected: perPage((p) => p.seo.images.missingAlt).length, scope: 'page', examples: live.flatMap((p) => p.seo.images.sampleMissingAlt), impact: '影響圖片搜尋與無障礙；缺 alt 的圖片螢幕閱讀器會朗讀檔名。', fix: '為有意義的圖片寫描述性 alt；純裝飾圖片用 alt=""。' });
  else if (imgTotal) ok('onpage', '所有圖片都有 alt 屬性');
  const heavyImg = perPage((p) => p.seo.images.oversized > 0); if (heavyImg.length) add('performance', 'medium', 'img-oversized', `${heavyImg.length} 個頁面載入遠大於顯示尺寸的圖片`, { affected: heavyImg.length, scope: 'page', examples: heavyImg.flatMap((p) => p.seo.images.sampleOversized), impact: '浪費頻寬，拖慢 LCP，行動網路尤其明顯。', fix: '依顯示尺寸提供 srcset／sizes；使用 WebP／AVIF。' });
  const legacy = live.reduce((n, p) => n + p.seo.images.legacyFormat, 0); if (imgTotal && legacy / imgTotal > 0.6 && imgTotal > 4) add('performance', 'low', 'img-format', `${legacy} / ${imgTotal} 張圖片仍是 JPEG／PNG／GIF`, { fix: '改用 WebP 或 AVIF，通常可省 25–50%。' });

  const brokenImg = perPage((p) => (p.seo.images.broken || 0) > 0); if (brokenImg.length) add('onpage', 'high', 'img-broken', `${brokenImg.length} 個頁面有載入失敗的圖片`, { affected: brokenImg.length, scope: 'page', examples: brokenImg.flatMap((p) => p.seo.images.sampleBroken), impact: '訪客會看到破圖；對檢驗／驗收來說這是明確的瑕疵。', fix: '修正圖片網址或補上遺失的檔案。' });
  const jsErr = perPage((p) => (p.pageErrors || []).length > 0); if (jsErr.length) add('onpage', 'medium', 'page-errors', `${jsErr.length} 個頁面載入時有 JavaScript／主控台錯誤`, { affected: jsErr.length, scope: 'page', examples: jsErr.map((p) => `${p.url}：${p.pageErrors[0]}`), impact: '腳本錯誤常代表功能壞掉（選單、表單、動畫），也可能讓內容無法顯示。', fix: '開啟瀏覽器開發者工具的 Console 逐一修正；第三方腳本錯誤可評估移除。' });

  // ---------------------------------------------------------------- links
  const incoming = new Map(pages.map((p) => [norm(p.url), 0]));
  const allInternal = new Map();
  for (const p of pages) for (const l of p.links) {
    let u; try { u = new URL(l.href); } catch { continue; } if (!/^https?:/.test(u.protocol)) continue;
    const n = norm(u.href), internal = strip(u.hostname) === strip(host);
    if (internal) { if (incoming.has(n) && n !== norm(p.url)) incoming.set(n, incoming.get(n) + 1); const e = allInternal.get(n) || { url: u.href, from: [], area: l.area }; if (e.from.length < 3) e.from.push(p.url); allInternal.set(n, e); }
  }
  const orphans = pages.filter((p, i) => i > 0 && incoming.get(norm(p.url)) === 0); if (orphans.length) add('links', 'medium', 'orphan', `${orphans.length} 個頁面沒有任何內部連結指向（孤兒頁）`, { affected: orphans.length, scope: 'page', examples: urls(orphans), impact: '爬蟲只能靠 sitemap 發現，權重傳遞也被切斷。', fix: '從相關頁面或導覽加入內部連結。' });
  const gen = live.reduce((n, p) => n + p.seo.links.generic, 0), emp = live.reduce((n, p) => n + p.seo.links.empty, 0);
  if (gen) add('links', 'low', 'anchor-generic', `${gen} 個連結使用「點這裡／read more」之類的泛用文字`, { examples: live.flatMap((p) => p.seo.links.sampleGeneric), impact: '錨文字是搜尋引擎理解目標頁面的重要線索，也影響螢幕閱讀器使用者。', fix: '改成描述目標內容的文字。' });
  if (emp) add('links', 'medium', 'anchor-empty', `${emp} 個連結沒有任何可讀文字（無文字、無 aria-label、圖片也無 alt）`, { examples: live.flatMap((p) => p.seo.links.sampleEmpty), impact: '爬蟲與螢幕閱讀器都無法得知連結用途。', fix: '加入文字、aria-label 或圖片 alt。' });
  const blank = live.reduce((n, p) => n + p.seo.links.externalNoRel, 0); if (blank) add('links', 'low', 'blank-noopener', `${blank} 個 target=_blank 外部連結缺少 rel="noopener"`, { fix: '加上 rel="noopener noreferrer"（新版瀏覽器預設已處理，但舊版仍有風險）。' });

  let linkChecks = null;
  if (!opts.noLinkCheck) {
    const maxLinks = opts.maxLinks ?? 120;
    const crawledStatus = new Map(pages.map((p) => [norm(p.url), p.status]));
    const internalList = [...allInternal.values()].filter((e) => !crawledStatus.has(norm(e.url))).filter((e) => !rp || isAllowed(rp, UA, new URL(e.url).pathname + new URL(e.url).search).allowed).slice(0, maxLinks);
    const checked = await pool(internalList, 4, async (e) => ({ ...e, ...(await http(e.url)) }));
    const crawledBroken = [...allInternal.values()].filter((e) => (crawledStatus.get(norm(e.url)) || 0) >= 400).map((e) => ({ ...e, status: crawledStatus.get(norm(e.url)) }));
    const broken = [...crawledBroken, ...checked.filter((c) => c.status && c.status >= 400)], redirs = checked.filter((c) => c.status >= 300 && c.status < 400), unreachable = checked.filter((c) => !c.status);
    const ext = [...new Map(pages.flatMap((p) => p.links).filter((l) => { try { const u = new URL(l.href); return /^https?:/.test(u.protocol) && strip(u.hostname) !== strip(host); } catch { return false; } }).map((l) => [new URL(l.href).origin + new URL(l.href).pathname, l.href])).values()].slice(0, 30);
    const extChecked = await pool(ext.filter((u) => mayFetch(u, origin)), 3, async (u) => ({ url: u, ...(await http(u, { timeout: 8000 })) }));
    const extBroken = extChecked.filter((c) => [404, 410].includes(c.status) || (c.status >= 500 && c.status < 600));
    linkChecks = { internalChecked: checked.length, externalChecked: extChecked.length, broken: broken.map((b) => ({ url: b.url, status: b.status, from: b.from })), redirects: redirs.length, externalBroken: extBroken.map((b) => ({ url: b.url, status: b.status })), unreachable: unreachable.length };
    if (broken.length) add('links', 'high', 'broken-internal', `${broken.length} 個內部連結壞掉（4xx／5xx）`, { affected: broken.length, examples: broken.map((b) => `${b.status} ${b.url}（來自 ${b.from[0]}）`), impact: '使用者與爬蟲都會碰壁，浪費抓取預算並傳遞負面訊號。', fix: '修正連結目標，或為搬移的頁面設定 301。' });
    else if (checked.length || crawledStatus.size) ok('links', `已檢查 ${checked.length + crawledStatus.size} 個內部連結，沒有壞連結`);
    const hopChains = [], loops = []; // the link checker only saw hop 1: follow the rest so a 302 -> 301 -> page chain is reported as a chain
    const known = new Set(chains.map((c) => norm(c.url))); // chains the crawl already recorded are not listed twice
    for (const r of redirs.slice(0, 20)) {
      if (known.has(norm(r.url))) continue;
      const hops = [{ status: r.status, url: r.url }], seen = new Set([norm(r.url)]); let loc = r.location, last = r.url, loop = false;
      for (let n = 0; n < 5 && loc; n++) {
        let nxt; try { nxt = new URL(loc, last).href; } catch { break; } if (!mayFetch(nxt, origin)) break;
        if (seen.has(norm(nxt))) { loop = true; hops.push({ status: '↺', url: nxt }); break; }
        seen.add(norm(nxt)); const h = await http(nxt);
        if (h.status >= 300 && h.status < 400 && h.location) { hops.push({ status: h.status, url: nxt }); last = nxt; loc = h.location; } else { last = nxt; loc = null; }
      }
      const text = `${hops.map((h) => h.status + ' ' + h.url).join(' → ')}${loop ? '' : ' → ' + last}`;
      if (loop) loops.push(text); else if (hops.length >= 2) hopChains.push(text);
    }
    if (loops.length) add('indexability', 'high', 'redirect-loop', `${loops.length} 個網址陷入重新導向迴圈`, { affected: loops.length, examples: loops, impact: '瀏覽器顯示「重新導向次數過多」，搜尋引擎無法抓取，等同頁面壞掉。', fix: '檢查伺服器／CDN／外掛的轉址規則，常見原因是 http↔https 或 www↔非 www 兩邊互相轉。' });
    if (hopChains.length) { const ex = issues.find((i) => i.id === 'redirect-chain'); if (ex) { ex.examples.push(...hopChains.map((c) => safe(c, 300))); ex.affected += hopChains.length; } else add('indexability', 'medium', 'redirect-chain', `${hopChains.length} 個網址經過 2 次以上重新導向`, { affected: hopChains.length, examples: hopChains, impact: '每多一跳都延遲載入並稀釋權重，爬蟲通常只跟隨約 5 跳。', fix: '讓舊網址一步直接導向最終網址。' }); }
    if (redirs.length) add('links', 'low', 'internal-redirect', `${redirs.length} 個內部連結指向會重新導向的網址`, { affected: redirs.length, examples: redirs.slice(0, 6).map((r) => `${r.status} ${r.url} → ${r.location}`), fix: '把連結改成最終網址，省下一次跳轉。' });
    if (extBroken.length) add('links', 'medium', 'broken-external', `${extBroken.length} 個外部連結失效`, { affected: extBroken.length, examples: extBroken.map((b) => `${b.status} ${b.url}`), fix: '移除或更新失效連結。' });
    if (checked.length >= maxLinks) facts.linkCheckLimited = `僅抽查前 ${maxLinks} 個內部連結（--max-links 可調整）`;
  }

  // ---------------------------------------------------------------- performance (lab)
  const P = (f) => live.map(f).filter((v) => v != null);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const perf = { ttfbMs: med(P((p) => p.seo.http?.ttfbMs ?? p.seo.perf?.ttfbMs)), lcpMs: med(P((p) => p.seo.perf?.lcpMs)), cls: med(P((p) => p.seo.perf?.cls)), totalBytes: med(P((p) => p.seo.perf?.totalBytes)), requests: med(P((p) => p.seo.perf?.requests)), domNodes: med(P((p) => p.seo.perf?.domNodes)), thirdParty: Math.max(0, ...P((p) => p.seo.perf?.thirdPartyCount)) };
  facts.performance = { ...perf, note: '實驗室數據：無頭瀏覽器、無節流、單次載入；僅供相對比較，真實使用者數據（CrUX）請看 Search Console／PageSpeed Insights。' };
  const slow = (key, hi, crit, fmt, lab, fix) => { const bad = perPage((p) => (key(p) ?? 0) > hi); if (bad.length) add('performance', bad.some((p) => key(p) > crit) ? 'high' : 'medium', lab.id, lab.title(bad.length), { affected: bad.length, scope: 'page', examples: bad.map((p) => `${fmt(key(p))}：${p.url}`), impact: lab.impact, fix }); };
  slow((p) => p.seo.http?.ttfbMs ?? p.seo.perf?.ttfbMs, 800, 1800, (v) => v + ' ms', { id: 'ttfb', title: (n) => `${n} 個頁面伺服器回應偏慢（TTFB > 800 ms）`, impact: 'TTFB 是所有載入指標的起點，也影響爬蟲每日可抓取的頁數。' }, '啟用伺服器／CDN 快取、優化資料庫查詢、使用邊緣節點。');
  slow((p) => p.seo.perf?.lcpMs, 2500, 4000, (v) => v + ' ms', { id: 'lcp', title: (n) => `${n} 個頁面最大內容繪製（LCP）偏慢（> 2.5 秒，實驗室）`, impact: 'LCP 是 Core Web Vitals 之一，屬於排名參考訊號。' }, '壓縮並預載主視覺圖、移除阻塞渲染的資源、使用 CDN。');
  slow((p) => p.seo.perf?.cls, 0.1, 0.25, (v) => 'CLS ' + v, { id: 'cls', title: (n) => `${n} 個頁面版面位移（CLS）偏高（> 0.1）`, impact: '內容跳動讓使用者誤點，也是 Core Web Vitals 指標。' }, '為圖片／廣告／iframe 預留寬高，避免在內容上方動態插入元素。');
  slow((p) => p.seo.perf?.totalBytes, 3 * 1048576, 6 * 1048576, (v) => (v / 1048576).toFixed(1) + ' MB', { id: 'weight', title: (n) => `${n} 個頁面總下載量偏大（> 3 MB）`, impact: '行動網路載入緩慢、流量成本高。' }, '壓縮圖片、移除未使用的 JS／CSS、延遲載入第三方。');
  slow((p) => p.seo.perf?.requests, 100, 200, (v) => v + ' 個請求', { id: 'requests', title: (n) => `${n} 個頁面請求數過多（> 100）`, impact: '每個請求都有成本，尤其在高延遲網路。' }, '合併資源、使用 HTTP/2 多工、減少第三方腳本。');
  const blocking = perPage((p) => (p.seo.perf?.renderBlockingScripts || 0) > 2); if (blocking.length) add('performance', 'medium', 'render-blocking', `${blocking.length} 個頁面在 <head> 有 3 個以上阻塞渲染的 script`, { affected: blocking.length, scope: 'page', examples: blocking.map((p) => `${p.seo.perf.renderBlockingScripts} 個：${p.url}`), fix: '加上 defer／async，或移到 body 尾端。' });
  const tp = perPage((p) => (p.seo.perf?.thirdPartyCount || 0) > 10); if (tp.length) add('performance', 'low', 'third-party', `${tp.length} 個頁面載入超過 10 個第三方網域`, { affected: tp.length, scope: 'page', examples: tp.flatMap((p) => p.seo.perf.thirdPartyHosts.slice(0, 6)), fix: '審視追蹤碼與嵌入元件，延後載入或移除不必要者。' });
  const dom = perPage((p) => (p.seo.perf?.domNodes || 0) > 3000); if (dom.length) add('performance', 'low', 'dom-size', `${dom.length} 個頁面 DOM 節點超過 3000`, { affected: dom.length, scope: 'page', examples: dom.map((p) => `${p.seo.perf.domNodes}：${p.url}`), fix: '簡化版面、虛擬化長列表。' });
  const noComp = perPage((p) => p.seo.http && p.seo.http.headers && !p.seo.http.headers['content-encoding'] && (p.seo.perf?.htmlBytes || 0) > 5000 && !isLocal(host)); if (noComp.length) add('performance', 'medium', 'no-compression', `${noComp.length} 個頁面的 HTML 沒有 gzip／brotli 壓縮`, { affected: noComp.length, scope: 'page', examples: urls(noComp), fix: '在伺服器或 CDN 啟用 brotli／gzip。' });

  // ---------------------------------------------------------------- mobile
  const mob = live.filter((p) => p.seo.mobile);
  const noVp = perPage((p) => !p.seo.viewport); if (noVp.length) add('mobile', 'high', 'viewport-missing', `${noVp.length} 個頁面沒有 viewport meta`, { affected: noVp.length, scope: 'page', examples: urls(noVp), impact: '手機會以桌機寬度渲染再縮小，Google 行動優先索引會判定為不友善。', fix: '加入 <meta name="viewport" content="width=device-width, initial-scale=1">。' }); else ok('mobile', '所有頁面都有 viewport meta');
  const over = mob.filter((p) => p.seo.mobile.overflowX); if (over.length) add('mobile', 'medium', 'mobile-overflow', `${over.length} 個頁面在手機寬度出現橫向捲動`, { affected: over.length, scope: 'page', examples: urls(over), impact: '內容超出螢幕，使用者需要左右滑動。', fix: '檢查固定寬度元素；容器使用 max-width:100%、圖片 max-width:100%。' });
  const smallT = mob.filter((p) => p.seo.mobile.textChecked && p.seo.mobile.smallTextCount / p.seo.mobile.textChecked > 0.15); if (smallT.length) add('mobile', 'low', 'small-text', `${smallT.length} 個頁面有超過 15% 的文字小於 12px`, { affected: smallT.length, scope: 'page', examples: urls(smallT), fix: '內文至少 16px，輔助文字不小於 12px。' });
  const tap = mob.filter((p) => p.seo.mobile.tapChecked && p.seo.mobile.smallTapTargets / p.seo.mobile.tapChecked > 0.25); if (tap.length) add('mobile', 'low', 'tap-targets', `${tap.length} 個頁面有超過 25% 的可點元素小於 24px`, { affected: tap.length, scope: 'page', examples: urls(tap), fix: '可點區域至少 44×44px（含 padding），相鄰目標保持間距。' });
  if (!over.length && !noVp.length && mob.length) ok('mobile', '手機寬度沒有橫向溢出');

  // measured at 1440 / 768 / 390: tablet and phone behaviour, not just a phone overflow flag
  { const RS = { 'tablet-overflow': ['medium', '平板寬度出現橫向捲動', '平板（768px）使用者需要左右滑動，常見於固定寬度的表格、圖片或元件。', '檢查固定寬度元素；容器 max-width:100%；表格外層加 overflow-x:auto。'], 'mobile-nav-missing': ['medium', '手機寬度找不到導覽選單', '手機訪客與爬蟲看不到主要導覽連結，也找不到可展開的選單按鈕，網站幾乎無法瀏覽。', '在小螢幕提供漢堡選單按鈕（button 加 aria-label／aria-expanded）。'], 'mobile-columns': ['low', '手機寬度仍並排 3 欄以上', '欄位在窄螢幕被擠壓，文字換行過多、難以閱讀。', '用 @media (max-width: 640px) 讓欄位改為單欄堆疊（grid-template-columns: 1fr）。'], 'mobile-wide-images': ['low', '有圖片比手機螢幕還寬', '圖片被切掉或造成橫向捲動。', '圖片加 max-width:100%; height:auto。'], 'mobile-content-hidden': ['medium', '手機版隱藏了大量文字內容', 'Google 以手機版內容為主要索引依據（mobile-first indexing）；手機版少掉的文字，搜尋引擎等於沒看到。', '讓手機版與桌機版提供相同的主要內容（可折疊，但不要移除）。'] };
    const byId = {}; for (const p of live) for (const f of responsiveFindings(p.responsive)) (byId[f.id] ||= []).push(`${p.url}：${f.text}`);
    for (const [id, ex] of Object.entries(byId)) { const [sev, title, impact, fix] = RS[id]; add('mobile', sev, id, `${ex.length} 個頁面：${title}`, { affected: ex.length, scope: 'page', examples: ex, impact, fix }); }
    if (live.some((p) => p.responsive && p.responsive.tablet) && !byId['tablet-overflow']) ok('mobile', '平板寬度沒有橫向溢出'); }

  // ---------------------------------------------------------------- security & transport
  const main = (live[0] || pages[0])?.seo.http, H = main?.headers || {};
  facts.security = { https, headers: Object.fromEntries(['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'server', 'x-powered-by'].map((k) => [k, H[k] || null])) };
  if (!isLocal(host)) {
    if (!https) add('security', 'critical', 'no-https', '網站沒有使用 HTTPS', { impact: '瀏覽器標示「不安全」，Google 以 HTTPS 為排名訊號，資料可被竊聽竄改。', fix: '安裝憑證（可用 Let\'s Encrypt 免費取得）並將所有 http 導向 https。' });
    else {
      ok('security', '使用 HTTPS');
      const cert = await tlsInfo(host, Number(new URL(origin).port) || 443); facts.security.certificate = cert;
      if (cert.ok) { if (cert.daysLeft != null && cert.daysLeft < 0) add('security', 'critical', 'cert-expired', 'SSL 憑證已過期', { detail: cert.validTo, fix: '立即更新憑證並設定自動續期。' }); else if (cert.daysLeft != null && cert.daysLeft < 14) add('security', 'high', 'cert-expiring', `SSL 憑證將在 ${cert.daysLeft} 天內到期`, { detail: cert.validTo, fix: '更新憑證並設定自動續期。' }); else if (cert.daysLeft != null && cert.daysLeft < 30) add('security', 'low', 'cert-soon', `SSL 憑證 ${cert.daysLeft} 天後到期`, { fix: '確認自動續期正常運作。' }); else ok('security', `憑證有效（剩 ${cert.daysLeft} 天）`); if (cert.hostnameMatches === false) add('security', 'critical', 'cert-mismatch', '憑證網域與網站不符', { fix: '核發涵蓋此網域的憑證。' }); if (cert.protocol && /TLSv1(\.0|\.1)?$/.test(cert.protocol)) add('security', 'high', 'tls-old', `使用過時的 ${cert.protocol}`, { fix: '停用 TLS 1.0／1.1，啟用 1.2／1.3。' }); }
      if (!H['strict-transport-security']) add('security', 'medium', 'hsts', '沒有 HSTS（Strict-Transport-Security）', { impact: '使用者首次以 http 造訪仍可能被降級攻擊。', fix: '加入 `Strict-Transport-Security: max-age=31536000; includeSubDomains`。' });
      const mixed = perPage((p) => (p.seo.http?.mixedContentCount || 0) > 0); if (mixed.length) add('security', 'high', 'mixed-content', `${mixed.length} 個頁面載入 http:// 資源（混合內容）`, { affected: mixed.length, scope: 'page', examples: mixed.flatMap((p) => p.seo.http.mixedContent.slice(0, 2)), impact: '瀏覽器會封鎖或警告，頁面可能壞掉。', fix: '所有資源改用 https。' });
    }
  }
  if (main) {
    if (!H['x-content-type-options']) add('security', 'low', 'nosniff', '缺少 X-Content-Type-Options: nosniff', { fix: '加入此標頭以防止 MIME 嗅探。' });
    if (!H['x-frame-options'] && !/frame-ancestors/i.test(H['content-security-policy'] || '')) add('security', 'low', 'clickjack', '沒有防止被嵌入 iframe 的設定（X-Frame-Options／frame-ancestors）', { fix: '加入 `X-Frame-Options: SAMEORIGIN` 或 CSP frame-ancestors。' });
    if (!H['content-security-policy']) add('security', 'info', 'csp', '沒有 Content-Security-Policy', { fix: '逐步導入 CSP，先以 Report-Only 觀察。' });
    if (!H['referrer-policy']) add('security', 'info', 'referrer-policy', '沒有 Referrer-Policy', { fix: '建議 `strict-origin-when-cross-origin`。' });
    if (/\d/.test(H['server'] || '') || H['x-powered-by']) add('security', 'info', 'version-disclosure', '回應標頭洩漏伺服器版本資訊', { examples: [H['server'], H['x-powered-by']].filter(Boolean), fix: '隱藏 Server／X-Powered-By 的版本號。' });
  }

  // ---------------------------------------------------------------- trackers, cookies, consent (observed BEFORE any consent click; names and flags only)
  const pv = site.privacy; if (pv && pv.pagesChecked) {
    facts.privacy = { trackers: pv.trackingVendors.map((v) => v.name), vendors: pv.vendors.length, cookies: pv.cookies.length, consentBanner: pv.consentBanner };
    const trk = pv.trackingVendors.map((v) => v.name);
    if (trk.length && pv.consentChecked && !pv.consentBanner && !pv.hasCmpVendor) add('security', 'medium', 'trackers-no-banner', `載入了 ${trk.length} 個追蹤／廣告服務，但沒有偵測到 Cookie 同意橫幅`, { examples: trk, impact: '在歐盟（GDPR／ePrivacy）等地區，分析與廣告類追蹤通常要在訪客同意「之後」才能啟動；台灣個資法也要求事前告知蒐集目的。被投訴或稽核時，這是最常被點名的一項。', fix: '導入同意管理工具（如 Cookiebot、OneTrust、Termly），讓追蹤碼在同意後才載入；並在隱私權政策列出這些服務。若你只服務法規寬鬆的市場，請由負責人確認後忽略。' });
    else if (trk.length) add('security', 'info', 'trackers-present', `一進站就載入 ${trk.length} 個追蹤／廣告服務：${trk.join('、')}`, { impact: (pv.consentBanner ? '已偵測到 Cookie 橫幅。' : pv.hasCmpVendor ? '網站有載入同意管理工具，但這次沒有看到橫幅（可能依地區或延遲顯示，或在 shadow DOM 內）。' : '') + '本工具無法驗證追蹤碼是否真的等到同意後才啟動——這些服務在爬蟲尚未同意時就已經載入。', fix: '用瀏覽器開發者工具（Network 分頁）拒絕 Cookie 後重新整理，確認這些請求不再出現。' });
    else ok('security', '沒有辨識到追蹤／廣告類第三方服務');
    const replay = pv.vendors.filter((v) => v.cat === 'session-replay'); if (replay.length) add('security', 'info', 'session-replay', `使用行為錄影／熱圖工具：${replay.map((v) => v.name).join('、')}`, { impact: '這類工具會錄下訪客的滑鼠與畫面，可能錄到表單輸入的個資。', fix: '確認已遮蔽輸入欄位與敏感頁面，並在隱私權政策中揭露。' });
    if (https && pv.weakCookies.length) add('security', 'low', 'cookies-insecure', `${pv.weakCookies.length} 個 Cookie 沒有 Secure 旗標（網站是 HTTPS）`, { affected: pv.weakCookies.length, examples: pv.weakCookies.map((c) => `${c.name}（${c.domain}）`), impact: 'Cookie 可能在不加密的連線上被送出。', fix: '由設定它的程式加上 Secure（與適當的 SameSite、HttpOnly）。' });
    if (pv.thirdPartyCookies.length) add('security', 'info', 'third-party-cookies', `${pv.thirdPartyCookies.length} 個第三方 Cookie`, { examples: pv.thirdPartyCookies.map((c) => `${c.name}（${c.domain}${c.owner ? '，' + c.owner : ''}）`), impact: '第三方 Cookie 正被瀏覽器逐步淘汰，也是隱私政策必須揭露的項目。', fix: '評估是否還需要；保留者列入隱私權政策。' });
  }

  // ---------------------------------------------------------------- structured data & social
  const noLd = perPage((p) => !p.seo.structuredData.jsonld.length && !p.seo.structuredData.microdata && p.status === 200);
  const ldBad = perPage((p) => p.seo.structuredData.jsonld.some((j) => j.error)); if (ldBad.length) add('structured', 'high', 'jsonld-invalid', `${ldBad.length} 個頁面的 JSON-LD 無法解析`, { affected: ldBad.length, scope: 'page', examples: ldBad.map((p) => `${p.url}：${p.seo.structuredData.jsonld.find((j) => j.error).error}`), impact: '結構化資料失效，無法取得豐富搜尋結果。', fix: '用 Rich Results Test 驗證並修正 JSON 語法。' });
  if (noLd.length === live.length && live.length) add('structured', 'medium', 'jsonld-none', '全站沒有結構化資料（JSON-LD／microdata）', { impact: '搜尋引擎與 AI 較難確定頁面實體（組織、商品、文章），也失去豐富搜尋結果資格。', fix: '至少加入 Organization／WebSite；內容頁加 Article，商品頁加 Product，並用 Rich Results Test 驗證。' });
  else if (live.some((p) => p.seo.structuredData.jsonld.length)) ok('structured', `偵測到結構化資料：${[...new Set(pages.flatMap((p) => p.seo.structuredData.jsonld.flatMap((j) => j.types || [])))].slice(0, 6).join('、')}`);
  { // what each item must contain for its type; context; whether the markup exists without running JavaScript
    const allNodes = (p) => p.seo.structuredData.jsonld.filter((j) => !j.error);
    const bad = [], rec = [], noCtx = [], untyped = [];
    for (const p of live) {
      const nodes = allNodes(p); if (!nodes.length) continue;
      if (!nodes.every((j) => 'context' in j)) continue; // crawled by an older version (no @context, truncated properties): judging it would invent findings
      const found = validateNodes(nodes);
      for (const f of found) { if (f.untyped) { if (!untyped.includes(p)) untyped.push(p); continue; } if (f.missing.length) bad.push(`${p.url}：${f.type} 缺少 ${f.missing.join('、')}`); else if (f.recommended.length) rec.push(`${p.url}：${f.type} 建議補 ${f.recommended.slice(0, 4).join('、')}`); }
      if (nodes.some((j) => j.types.length && !hasContextOk(j.context))) noCtx.push(p);
    }
    if (bad.length) add('structured', 'high', 'jsonld-missing-required', `${bad.length} 個結構化資料項目缺少必填欄位`, { affected: new Set(bad.map((b) => b.split('：')[0])).size, scope: 'page', examples: bad, impact: '缺必填欄位的標記不會取得豐富搜尋結果（星等、價格、FAQ 摺疊等），Search Console 也會回報錯誤。', fix: '依類型補上欄位（範例：Product 要有 name 與 offers／review／aggregateRating；Article 要有 headline、datePublished、author）；用 Rich Results Test 驗證。' });
    if (noCtx.length) add('structured', 'medium', 'jsonld-no-context', `${noCtx.length} 個頁面的 JSON-LD 缺少 @context: "https://schema.org"`, { affected: noCtx.length, scope: 'page', examples: urls(noCtx), impact: '沒有 @context，解析器不知道這些欄位的定義，整段標記會被忽略。', fix: '在每個 JSON-LD 加上 "@context": "https://schema.org"。' });
    if (untyped.length) add('structured', 'medium', 'jsonld-no-type', `${untyped.length} 個頁面有沒有 @type 的 JSON-LD 項目`, { affected: untyped.length, scope: 'page', examples: urls(untyped), fix: '每個項目都要宣告 "@type"（例如 Organization、Product、Article）。' });
    if (rec.length) add('structured', 'low', 'jsonld-recommended', `${rec.length} 個結構化資料項目缺少建議欄位`, { examples: rec, impact: '不影響資格，但欄位越完整，搜尋結果呈現越豐富。', fix: '有資料的話補上建議欄位。' });
    const jsOnly = perPage((p) => p.seo.raw && !p.seo.raw.error && p.seo.structuredData.jsonld.length > 0 && p.seo.raw.jsonld === 0);
    if (jsOnly.length) add('structured', 'medium', 'jsonld-js-only', `${jsOnly.length} 個頁面的結構化資料要執行 JavaScript 才出現`, { affected: jsOnly.length, scope: 'page', examples: urls(jsOnly), impact: 'Google 通常看得到，但多數 AI 爬蟲、社群預覽與其他搜尋引擎不執行 JS，等於沒有標記。', fix: '把 JSON-LD 直接輸出在伺服器回傳的 HTML 中（SSR／SSG／模板），不要靠前端腳本注入。' });
    const kinds = new Set(live.flatMap((p) => allNodes(p).flatMap((j) => j.types)));
    if (kinds.size && ![...kinds].some((t) => /^(Organization|LocalBusiness|WebSite|Corporation|Person)$/.test(t) || /Business|Store|Restaurant/.test(t))) add('structured', 'low', 'jsonld-no-entity', '有結構化資料，但沒有任何 Organization／WebSite／LocalBusiness', { examples: [...kinds], impact: '搜尋引擎與 AI 較難確定「這個網站是誰」，影響知識面板與品牌辨識。', fix: '在首頁加上 Organization（或 LocalBusiness）與 WebSite。' });
  }
  const noOg = perPage((p) => !p.seo.social.ogTitle || !p.seo.social.ogImage); if (noOg.length) add('structured', 'low', 'og-missing', `${noOg.length} 個頁面缺少 Open Graph 標題或圖片`, { affected: noOg.length, scope: 'page', examples: urls(noOg), impact: '分享到 Facebook／LINE／Slack 時沒有預覽卡片。', fix: '加入 og:title、og:description、og:image（建議 1200×630）、og:url。' });
  const noTw = perPage((p) => !p.seo.social.twitterCard); if (noTw.length === live.length && live.length) add('structured', 'info', 'twitter-card', '沒有 Twitter／X Card 標籤', { fix: '加入 twitter:card=summary_large_image。' });
  const hrefBad = perPage((p) => p.seo.hreflang.some((h) => !/^(x-default|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(h.lang))); if (hrefBad.length) add('structured', 'medium', 'hreflang-invalid', `${hrefBad.length} 個頁面有無效的 hreflang 代碼`, { affected: hrefBad.length, scope: 'page', examples: hrefBad.map((p) => `${p.url}：${p.seo.hreflang.filter((h) => !/^(x-default|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(h.lang)).map((h) => h.lang).join(',')}`), fix: '使用 ISO 639-1 語言（可加 ISO 3166-1 地區），如 zh-TW、en-US。' });
  const noFav = perPage((p) => !p.seo.favicons.length); if (noFav.length === live.length && live.length) add('structured', 'low', 'favicon', '沒有 favicon', { impact: '搜尋結果行動版會顯示 favicon，缺少時顯示預設圖示。', fix: '加入 <link rel="icon">（至少 48×48 的倍數）。' });

  // ---------------------------------------------------------------- AI-crawler readiness
  const llms = await http(origin + '/llms.txt', { method: 'GET', redirect: 'follow' }); facts.llmsTxt = llms.status === 200 && /text|markdown/.test(llms.headers?.['content-type'] || '');
  if (!facts.llmsTxt) add('ai', 'info', 'llms-txt', '沒有 /llms.txt', { impact: 'llms.txt 是新興約定（非標準），用來給 AI 提供網站內容導覽；目前各家支援程度不一。', fix: '可選：提供 /llms.txt 摘要重點頁面與說明。' }); else ok('ai', '有 /llms.txt');
  const blockedAi = (facts.robots.aiBots || []).filter((b) => !b.allowed); facts.robots.aiBlockedCount = blockedAi.length;
  if (blockedAi.length) add('ai', 'info', 'ai-bots-blocked', `robots.txt 擋住 ${blockedAi.length} 個 AI 爬蟲：${blockedAi.map((b) => b.bot).join('、')}`, { examples: blockedAi.map((b) => `${b.bot}（${b.who}）：${b.rule}`), impact: '這是政策選擇：擋訓練爬蟲保護內容；但擋搜尋／使用者代理爬蟲（如 OAI-SearchBot、ChatGPT-User、Claude-User）會讓你不出現在 AI 搜尋與助理的回答中。', fix: '依你的目標決定：想被 AI 搜尋引用就放行搜尋類爬蟲；不想被訓練就只擋訓練類。' });
  else ok('ai', '未在 robots.txt 擋任何已知 AI 爬蟲');
  if (gap.length) add('ai', 'high', 'ai-js-only', 'AI 爬蟲多半不執行 JavaScript，看不到主要內容', { affected: gap.length, scope: 'page', examples: urls(gap), impact: 'AI 搜尋與摘要只能讀到空殼，等於不存在。', fix: '同「內容依賴 JavaScript」：改用 SSR／SSG。' });
  if (pages.some((p) => p.blocked)) add('ai', 'medium', 'bot-wall', '部分頁面對自動化存取顯示驗證／防機器人頁面', { examples: pages.filter((p) => p.blocked).map((p) => `${p.blocked}：${p.url}`), impact: '搜尋與 AI 爬蟲同樣可能被擋在外面。', fix: '確認防火牆／WAF 對已驗證的搜尋爬蟲（Googlebot、Bingbot 等）放行。' });

  if (injection.length) add('ai', 'high', 'prompt-injection', `頁面中有 ${injection.length} 處疑似針對 AI 的指令文字`, { examples: [...new Map(injection.map((x) => [x.text, x])).values()].map((x) => `${x.where.replace(/^page\[([^\]]*)\]\./, '頁面 $1 的 ')}（${x.text.length} 字元；內容已隔離，不在此重述）`), impact: '這類文字對人類看不見或不顯眼，但會被 AI 爬蟲／助理讀進去並可能影響它們的行為（提示注入）。若不是你自己放的，網站可能被入侵或含有第三方惡意內容。', fix: '檢查並移除；確認第三方嵌入、留言／使用者生成內容與外掛是否被竄改。若是刻意測試或安全研究用途則忽略。' });

  // ---------------------------------------------------------------- scoring
  const cats = {};
  for (const [k, [label, weight]] of Object.entries(CATEGORIES)) {
    const its = issues.filter((i) => i.category === k);
    const penalty = its.reduce((n, i) => n + SEV[i.severity] * (i.scope === 'site' ? 1 : 0.4 + 0.6 * Math.min(1, i.affected / i.total)), 0);
    cats[k] = { label, weight, score: Math.round(100 * Math.exp(-penalty / 55)), issues: its.length, passed: passed.filter((p) => p.category === k).length }; // diminishing returns: the 10th problem hurts less than the 1st
  }
  const wsum = Object.values(cats).reduce((n, c) => n + c.weight, 0);
  let overall = Math.round(Object.values(cats).reduce((n, c) => n + c.score * c.weight, 0) / wsum);
  const criticals = issues.filter((i) => i.severity === 'critical');
  if (criticals.length) overall = Math.min(overall, 55); // a catastrophe (site blocked, no HTTPS, expired cert) cannot be averaged away
  if (!live.length) overall = Math.min(overall, 30);     // nothing indexable was served at all: error pages cannot earn a good grade
  const grade = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 65 ? 'C' : overall >= 50 ? 'D' : 'F';
  issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.affected / b.total) - (a.affected / a.total));
  const sevCount = Object.fromEntries(Object.keys(SEV).map((s) => [s, issues.filter((i) => i.severity === s).length]));

  const pageRows = pages.map((p) => ({ url: p.url, status: p.status, title: p.seo.title, titleLen: textLen(p.seo.title), descLen: textLen(p.seo.description), h1: p.seo.h1Count, words: p.seo.words, rawWords: p.seo.raw?.words ?? null, canonical: p.seo.canonical, indexable: !(/noindex/i.test(p.seo.robotsMeta || '') || /noindex/i.test(p.seo.http?.headers?.['x-robots-tag'] || '')) && (p.status || 200) < 400, ttfbMs: p.seo.http?.ttfbMs ?? null, lcpMs: p.seo.perf?.lcpMs ?? null, cls: p.seo.perf?.cls ?? null, bytes: p.seo.perf?.totalBytes ?? null, inlinks: incoming.get(norm(p.url)) ?? 0 }));
  const health = { schemaVersion: 1, checkedAt: new Date().toISOString(), origin, pagesAnalyzed: pages.length, score: overall, grade, categories: cats, severity: sevCount, issues, passed, facts, links: linkChecks, pages: pageRows, notes: [...(criticals.length ? [`有 ${criticals.length} 個嚴重問題，總分上限為 55，直到修復為止。`] : []), '僅分析本次爬取的頁面（抽樣），不代表全站；請以 Google Search Console 的涵蓋範圍與 Core Web Vitals 真實數據為準。', '效能為實驗室數據（無頭瀏覽器、無節流）。', '檢查只做讀取：未登入、未送出表單；額外請求僅限 robots.txt、sitemap、連結狀態（HEAD）與一次 404 探測，並限制併發。'] };
  const verdictOf = () => (sevCount.critical ? 'fail' : sevCount.high ? 'conditional' : 'pass');
  health.verdict = { status: verdictOf(), label: { fail: '❌ 不通過', conditional: '⚠️ 有條件通過', pass: '✅ 通過' }[verdictOf()], rule: '沒有嚴重問題且沒有高風險問題 = 通過；有高風險 = 有條件通過；有嚴重問題 = 不通過', blocking: issues.filter((i) => ['critical', 'high'].includes(i.severity)).map((i) => ({ id: i.id, severity: i.severity, title: i.title })) };
  const prevFile = path.join(siteDir, 'health.json');
  try { if (fs.existsSync(prevFile)) { const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8')); fs.writeFileSync(path.join(siteDir, 'health.prev.json'), JSON.stringify(prev)); const was = new Set((prev.issues || []).map((i) => i.id)), now = new Set(issues.map((i) => i.id)); health.changes = { since: prev.checkedAt, prevScore: prev.score, new: [...now].filter((x) => !was.has(x)), fixed: [...was].filter((x) => !now.has(x)), persisting: [...now].filter((x) => was.has(x)), titles: Object.fromEntries([...issues, ...(prev.issues || [])].map((i) => [i.id, i.title])) }; } } catch {}
  fs.writeFileSync(path.join(siteDir, 'health.json'), JSON.stringify(health, null, 2));
  fs.writeFileSync(path.join(siteDir, 'health.md'), sanitizeDoc(renderHealthMd(health)));
  site.health = { score: overall, grade, categories: Object.fromEntries(Object.entries(cats).map(([k, c]) => [k, c.score])), severity: sevCount, checkedAt: health.checkedAt };
  fs.writeFileSync(path.join(siteDir, 'site.json'), JSON.stringify(site, null, 2));
  return health;
}

const SEV_LABEL = { critical: '🔴 嚴重', high: '🟠 高', medium: '🟡 中', low: '🔵 低', info: '⚪ 資訊' };
export function renderHealthMd(h) {
  const L = [`# 網站健檢報告（SEO／爬蟲索引）`, '', BANNER, '', `網站：${h.origin}　檢查時間：${h.checkedAt}　分析頁數：${h.pagesAnalyzed}`, '', `## 驗收結論：${h.verdict ? h.verdict.label : '—'}`, '', ...(h.verdict ? ['> ' + h.verdict.rule, ...(h.verdict.blocking.length ? ['', '擋住驗收的項目：', ...h.verdict.blocking.map((b) => `- ${SEV_LABEL[b.severity]} ${b.title}（\`${b.id}\`）`)] : [])] : []), '', ...(h.changes ? [`### 與上次（${h.changes.since}，${h.changes.prevScore} 分）相比`, `- 新出現 ${h.changes.new.length}：${h.changes.new.map((x) => h.changes.titles[x]).join('；') || '無'}`, `- 已修復 ${h.changes.fixed.length}：${h.changes.fixed.map((x) => h.changes.titles[x]).join('；') || '無'}`, `- 仍存在 ${h.changes.persisting.length}`, ''] : []), `## 總分：${h.score} / 100（${h.grade}）`, '', '| 面向 | 分數 | 問題數 | 通過項 |', '|---|---|---|---|', ...Object.values(h.categories).map((c) => `| ${c.label} | ${c.score} | ${c.issues} | ${c.passed} |`), '',
    `問題分布：${Object.entries(h.severity).filter(([, n]) => n).map(([s, n]) => `${SEV_LABEL[s]} ${n}`).join('　') || '無'}`, '', '> ' + h.notes.join('\n> '), ''];
  const top = h.issues.filter((i) => ['critical', 'high', 'medium'].includes(i.severity)).slice(0, 10);
  if (top.length) { L.push('## 最該先處理的事', ...top.map((i, n) => `${n + 1}. **${i.title}**（${SEV_LABEL[i.severity]}）— ${i.fix}`), ''); }
  L.push('## 全部問題（依嚴重度）', '');
  for (const i of h.issues) {
    L.push(`### ${SEV_LABEL[i.severity]}　${i.title}`, `- 類別：${CATEGORIES[i.category][0]}　影響：${i.scope === 'site' ? '全站' : `${i.affected} / ${i.total} 頁`}　代碼：\`${i.id}\``);
    if (i.impact) L.push(`- 為什麼重要：${i.impact}`); if (i.fix) L.push(`- 怎麼修：${i.fix}`); if (i.detail) L.push(`- 細節：${i.detail}`);
    if (i.examples.length) L.push('- 範例：', ...i.examples.map((e) => `  - ${e}`)); L.push('');
  }
  L.push('## 已通過', ...h.passed.map((p) => `- ✅ ${CATEGORIES[p.category][0]}：${p.title}`), '');
  const f = h.facts;
  L.push('## 爬取與索引事實', `- robots.txt：${f.robots.exists ? '存在' : '無'}（HTTP ${f.robots.status ?? '—'}）；Sitemap 宣告：${f.robots.sitemaps.join('、') || '無'}`, `- sitemap：${f.sitemap.found.join('、') || '找不到'}；${f.sitemap.urlCount} 筆網址${f.sitemap.sampleChecked ? `；抽樣 ${f.sitemap.sampleChecked} 筆檢查` : ''}`, `- 不存在網址回應：${f.soft404.status ?? '—'}（應為 404／410）`, `- llms.txt：${f.llmsTxt ? '有' : '無'}`, '');
  L.push('### 搜尋引擎與 AI 爬蟲存取（依 robots.txt）', '| 爬蟲 | 用途 | 首頁 |', '|---|---|---|', ...[...f.robots.searchBots, ...f.robots.aiBots].map((b) => `| ${b.bot} | ${b.who} | ${b.allowed ? '允許' : '❌ 禁止（' + b.rule + '）'} |`), '');
  L.push('## 頁面一覽', '| 網址 | 狀態 | 可索引 | 標題長度 | 描述長度 | h1 | 字數（渲染／原始） | LCP ms | 內部連入 |', '|---|---|---|---|---|---|---|---|---|', ...h.pages.map((p) => `| ${p.url} | ${p.status} | ${p.indexable ? '是' : '否'} | ${p.titleLen} | ${p.descLen} | ${p.h1} | ${p.words}／${p.rawWords ?? '—'} | ${p.lcpMs ?? '—'} | ${p.inlinks} |`), '');
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const __n = normalizeFlags(process.argv.slice(2)); if (__n.error) { console.error(__n.error); process.exit(1); }
  const a = __n.args, i = a.indexOf('--site');
  if (i < 0 || !a[i + 1] || !fs.existsSync(path.join(a[i + 1], 'site.json'))) { console.error('Usage: health-check.mjs --site <crawl dir with site.json> [--no-link-check] [--max-links 120] [--fail-on critical|high|medium|low]'); process.exit(1); }
  const h = await runHealth(a[i + 1], { noLinkCheck: a.includes('--no-link-check'), maxLinks: intOpt(a, 'max-links', 120, { min: 0, max: 1000 }) });
  console.log(`健檢完成：${h.score}/100（${h.grade}）— ${Object.entries(h.severity).filter(([, n]) => n).map(([s, n]) => `${SEV_LABEL[s]} ${n}`).join('　')}`);
  console.log(Object.values(h.categories).map((c) => `${c.label} ${c.score}`).join('　'));
  console.log('驗收結論：' + h.verdict.label);
  console.log('報告：' + path.join(a[i + 1], 'health.md'));
  const fi = a.indexOf('--fail-on'); if (fi >= 0) { const lvl = a[fi + 1]; if (!(lvl in SEV_RANK) || lvl === 'info') { console.error('--fail-on 需要 critical／high／medium／low 其中之一'); process.exit(1); } if (h.issues.some((x) => SEV_RANK[x.severity] <= SEV_RANK[lvl])) { console.error(`有 ${lvl} 以上的問題，依 --fail-on ${lvl} 以非零代碼結束（4）`); process.exit(4); } }
}
