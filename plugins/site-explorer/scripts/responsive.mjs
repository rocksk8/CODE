// How the page behaves at desktop / tablet / phone widths — measured, not guessed: navigation style, columns, type size, overflow, hidden content.
// extractResponsiveInPage runs inside the browser at the CURRENT viewport; the rest are plain helpers for reports.
import { _t } from './i18n.mjs';

/** Run in the page. Self-contained (it is serialised into the browser). */
export function extractResponsiveInPage() {
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const W = innerWidth;
  // navigation: are the links visible, or tucked behind a menu button?
  const navRoot = document.querySelector('header nav, nav, [role=navigation], header');
  const navLinks = navRoot ? [...navRoot.querySelectorAll('a[href]')].filter(shown).length : 0;
  const toggleRe = /(menu|nav|burger|hamburger|toggle|drawer|選單|目錄|導覽)/i;
  const lookToggle = (el) => toggleRe.test((el.getAttribute('aria-label') || '') + ' ' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.id || '') + ' ' + (el.innerText || '').slice(0, 20));
  const toggles = [...document.querySelectorAll('button,[role=button],[aria-expanded],[aria-controls],label[for]')].filter((el) => shown(el) && (lookToggle(el) || el.hasAttribute('aria-expanded')));
  if (!toggles.length) { // a hamburger is often a <div>/<span>/<i> with a click handler, not a <button>: small, clickable, named like a menu
    for (const el of [...document.querySelectorAll('[class*=menu i],[class*=burger i],[class*=toggle i],[class*=nav-icon i],[id*=menu i],[id*=burger i],[onclick]')].slice(0, 200)) {
      if (!shown(el) || el.closest('nav a, nav ul') || (!lookToggle(el) && !(el.hasAttribute('onclick') && el.closest('header, [role=banner], nav')))) continue; // unnamed click handlers only count inside the header
      const r = el.getBoundingClientRect(); if (r.width > 120 || r.height > 120) continue;
      const cs = getComputedStyle(el); if (cs.cursor === 'pointer' || el.hasAttribute('onclick') || el.querySelector('svg,i,span')) { toggles.push(el); break; }
    }
  }
  const nav = navLinks >= 2 ? 'links' : toggles.length ? 'toggle' : navRoot ? 'hidden' : 'none';
  // columns: distinct left edges among the visible children of grid / flex rows
  let multi = 0, maxCols = 0; const cols = [];
  for (const el of [...document.querySelectorAll('body *')].slice(0, 1500)) {
    const cs = getComputedStyle(el); if (cs.display !== 'grid' && cs.display !== 'flex' && cs.display !== 'inline-flex' && cs.display !== 'inline-grid') continue;
    if (cs.display.endsWith('flex') && cs.flexDirection.startsWith('column')) continue;
    const kids = [...el.children].filter(shown).filter((k) => k.getBoundingClientRect().width > 60); if (kids.length < 2) continue;
    const top0 = kids[0].getBoundingClientRect().top; const row = kids.filter((k) => Math.abs(k.getBoundingClientRect().top - top0) < 24);
    const n = new Set(row.map((k) => Math.round(k.getBoundingClientRect().left / 8))).size; if (n < 2) continue;
    multi++; cols.push(n); if (n > maxCols) maxCols = n;
  }
  const px = (el) => (el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null);
  const h1 = document.querySelector('h1'), p = [...document.querySelectorAll('main p, article p, p')].find((e) => (e.innerText || '').trim().length > 40);
  let wide = 0; for (const img of [...document.images].slice(0, 200)) if (shown(img) && img.getBoundingClientRect().width > W + 1) wide++;
  const textChars = (document.body && document.body.innerText || '').replace(/\s+/g, '').length;
  return { width: W, overflowX: document.documentElement.scrollWidth > W + 1, overflowPx: Math.max(0, document.documentElement.scrollWidth - W), nav, navLinks, hasToggle: toggles.length > 0, maxColumns: maxCols, multiColumnBlocks: multi, h1Px: px(h1), bodyPx: px(p), wideImages: wide, textChars };
}

