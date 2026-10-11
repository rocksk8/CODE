// Who is watching the visitors? Recognises well-known tracking / advertising / chat / video / payment services from the
// addresses a page loads (scripts, frames, pixels, requests) and from cookie names, and checks cookie flags.
// Purely a lookup over what the page already sent to this browser; cookie VALUES are never stored (they can be identifiers).

// category: analytics | ads | tag-manager | session-replay | chat | social | video | payments | maps | cdn-lib | fonts | cmp (consent tool)
export const VENDORS = [
  { name: 'Google Tag Manager', cat: 'tag-manager', host: /(^|\.)googletagmanager\.com$/ },
  { name: 'Google Analytics', cat: 'analytics', host: /(^|\.)(google-analytics\.com|analytics\.google\.com)$/ },
  { name: 'Google Ads / DoubleClick', cat: 'ads', host: /(^|\.)(doubleclick\.net|googleadservices\.com|googlesyndication\.com|adservice\.google\.[a-z.]+)$/ },
  { name: 'Meta (Facebook) Pixel', cat: 'ads', host: /(^|\.)(connect\.facebook\.net|facebook\.com)$/, path: /(fbevents|\/tr\b|signals)/ },
  { name: 'TikTok Pixel', cat: 'ads', host: /(^|\.)(analytics\.tiktok\.com|tiktok\.com)$/, path: /(pixel|events|i18n)/ }, // a plain tiktok.com address is just a link (e.g. sameAs), not a pixel
  { name: 'LinkedIn Insight', cat: 'ads', host: /(^|\.)(snap\.licdn\.com|px\.ads\.linkedin\.com)$/ },
  { name: 'X (Twitter) Pixel', cat: 'ads', host: /(^|\.)(static\.ads-twitter\.com|analytics\.twitter\.com)$/ },
  { name: 'Pinterest Tag', cat: 'ads', host: /(^|\.)(ct\.pinterest\.com|s\.pinimg\.com)$/, path: /(^\/ct\/|^\/v3\/|pintrk|\/tag\.js)/ },
  { name: 'Criteo', cat: 'ads', host: /(^|\.)criteo\.(com|net)$/ },
  { name: 'Hotjar', cat: 'session-replay', host: /(^|\.)(hotjar\.com|hotjar\.io)$/ },
  { name: 'Microsoft Clarity', cat: 'session-replay', host: /(^|\.)clarity\.ms$/ },
  { name: 'FullStory', cat: 'session-replay', host: /(^|\.)fullstory\.com$/ },
  { name: 'Mouseflow', cat: 'session-replay', host: /(^|\.)mouseflow\.com$/ },
  { name: 'Microsoft Ads (Bing UET)', cat: 'ads', host: /(^|\.)bat\.bing\.com$/ },
  { name: 'Adobe Analytics', cat: 'analytics', host: /(^|\.)(omtrdc\.net|2o7\.net|demdex\.net)$/ },
  { name: 'Matomo', cat: 'analytics', host: /(^|\.)matomo\.cloud$/ },
  { name: 'Plausible', cat: 'analytics', host: /(^|\.)plausible\.io$/ },
  { name: 'Segment', cat: 'analytics', host: /(^|\.)segment\.(com|io)$/ },
  { name: 'Mixpanel', cat: 'analytics', host: /(^|\.)mixpanel\.com$/ },
  { name: 'Amplitude', cat: 'analytics', host: /(^|\.)amplitude\.com$/ },
  { name: 'Heap', cat: 'analytics', host: /(^|\.)heap(analytics)?\.com$/ },
  { name: 'HubSpot', cat: 'analytics', host: /(^|\.)(hs-scripts\.com|hs-analytics\.net|hsforms\.(net|com)|hs-banner\.com|hubspot\.com)$/, path: /(\.js|\/embed|collected|forms)/ },
  { name: 'Intercom', cat: 'chat', host: /(^|\.)(intercom\.io|intercomcdn\.com)$/ },
  { name: 'Drift', cat: 'chat', host: /(^|\.)drift\.com$/ },
  { name: 'Zendesk', cat: 'chat', host: /(^|\.)(zdassets\.com|zendesk\.com)$/, path: /(\.js|embeddable|ekr|web_widget)/ },
  { name: 'Crisp', cat: 'chat', host: /(^|\.)crisp\.chat$/ },
  { name: 'Tawk.to', cat: 'chat', host: /(^|\.)tawk\.to$/ },
  { name: 'LINE（官方帳號／分享）', cat: 'social', host: /(^|\.)line-scdn\.net$/ },
  { name: 'YouTube', cat: 'video', host: /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com)$/ },
  { name: 'Vimeo', cat: 'video', host: /(^|\.)(vimeo\.com|vimeocdn\.com)$/ },
  { name: 'Stripe', cat: 'payments', host: /(^|\.)stripe\.(com|network)$/ },
  { name: 'PayPal', cat: 'payments', host: /(^|\.)(paypal\.com|paypalobjects\.com)$/ },
  { name: 'Google Maps', cat: 'maps', host: /(^|\.)(maps\.googleapis\.com|maps\.gstatic\.com)$/ },
  { name: 'Google reCAPTCHA', cat: 'security', host: /(^|\.)(recaptcha\.net)$/ },
  { name: 'Google Fonts', cat: 'fonts', host: /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/ },
  { name: 'Cookiebot', cat: 'cmp', host: /(^|\.)(cookiebot\.com|consent\.cookiebot\.com)$/ },
  { name: 'OneTrust', cat: 'cmp', host: /(^|\.)(onetrust\.com|cookielaw\.org)$/ },
  { name: 'Osano / Termly / Iubenda', cat: 'cmp', host: /(^|\.)(osano\.com|termly\.io|iubenda\.com)$/ },
  { name: 'Cloudflare Web Analytics', cat: 'analytics', host: /(^|\.)cloudflareinsights\.com$/ },
];

