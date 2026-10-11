// Output language. Source strings in this code base are Traditional Chinese; every one of them goes through _t(), so the same run can speak English:
//   site-explorer <url> --lang en      (or SITE_EXPLORER_LANG=en)
// _t('中文') / _t`中文 ${value}` returns the English text from i18n/en.json when the language is English, otherwise the original.
// Placeholders in a translation: {} = next value, {0} {1}… = a specific value (so word order can change). Untranslated text falls back to the original.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const fromArgv = (() => { const a = process.argv; for (let i = 0; i < a.length; i++) { if (a[i] === '--lang' && a[i + 1]) return a[i + 1]; if (a[i].startsWith('--lang=')) return a[i].slice(7); } return null; })();
const raw = String(fromArgv || process.env.SITE_EXPLORER_LANG || 'zh').toLowerCase();
export const LANG = /^en/.test(raw) ? 'en' : 'zh';
export const isEnglish = LANG === 'en';

let dict = null;
const load = () => { if (dict) return dict; try { dict = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./i18n/en.json', import.meta.url)), 'utf8')); } catch { dict = {}; } return dict; };

const fill = (tpl, vals) => { let n = 0; return tpl.replace(/\{(\d*)\}/g, (m, i) => { const k = i === '' ? n++ : Number(i); return k < vals.length ? String(vals[k]) : m; }); };
const plain = (strs, vals) => strs.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

/** Translate. Plain call: _t('中文'). Tagged template: _t`共 ${n} 頁`. */
export function _t(first, ...vals) {
  const tagged = Array.isArray(first);
  if (!isEnglish) return tagged ? plain(first, vals) : first;
  const key = tagged ? first.join('{}') : first;
  const en = load()[key];
  if (en === undefined) { // untranslated: fall back to the original, and (for the test suite) record it
    if (process.env.SITE_EXPLORER_I18N_TRACE && /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(key)) { try { fs.appendFileSync(process.env.SITE_EXPLORER_I18N_TRACE, JSON.stringify(key) + '\n'); } catch {} }
    return tagged ? plain(first, vals) : first;
  }
  return tagged ? fill(en, vals) : en;
}

/** The whole dictionary (for the dashboard, which runs in a browser). */
export const dictionary = () => (isEnglish ? load() : {});
export const htmlLang = () => (isEnglish ? 'en' : 'zh-Hant');

/** Section-pattern reasons come from code that runs inside the browser page (no translator there), so they are translated where they are shown. */
export const WHY_KEYS = ['頁首標籤／頂部導覽', '頁尾標籤／底部大量連結', '首屏大標題＋按鈕或媒體', '價格字樣與重複方案', '引言或客戶見證', '展開式問答', '表單欄位', '多張小圖且文字少', '多個數字', '多張圖片', '頁尾附近的短文＋按鈕', '未符合特定版型', '重複 {} 個卡片'];
export const whyText = (s) => { const m = /^重複 (\d+) 個卡片$/.exec(String(s ?? '')); return m ? _t`重複 ${m[1]} 個卡片` : _t(String(s ?? '')); };