const NAV = { links: _t('連結直接顯示'), toggle: _t('收進選單按鈕'), hidden: _t('連結被隱藏且找不到選單按鈕'), none: _t('沒有導覽列') };
export const navLabel = (n) => NAV[n] || n || '—';

/** { desktop, tablet, mobile } -> findings a human / AI can act on */
export function responsiveFindings(r) {
  if (!r || !r.desktop || !r.mobile) return [];
  const d = r.desktop, t = r.tablet, m = r.mobile, out = [];
  if (t && t.overflowX) out.push({ id: 'tablet-overflow', text: _t`平板寬度（${t.width}px）出現橫向捲動，超出 ${t.overflowPx}px` });
  if (d.navLinks >= 3 && m.nav === 'hidden') out.push({ id: 'mobile-nav-missing', text: _t`桌機有 ${d.navLinks} 個導覽連結，手機寬度卻被隱藏、也找不到選單按鈕` });
  if (m.maxColumns >= 3) out.push({ id: 'mobile-columns', text: _t`手機寬度仍並排 ${m.maxColumns} 欄，內容會被擠壓` });
  if (m.wideImages > 0) out.push({ id: 'mobile-wide-images', text: _t`${m.wideImages} 張圖片比手機螢幕還寬` });
  if (d.textChars > 400 && m.textChars < d.textChars * 0.6) out.push({ id: 'mobile-content-hidden', text: _t`手機版的文字量只有桌機的 ${Math.round((m.textChars / d.textChars) * 100)}%（${m.textChars} vs ${d.textChars} 字）` });
  return out;
}

/** one line for briefs: "4 欄 → 2 欄 → 1 欄；導覽：連結直接顯示 → 收進選單按鈕" */
export function responsiveLine(r) {
  if (!r || !r.desktop) return '';
  const seq = ['desktop', 'tablet', 'mobile'].filter((k) => r[k]);
  const cols = seq.map((k) => (r[k].maxColumns > 1 ? r[k].maxColumns + _t(' 欄') : _t('單欄'))).join(' → ');
  const nav = seq.map((k) => navLabel(r[k].nav)).filter((x, i, a) => i === 0 || x !== a[i - 1]).join(' → ');
  return _t`${seq.map((k) => r[k].width + 'px').join(_t('／'))}：最多並排 ${cols}；導覽：${nav}；標題字級 ${seq.map((k) => r[k].h1Px ?? '—').join(_t('／'))}px`;
}

export function responsiveMarkdown(r) {
  if (!r || !r.desktop) return [];
  const names = { desktop: _t('桌機'), tablet: _t('平板'), mobile: _t('手機') }, ks = ['desktop', 'tablet', 'mobile'].filter((k) => r[k]);
  const L = [_t('| 項目 | ') + ks.map((k) => `${names[k]} ${r[k].width}px`).join(' | ') + ' |', '|---|' + ks.map(() => '---').join('|') + '|'];
  const row = (label, f) => L.push(`| ${label} | ${ks.map((k) => f(r[k])).join(' | ')} |`);
  row(_t('導覽'), (x) => _t`${navLabel(x.nav)}（可見連結 ${x.navLinks}）`); row(_t('並排欄數（最多）'), (x) => (x.maxColumns > 1 ? x.maxColumns : _t('單欄'))); row(_t('h1／內文字級 px'), (x) => _t`${x.h1Px ?? '—'}／${x.bodyPx ?? '—'}`);
  row(_t('橫向溢出'), (x) => (x.overflowX ? _t`⚠️ 是（+${x.overflowPx}px）` : _t('否'))); row(_t('可見文字量'), (x) => x.textChars);
  const f = responsiveFindings(r); if (f.length) L.push('', ...f.map((x) => `- ⚠️ ${x.text}`));
  return L;
}