export const CAT_LABEL = { analytics: '流量分析', ads: '廣告／再行銷', 'tag-manager': '標籤管理', 'session-replay': '行為錄影／熱圖', chat: '客服聊天', social: '社群', video: '影音嵌入', payments: '金流', maps: '地圖', security: '防機器人', fonts: '外部字型', cmp: '同意管理（Cookie 橫幅工具）' };
// categories that profile visitors: these need consent in GDPR-style regimes and are what privacy reviews ask about
export const TRACKING_CATS = new Set(['analytics', 'ads', 'tag-manager', 'session-replay']);

// well-known cookie names -> who sets them (names only; patterns)
const COOKIES = [
  [/^_ga(_.+)?$|^_gid$|^_gat/, 'Google Analytics', 'analytics'], [/^_gcl_|^IDE$|^test_cookie$/, 'Google Ads', 'ads'], [/^_fbp$|^_fbc$|^fr$/, 'Meta Pixel', 'ads'],
  [/^_hj/, 'Hotjar', 'session-replay'], [/^_clck$|^_clsk$|^CLID$/, 'Microsoft Clarity', 'session-replay'], [/^__hs|^hubspotutk$|^__hstc$/, 'HubSpot', 'analytics'],
  [/^_ttp$|^_tt_/, 'TikTok', 'ads'], [/^_pin_|^_pinterest/, 'Pinterest', 'ads'], [/^_uetsid$|^_uetvid$|^MUID$/, 'Microsoft Ads', 'ads'],
  [/^ajs_|^_segment/, 'Segment', 'analytics'], [/^mp_.*mixpanel|^mixpanel/, 'Mixpanel', 'analytics'], [/^_pk_/, 'Matomo', 'analytics'],
  [/^CookieConsent$|^CookieConsentBulkTicket$/, 'Cookiebot', 'cmp'], [/^OptanonConsent$|^OptanonAlertBoxClosed$/, 'OneTrust', 'cmp'],
  [/^VISITOR_INFO1_LIVE$|^YSC$|^PREF$/, 'YouTube', 'video'], [/^PHPSESSID$|^JSESSIONID$|^ASP\.NET_SessionId$|^connect\.sid$|^laravel_session$/, '網站本身的工作階段', 'functional'],
  [/^wordpress_|^wp-settings|^wp_woocommerce|^woocommerce_/, 'WordPress／WooCommerce', 'functional'], [/^__cf_bm$|^cf_clearance$/, 'Cloudflare', 'functional'],
];

const strip = (h) => String(h || '').replace(/^www\./, '').toLowerCase();

/** urls -> [{ name, cat, hosts: [...], sample }] (each vendor once) */
export function classifyUrls(urls) {
  const found = new Map();
  for (const raw of urls) {
    let u; try { u = new URL(raw, 'https://x.invalid'); } catch { continue; } if (!/^https?:$/.test(u.protocol) || u.hostname === 'x.invalid') continue;
    const host = u.hostname.toLowerCase();
    for (const v of VENDORS) {
      if (!v.host.test(host)) continue;
      if (v.path && !v.path.test(u.pathname + u.search)) continue; // facebook.com alone is just a link; only its pixel/script endpoints count
      const e = found.get(v.name) || { name: v.name, cat: v.cat, hosts: new Set(), sample: u.origin + u.pathname.slice(0, 60) };
      e.hosts.add(host); found.set(v.name, e);
    }
  }
  return [...found.values()].map((e) => ({ ...e, hosts: [...e.hosts].slice(0, 4) }));
}

