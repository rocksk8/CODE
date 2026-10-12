#!/usr/bin/env node
// Security-header and TLS grading, Mozilla-Observatory / SSL-Labs style: every test says what it found, how many points it moved the score, and how to fix it.
// Headers: CSP strength, HSTS, nosniff, framing, referrer policy, cookie flags, subresource integrity. TLS: which protocol versions the server accepts, certificate state.
// Heuristics on public information only: this is a configuration review, not a vulnerability scan; the grade is for comparison between runs, not a certification.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { _t } from './i18n.mjs';
import { isMain, isInternalHost, tagList, attrValue } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

const GRADES = [[100, 'A+'], [90, 'A'], [85, 'A-'], [80, 'B+'], [70, 'B'], [65, 'B-'], [60, 'C+'], [50, 'C'], [45, 'C-'], [40, 'D+'], [30, 'D'], [25, 'D-'], [-1e9, 'F']];
export const gradeOf = (score) => GRADES.find(([min]) => score >= min)[1];
const lc = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

/** headers: response headers of the main page; opts: { https, cookies:[{name,secure,httpOnly,sameSite}], scripts:[{src,integrity}], host } */
export function gradeHeaders(headers, { https = true, cookies = [], scripts = [], host = '' } = {}) {
  const H = lc(headers), tests = []; let score = 100;
  const add = (id, name, points, result, fix) => { tests.push({ id, name, points, result, fix: fix || null }); score += points; };
  // Content-Security-Policy
  const csp = H['content-security-policy'];
  if (!csp) add('csp', 'Content-Security-Policy', -25, _t('沒有設定'), _t('逐步導入 CSP，先以 Content-Security-Policy-Report-Only 觀察。'));
  else {
    const dirs = Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...v] = d.split(/\s+/); return [n.toLowerCase(), v]; }));
    const script = dirs['script-src'] || dirs['default-src'] || [];
    const unsafeInline = script.includes("'unsafe-inline'") && !script.some((x) => /^'(nonce-|sha(256|384|512)-)/.test(x) || x === "'strict-dynamic'");
    if (unsafeInline) add('csp', 'Content-Security-Policy', -20, _t("script 來源允許 'unsafe-inline'（等於擋不住注入的內嵌腳本）"), _t("改用 nonce 或 hash，移除 'unsafe-inline'。"));
    else if (script.includes("'unsafe-eval'")) add('csp', 'Content-Security-Policy', -10, _t("script 來源允許 'unsafe-eval'"), _t("移除 'unsafe-eval'。"));
    else if (script.some((x) => x === '*' || x === 'http:' || x === 'https:' || x === 'data:')) add('csp', 'Content-Security-Policy', -10, _t('script 來源太寬鬆（* / http: / https: / data:）'), _t('只列出實際需要的網域。'));
    else add('csp', 'Content-Security-Policy', (dirs['object-src'] || []).includes("'none'") && dirs['base-uri'] ? 10 : 5, _t('有設定，且沒有放行內嵌腳本'), null);
  }
  // HSTS
  if (https) {
    const h = H['strict-transport-security'];
    if (!h) add('hsts', 'Strict-Transport-Security', -20, _t('沒有設定'), _t('加入 `Strict-Transport-Security: max-age=31536000; includeSubDomains`。'));
    else { const age = Number(/max-age\s*=\s*"?(\d+)/i.exec(h)?.[1] ?? 0);
      if (age < 15552000) add('hsts', 'Strict-Transport-Security', age ? -10 : -20, _t`max-age 只有 ${age} 秒（建議至少 15552000，也就是 180 天）`, _t('把 max-age 調到 31536000。'));
      else add('hsts', 'Strict-Transport-Security', /includesubdomains/i.test(h) && /preload/i.test(h) && age >= 31536000 ? 5 : 0, _t`max-age ${age} 秒` + (/includesubdomains/i.test(h) ? _t('，含子網域') : '') + (/preload/i.test(h) ? ', preload' : ''), null); }
  }
  // MIME sniffing, framing, referrer
  if (!/nosniff/i.test(H['x-content-type-options'] || '')) add('nosniff', 'X-Content-Type-Options', -5, _t('缺少 nosniff'), _t('加入 `X-Content-Type-Options: nosniff`。'));
  else add('nosniff', 'X-Content-Type-Options', 0, 'nosniff', null);
  const xfo = /^(deny|sameorigin)$/i.test((H['x-frame-options'] || '').trim()), fa = /frame-ancestors/i.test(csp || '');
  if (!xfo && !fa) add('framing', 'X-Frame-Options / frame-ancestors', -20, _t('沒有防止被嵌進別人的 iframe（點擊劫持）'), _t("加入 `X-Frame-Options: DENY`，或 CSP 的 `frame-ancestors 'self'`。"));
  else add('framing', 'X-Frame-Options / frame-ancestors', 0, xfo ? H['x-frame-options'] : 'frame-ancestors', null);
  const rp = (H['referrer-policy'] || '').toLowerCase();
  if (!rp) add('referrer', 'Referrer-Policy', 0, _t('沒有設定（瀏覽器預設 strict-origin-when-cross-origin）'), _t('明確設定 `strict-origin-when-cross-origin` 或更嚴格。'));
  else if (/^(no-referrer|same-origin|strict-origin|strict-origin-when-cross-origin|no-referrer-when-downgrade)$/.test(rp.split(',').pop().trim())) add('referrer', 'Referrer-Policy', 5, rp, null);
  else add('referrer', 'Referrer-Policy', -5, _t`${clean(rp, 40)}（會把完整網址傳給其他網站）`, _t('改成 `strict-origin-when-cross-origin`。'));
  // cookies
  const sess = cookies.filter((c) => /sess|auth|token|sid|login|jwt/i.test(c.name));
  if (https && sess.some((c) => !c.secure)) add('cookie-secure', 'Cookie Secure', -20, _t`登入／工作階段類 Cookie 沒有 Secure：${sess.filter((c) => !c.secure).slice(0, 3).map((c) => clean(c.name, 30)).join(', ')}`, _t('在 Set-Cookie 加上 Secure。'));
  if (sess.some((c) => !c.httpOnly)) add('cookie-httponly', 'Cookie HttpOnly', -10, _t`登入／工作階段類 Cookie 沒有 HttpOnly：${sess.filter((c) => !c.httpOnly).slice(0, 3).map((c) => clean(c.name, 30)).join(', ')}`, _t('在 Set-Cookie 加上 HttpOnly，腳本就讀不到。'));
  if (sess.some((c) => String(c.sameSite).toLowerCase() === 'none' && c.secure === false)) add('cookie-samesite', 'Cookie SameSite', -5, _t('工作階段類 Cookie 設為 SameSite=None 又沒有 Secure'), _t('改用 SameSite=Lax 或 Strict。'));
  // subresource integrity for scripts from other hosts
  const ext = scripts.filter((s) => { try { return new URL(s.src).hostname !== host; } catch { return false; } });
  const noSri = ext.filter((s) => !s.integrity);
  if (noSri.length) add('sri', 'Subresource Integrity', -10, _t`${noSri.length} 個外部腳本沒有 integrity 屬性（例：${noSri.slice(0, 2).map((s) => clean(s.src.replace(/^https?:\/\//, ''), 50)).join(', ')}）`, _t('對固定版本的外部腳本加上 `integrity` 與 `crossorigin`。'));
  else if (ext.length) add('sri', 'Subresource Integrity', 5, _t`${ext.length} 個外部腳本都有 integrity`, null);
  // version disclosure is informational only
  const disc = [H['server'], H['x-powered-by']].filter((x) => x && /\d/.test(x));
  if (disc.length) tests.push({ id: 'disclosure', name: 'Server / X-Powered-By', points: 0, result: _t`洩漏版本：${clean(disc.join(', '), 60)}`, fix: _t('隱藏版本號，避免被針對已知漏洞。') });
  score = Math.min(score, 115); // like Observatory the extra credit cannot hide missing basics, but the scale allows A+ above 100
  return { score, grade: gradeOf(score), tests };
}

