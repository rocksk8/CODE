// Custom extraction rules (Screaming-Frog-style): pull your own facts out of every crawled page — a price, a SKU, a schema field, a tracking id.
//   --extract rules.json   {"price": {"css": ".price"}, "sku": {"css": "[itemprop=sku]", "attr": "content"}, "order": {"regex": "order-(\\d+)", "in": "html"}}
// css rules run in the browser on the rendered page (all matches, max 50); regex rules run on the page's visible text (or its HTML with "in": "html").
// The rules file is yours, the values come from the site: values are length-limited, control characters removed, and CSV cells that could be read as
// spreadsheet formulas are neutralised. Regexes are screened for obviously catastrophic shapes, see at most 300 000 characters, and run in a sandboxed context with a 400 ms limit per rule (a rule that hits it reports #timeout-error).
import vm from 'node:vm';
import { _t } from './i18n.mjs';
import { stripControl } from './untrusted.mjs';

const NAME = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9_-]{1,40}$/;
const MAX_RULES = 30, MAX_VALUES = 50, MAX_LEN = 300, MAX_INPUT = 300000;

/** Strict parse of the rules file. Throws a readable error. */
export function parseRules(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('規則檔不是有效的 JSON。')); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(_t('規則檔必須是 {"名稱": {"css": "..."}} 這樣的物件。'));
  const names = Object.keys(j); if (!names.length || names.length > MAX_RULES) throw new Error(_t`規則數量必須是 1 到 ${MAX_RULES} 條。`);
  const rules = [];
  for (const name of names) {
    const r = j[name]; if (!NAME.test(name)) throw new Error(_t`規則名稱「${name.slice(0, 30)}」只能用英數字、底線與連字號（最多 40 字）。`);
    if (!r || typeof r !== 'object') throw new Error(_t`規則 ${name} 必須是物件。`);
    const known = ['css', 'regex', 'attr', 'in', 'all']; const extra = Object.keys(r).find((k) => !known.includes(k)); if (extra) throw new Error(_t`規則 ${name} 有不認識的欄位「${extra.slice(0, 20)}」。`);
    if ((r.css == null) === (r.regex == null)) throw new Error(_t`規則 ${name} 要有 css 或 regex 其中一個。`);
    if (r.css != null) { if (typeof r.css !== 'string' || !r.css.trim() || r.css.length > 200) throw new Error(_t`規則 ${name} 的 css 必須是 200 字以內的選擇器。`); if (r.attr != null && !/^[A-Za-z][A-Za-z0-9:_-]{0,40}$/.test(String(r.attr))) throw new Error(_t`規則 ${name} 的 attr 不是有效的屬性名稱。`); rules.push({ name, css: r.css, attr: r.attr ?? null, all: r.all !== false }); }
    else {
      if (typeof r.regex !== 'string' || !r.regex || r.regex.length > 200) throw new Error(_t`規則 ${name} 的 regex 必須是 200 字以內的字串。`);
      if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]|\(\?[=!<]|\\[1-9]/.test(r.regex)) throw new Error(_t`規則 ${name} 的 regex 含有可能造成當機的寫法（巢狀重複、環視或反向參照）。`);
      let re; try { re = new RegExp(r.regex, 'g'); } catch { throw new Error(_t`規則 ${name} 的 regex 無法解析。`); }
      if (r.in != null && !['text', 'html'].includes(r.in)) throw new Error(_t`規則 ${name} 的 in 只能是 text 或 html。`);
      rules.push({ name, regex: r.regex, in: r.in || 'text', all: r.all !== false, _re: re });
    }
  }
  return rules;
}

/** Runs in the browser: the css rules. Returns { name: { values:[...], error } }. */
export function extractCssInPage(rules) {
  const out = Object.create(null);
  for (const r of rules) {
    try {
      const els = [...document.querySelectorAll(r.css)].slice(0, r.all ? 50 : 1);
      out[r.name] = { values: els.map((e) => (r.attr ? (e.getAttribute(r.attr) ?? '') : (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 300)).filter((v) => v !== '') };
    } catch { out[r.name] = { values: [], error: 'selector' }; }
  }
  return out;
}

/** Node-side: the regex rules on text / HTML. Each rule runs in its own VM context with a time limit, so a pattern that backtracks forever is stopped (value list empty, error "timeout"). */
export function extractRegex(rules, { text = '', html = '' }) {
  const out = Object.create(null);
  for (const r of rules.filter((x) => x.regex)) {
    const src = (r.in === 'html' ? html : text).slice(0, MAX_INPUT); const max = r.all ? MAX_VALUES : 1;
    try {
      const vals = vm.runInNewContext(`(() => { const re = new RegExp(pattern, 'g'); const vals = []; let m; while ((m = re.exec(src)) && vals.length < max) { vals.push(String(m[1] ?? m[0])); if (m[0] === '') re.lastIndex++; } return vals; })()`, { pattern: r.regex, src, max }, { timeout: 400 });
      out[r.name] = { values: [...vals].map((v) => String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)).filter((v) => v !== '') };
    } catch { out[r.name] = { values: [], error: 'timeout' }; }
  }
  return out;
}

const cell = (v) => { let s = stripControl(String(v ?? '')).replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** rows = [{ url, extract: {name:{values,error}} }] → CSV with one column per rule (several values joined by " | "). */
export function toCsv(rules, rows) {
  const head = ['url', ...rules.map((r) => r.name)];
  return [head.map(cell).join(','), ...rows.map((r) => [r.url, ...rules.map((x) => (r.extract?.[x.name]?.error ? '#' + r.extract[x.name].error + '-error' : (r.extract?.[x.name]?.values || []).join(' | ')))].map(cell).join(','))].join('\n') + '\n';
}