/** Playwright cookies -> flags and likely owner. NEVER keeps the value. */
export function analyzeCookies(cookies, pageHost, { https = true } = {}) {
  const first = strip(pageHost);
  return cookies.slice(0, 80).map((c) => {
    const dom = strip(String(c.domain || '').replace(/^\./, ''));
    const known = COOKIES.find(([re]) => re.test(c.name));
    const days = c.expires && c.expires > 0 ? Math.round((c.expires * 1000 - Date.now()) / 86400000) : null; // null = session cookie
    const thirdParty = !!dom && dom !== first && !first.endsWith('.' + dom) && !dom.endsWith('.' + first);
    return { name: String(c.name).slice(0, 60), domain: dom, thirdParty, secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'None', days, owner: known ? known[1] : null, cat: known ? known[2] : 'unknown',
      tracking: known ? TRACKING_CATS.has(known[2]) : false, weak: https && !c.secure };
  });
}

/** A visible cookie / consent banner, from selectors and wording — runs in the page. Marks the box it found (data-se-consent) so the crawler clicks THAT and nothing else. Returns { detected, kind } */
export function detectConsentInPage() {
  const KNOWN = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog', '#usercentrics-root', '#didomi-host', '#cookiescript_injected', '.cc-window', '.cc-banner', '#cookie-law-info-bar', '.osano-cm-window', '#iubenda-cs-banner', '.truste_box_overlay']; // CMP hosts: a zero-size shadow-DOM host still counts
  const GENERIC = ['.cookie-notice', '#cookie-notice', '#cookie-banner', '.cookie-banner', '.cookie-consent', '[id*="cookie-consent" i]', '[class*="cookie-consent" i]', '[id*="cookieBanner" i]', '[class*="cookieBanner" i]', '[class*="cookie-bar" i]', '[aria-label*="cookie" i]', '[id*="consent" i][role=dialog]', '[class*="consent-banner" i]'];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 40 && r.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const notPage = (el) => el !== document.body && el !== document.documentElement && !el.querySelector('main, h1, article'); // a class on <body>/<html> or a wrapper around the whole page is not a banner
  const kindOf = (sel) => String(sel).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const mark = (el) => { try { document.querySelectorAll('[data-se-consent]').forEach((x) => x.removeAttribute('data-se-consent')); el.setAttribute('data-se-consent', '1'); } catch {} };
  for (const s of KNOWN) { try { const el = document.querySelector(s); if (el && notPage(el) && (vis(el) || el.shadowRoot || /usercentrics|didomi|onetrust/i.test(s))) { mark(el); return { detected: true, kind: kindOf(s) }; } } catch {} }
  for (const s of GENERIC) { try { for (const el of document.querySelectorAll(s)) if (notPage(el) && vis(el)) { mark(el); return { detected: true, kind: kindOf(s) }; } } catch {} }
  const words = /(cookie|cookies|餅乾|隱私權政策|同意.{0,6}(使用|追蹤)|consent)/i;
  for (const el of document.querySelectorAll('div,section,aside,dialog')) {
    const cs = getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const t = (el.innerText || '').slice(0, 400); if (t.length > 20 && notPage(el) && words.test(t) && /(\baccept\b|\bagree\b|\ballow\b|\bok\b|\bgot it\b|同意|接受|確定|了解|拒絕|\breject\b|\bdecline\b)/i.test(t) && vis(el)) { mark(el); return { detected: true, kind: 'fixed-banner' }; }
  }
  return { detected: false, kind: null };
}

/** Everything a page loads that could be a tracker: network URLs + DOM resource attributes. */
export function resourceUrlsInPage() {
  const out = new Set();
  for (const el of document.querySelectorAll('script[src],iframe[src],img[src],link[href],source[src],embed[src]')) { if (el.tagName === 'LINK' && !/(preload|prefetch|preconnect|dns-prefetch|stylesheet|modulepreload)/i.test(el.rel)) continue; const v = el.src || el.href; if (v) out.add(v); } // <link rel=canonical/alternate/me> are references, not loads
  // Inline script TEXT is deliberately not mined: code that mentions a tracker address may never run before consent (consent-gated loaders are written exactly like that). What counts is what the page actually requested or inserted.
  return [...out].slice(0, 400);
}