const VERSIONS = [['TLSv1', 'TLS 1.0'], ['TLSv1.1', 'TLS 1.1'], ['TLSv1.2', 'TLS 1.2'], ['TLSv1.3', 'TLS 1.3']];
function tryVersion(host, port, v) {
  return new Promise((resolve) => {
    let done = false; const fin = (x) => { if (!done) { done = true; resolve(x); } };
    let s; try { s = tls.connect({ host, port, servername: host, minVersion: v, maxVersion: v, ciphers: v === 'TLSv1.3' ? undefined : 'ALL:@SECLEVEL=0', rejectUnauthorized: false, timeout: 6000 }, () => { const cipher = s.getCipher(); fin({ ok: true, cipher: cipher && cipher.name }); s.end(); }); } catch { return fin({ ok: false }); }
    s.on('error', () => fin({ ok: false })); s.on('timeout', () => { fin({ ok: false }); s.destroy(); });
  });
}
function certInfo(host, port) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = s.getPeerCertificate(true); let chain = 0; for (let x = c, seen = new Set(); x && !seen.has(x.fingerprint256) && chain < 10; x = x.issuerCertificate) { seen.add(x.fingerprint256); chain++; }
      const to = c.valid_to ? new Date(c.valid_to) : null; const idErr = tls.checkServerIdentity(host, c);
      resolve({ ok: true, protocol: s.getProtocol(), cipher: (s.getCipher() || {}).name, validTo: to && to.toISOString().slice(0, 10), daysLeft: to ? Math.floor((to - Date.now()) / 86400000) : null, issuer: clean(c.issuer?.O || c.issuer?.CN || '', 60), bits: c.bits || null, selfSigned: !!c.issuerCertificate && c.issuerCertificate.fingerprint256 === c.fingerprint256, hostnameMatches: !idErr, trusted: s.authorized, authError: s.authorized ? null : clean(String(s.authorizationError || ''), 60), chain });
      s.end();
    });
    s.on('error', (e) => resolve({ ok: false, error: clean(String(e.code || e.message), 50) })); s.on('timeout', () => { resolve({ ok: false, error: 'timeout' }); s.destroy(); });
  });
}

