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
  if (en === undefined) return tagged ? plain(first, vals) : first;
  return tagged ? fill(en, vals) : en;
}

/** The whole dictionary (for the dashboard, which runs in a browser). */
export const dictionary = () => (isEnglish ? load() : {});
export const htmlLang = () => (isEnglish ? 'en' : 'zh-Hant');