/** Merge the per-page results into one site picture. Vendors are tagged: loaded for a NEW visitor ('before') or only seen after the crawler touched the banner ('after'). */
export function summarizePrivacy(perPage) {
  const list = perPage.filter(Boolean);
  const vendors = new Map(), cookies = new Map(); let consentPages = 0, consentChecked = false;
  const addV = (v, when) => { const e = vendors.get(v.name); if (!e) vendors.set(v.name, { ...v, when, pages: 1 }); else { e.pages++; if (when === 'before') e.when = 'before'; } };
  for (const p of list) {
    if (p.stage === 'before') {
      consentChecked = true; for (const c of p.cookies || []) cookies.set(c.name + '|' + c.domain, c); if (p.consent?.detected) consentPages++; // only the first page is seen before the crawler touches a banner
      for (const v of p.vendors || []) addV(v, 'before');
      for (const v of p.vendorsAfter || []) addV(v, 'after');
    } else for (const v of [...(p.vendors || []), ...(p.vendorsAfter || [])]) addV(v, 'after');
  }
  const v = [...vendors.values()].sort((a, b) => ((a.when === 'before') !== (b.when === 'before') ? (a.when === 'before' ? -1 : 1) : 0) || (TRACKING_CATS.has(b.cat) - TRACKING_CATS.has(a.cat)) || b.pages - a.pages);
  const ck = [...cookies.values()];
  const trackingVendors = v.filter((x) => TRACKING_CATS.has(x.cat) && x.when === 'before'), laterTracking = v.filter((x) => TRACKING_CATS.has(x.cat) && x.when === 'after');
  return { pagesChecked: list.length, vendors: v, cookies: ck, trackingVendors, laterTracking, trackingCookies: ck.filter((c) => c.tracking), thirdPartyCookies: ck.filter((c) => c.thirdParty), weakCookies: ck.filter((c) => c.weak), hasCmpVendor: v.some((x) => x.cat === 'cmp'), consentBanner: consentPages > 0, consentChecked };
}

const md = (x) => String(x ?? '').replace(/[|`\r\n]+/g, ' ').slice(0, 80);
export function privacyMarkdown(sum) {
  if (!sum || !sum.pagesChecked) return [];
  const L = ['## 追蹤碼與 Cookie（誰在看訪客）', '',
    `> 這是「還沒點任何同意按鈕」時，第一頁自己載入與設定的東西（服務清單另含後續 ${sum.pagesChecked} 頁）。只記名稱與旗標，不記 Cookie 的值。是否違規取決於你的目標市場法規（GDPR／台灣個資法等），請由負責人判斷。`, '',
    `- Cookie 橫幅：${!sum.consentChecked ? '未檢查' : sum.consentBanner ? '偵測到' : '**沒有偵測到**'}${sum.hasCmpVendor ? '（有使用同意管理工具）' : ''}`,
    `- 一進站就載入的追蹤／廣告類服務：${sum.trackingVendors.length ? sum.trackingVendors.map((v) => v.name).join('、') : '無'}`,
    ...(sum.laterTracking && sum.laterTracking.length ? [`- 爬蟲點了橫幅或往下捲動之後才出現的追蹤／廣告類服務：${sum.laterTracking.map((v) => v.name).join('、')}`] : []), ''];
  if (sum.vendors.length) L.push('| 服務 | 類別 | 何時載入 | 出現頁數 | 載入來源 |', '|---|---|---|---|---|', ...sum.vendors.map((v) => `| ${v.name} | ${CAT_LABEL[v.cat] || v.cat}${TRACKING_CATS.has(v.cat) ? ' ⚠️' : ''} | ${v.when === 'after' ? '點同意／捲動後才出現' : '一進站就載入'} | ${v.pages} | ${v.hosts.join('、')} |`), '');
  else L.push('沒有辨識到已知的第三方追蹤／嵌入服務。', '');
  if (sum.cookies.length) L.push(`### Cookie（${sum.cookies.length} 個；名稱與旗標）`, '| 名稱 | 網域 | 誰設的 | 有效期 | Secure | HttpOnly | SameSite |', '|---|---|---|---|---|---|---|', ...sum.cookies.slice(0, 40).map((c) => `| ${md(c.name)} | ${md(c.domain)}${c.thirdParty ? '（第三方）' : ''} | ${c.owner || '—'}${c.tracking ? ' ⚠️追蹤' : ''} | ${c.days == null ? '工作階段' : c.days + ' 天'} | ${c.secure ? '是' : '否'} | ${c.httpOnly ? '是' : '否'} | ${md(c.sameSite)} |`), '');
  else L.push('頁面載入時沒有設定 Cookie。', '');
  return L;
}