/** versions: { 'TLS 1.0': bool, ... }, cert: certInfo result. Pure grading, so it can be tested without a network. */
export function gradeTls(versions, cert) {
  const tests = []; let cap = 'A+'; const order = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
  const lower = (g) => { if (order.indexOf(g) > order.indexOf(cap)) cap = g; };
  const t = (id, name, result, grade, fix) => { tests.push({ id, name, result, cap: grade || null, fix: fix || null }); if (grade) lower(grade); };
  if (!cert?.ok) return { grade: null, tests: [{ id: 'connect', name: 'TLS', result: _t`無法連線：${cert?.error || '?'}`, cap: null, fix: null }], versions };
  if (cert.daysLeft != null && cert.daysLeft < 0) t('expired', _t('憑證效期'), _t`已過期（${cert.validTo}）`, 'F', _t('立即更新憑證。'));
  else if (cert.daysLeft != null && cert.daysLeft < 14) t('expiring', _t('憑證效期'), _t`${cert.daysLeft} 天後到期`, 'B', _t('更新憑證並設定自動續期。'));
  else t('expiry', _t('憑證效期'), _t`有效至 ${cert.validTo}（剩 ${cert.daysLeft} 天）`);
  if (!cert.hostnameMatches) t('hostname', _t('憑證網域'), _t('憑證不包含這個網域'), 'F', _t('換發包含此網域的憑證。'));
  if (cert.selfSigned) t('selfsigned', _t('憑證簽發者'), _t('自簽憑證'), 'F', _t('改用受信任的憑證機構（例如 Let\'s Encrypt）。'));
  else if (!cert.trusted) t('untrusted', _t('憑證信任'), _t`不受信任：${cert.authError || '?'}`, 'F', _t('補上完整的憑證鏈。'));
  else t('trust', _t('憑證信任'), _t`受信任（${cert.issuer}）`);
  if (cert.bits && cert.bits < 2048 && !/^(256|384|521)$/.test(String(cert.bits))) t('keysize', _t('金鑰長度'), _t`${cert.bits} 位元太短`, 'B', _t('改用 2048 位元以上的 RSA 或 ECDSA。'));
  if (versions['TLS 1.0'] || versions['TLS 1.1']) t('legacy', _t('舊版協定'), _t`仍接受 ${['TLS 1.0', 'TLS 1.1'].filter((v) => versions[v]).join(_t('、'))}`, 'B', _t('停用 TLS 1.0 / 1.1。'));
  if (!versions['TLS 1.2'] && !versions['TLS 1.3']) t('modern', _t('現代協定'), _t('不支援 TLS 1.2 或以上'), 'F', _t('啟用 TLS 1.2 與 1.3。'));
  else if (!versions['TLS 1.3']) t('tls13', _t('TLS 1.3'), _t('不支援 TLS 1.3'), 'A-', _t('啟用 TLS 1.3。'));
  else t('tls13', _t('TLS 1.3'), _t('支援'));
  if (cap === 'A+') cap = 'A'; // an A+ also needs the header side; the TLS side alone tops out at A
  return { grade: cap, tests, versions, cert: { issuer: cert.issuer, validTo: cert.validTo, daysLeft: cert.daysLeft, bits: cert.bits, chain: cert.chain, protocol: cert.protocol, cipher: clean(cert.cipher || '', 50) } };
}

export async function gradeTlsLive(host, port = 443) {
  const cert = await certInfo(host, port); if (!cert.ok) return gradeTls({}, cert);
  const versions = {}; for (const [v, label] of VERSIONS) versions[label] = (await tryVersion(host, port, v)).ok;
  return gradeTls(versions, cert);
}

export function renderSecurityMd(r) {
  const L = [BANNER, '', _t('# 安全設定評等（標頭與 TLS）'), '', _t('這是公開資訊的設定檢查，不是漏洞掃描；評等用來比較不同次的結果，不是認證。'), ''];
  L.push(_t`## 安全標頭：${r.headers.grade}（${r.headers.score} 分）`, '', `| ${_t('檢查項目')} | ${_t('分數影響')} | ${_t('結果')} | ${_t('修正方式')} |`, '|---|---|---|---|');
  for (const x of r.headers.tests) L.push(`| ${x.name} | ${x.points > 0 ? '+' : ''}${x.points} | ${String(x.result).replace(/\|/g, '/')} | ${x.fix ? String(x.fix).replace(/\|/g, '/') : '—'} |`);
  L.push('', r.tls ? _t`## TLS：${r.tls.grade ?? '—'}` : _t('## TLS'), '');
  if (!r.tls) L.push(_t('（沒有檢查：不是 HTTPS 網站，或是內部／本機位址。）'));
  else {
    if (r.tls.versions && Object.keys(r.tls.versions).length) L.push(_t('接受的協定版本：') + ' ' + Object.entries(r.tls.versions).map(([k, v]) => `${k} ${v ? '✔' : '✖'}`).join('・'), '');
    L.push(`| ${_t('檢查項目')} | ${_t('結果')} | ${_t('等級上限')} | ${_t('修正方式')} |`, '|---|---|---|---|');
    for (const x of r.tls.tests) L.push(`| ${x.name} | ${String(x.result).replace(/\|/g, '/')} | ${x.cap ?? '—'} | ${x.fix ? String(x.fix).replace(/\|/g, '/') : '—'} |`);
  }
  return L.join('\n') + '\n';
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：security-grade.mjs --site <含 site.json 的爬取資料夾> [--no-tls]')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const first = (site.pages || []).find((p) => !p.status || p.status < 400) || (site.pages || [])[0];
  if (!first) { console.error(_t('沒有可評等的頁面。')); process.exit(1); }
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'pages', first.slug, 'page.json'), 'utf8'));
  let html = ''; try { html = fs.readFileSync(path.join(dir, 'pages', first.slug, 'page.html'), 'utf8'); } catch {}
  const u = new URL(pj.url); const https = u.protocol === 'https:';
  const scripts = tagList(html).filter((t) => t.name === 'script').map((t) => ({ src: attrValue(t.attrs, 'src'), integrity: attrValue(t.attrs, 'integrity') })).filter((s) => s.src).map((s) => { try { return { src: new URL(s.src, pj.url).href, integrity: s.integrity }; } catch { return null; } }).filter(Boolean);
  const headers = gradeHeaders(pj.seo?.http?.headers || {}, { https, cookies: pj.privacy?.cookies || [], scripts, host: u.hostname });
  let tlsR = null; if (https && !isInternalHost(u.hostname) && !process.argv.includes('--no-tls')) tlsR = await gradeTlsLive(u.hostname, Number(u.port) || 443);
  const r = { url: clean(pj.url, 200), headers, tls: tlsR };
  fs.writeFileSync(path.join(dir, 'security.json'), JSON.stringify(r, null, 2)); fs.writeFileSync(path.join(dir, 'security.md'), renderSecurityMd(r));
  console.log(_t`安全設定評等：標頭 ${headers.grade}（${headers.score}）・TLS ${tlsR?.grade ?? '—'} → ${path.join(dir, 'security.md')}`);
}
