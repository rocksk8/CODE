// Visual-test scenarios (BackstopJS-style): a named page state — open a path, click / hover / scroll / type / wait, hide the parts that always change, take a screenshot.
//   --scenarios scenarios.json     [{ "name": "menu-open", "path": "/", "viewport": {"width": 390, "height": 800}, "steps": [{"click": "button.menu"}, {"wait": 400}],
//                                      "hide": [".clock", ".ad"], "selector": "header" }]
// The shots are stored with --approve and compared with --compare together with the whole-page screenshots.
// Safety: scenarios only ever run on the explored site's own origin, every non-GET request is blocked while they run (nothing can be submitted or bought),
// keys are limited to navigation keys (no Enter), and everything the file contains is validated before the browser starts.
import fs from 'node:fs';
import path from 'node:path';
import { _t } from './i18n.mjs';

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SEL = /^[^{};<>@\\]{1,200}$/;
const KEYS = new Set(['Tab', 'Shift+Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp', 'Space']);

export function parseScenarios(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('情境檔不是有效的 JSON。')); }
  if (!Array.isArray(j) || !j.length || j.length > 30) throw new Error(_t('情境檔必須是 1 到 30 個情境的陣列。'));
  const seen = new Set();
  return j.map((s, i) => {
    const n = i + 1; if (!s || typeof s !== 'object') throw new Error(_t`第 ${n} 個情境必須是物件。`);
    if (!NAME.test(String(s.name || ''))) throw new Error(_t`第 ${n} 個情境的 name 只能用小寫英數字、底線與連字號（最多 40 字）。`);
    if (seen.has(s.name)) throw new Error(_t`情境名稱重複：${s.name}`); seen.add(s.name);
    const p = s.path ?? '/'; if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.length > 300) throw new Error(_t`情境 ${s.name} 的 path 必須是以 / 開頭的站內路徑。`);
    const vp = s.viewport ?? {}; const w = vp.width ?? 1440, h = vp.height ?? 900;
    if (!(Number.isInteger(w) && w >= 280 && w <= 2560 && Number.isInteger(h) && h >= 280 && h <= 2000)) throw new Error(_t`情境 ${s.name} 的 viewport 寬 280–2560、高 280–2000。`);
    const sel = (v, what) => { if (typeof v !== 'string' || !SEL.test(v)) throw new Error(_t`情境 ${s.name} 的 ${what} 必須是 200 字以內的 CSS 選擇器（不能含 { } ; < > @ \\）。`); return v; };
    const steps = (s.steps ?? []).map((st, k) => {
      if (!st || typeof st !== 'object' || Array.isArray(st) || Object.keys(st).length !== 1) throw new Error(_t`情境 ${s.name} 的第 ${k + 1} 個步驟必須恰好有一個動作。`);
      const [act, v] = Object.entries(st)[0];
      if (act === 'click' || act === 'hover') return { act, sel: sel(v, act) };
      if (act === 'scroll') return typeof v === 'number' && v >= 0 && v <= 100000 ? { act, y: v } : { act, sel: sel(v, 'scroll') };
      if (act === 'wait') { if (!(Number.isFinite(v) && v >= 0 && v <= 5000)) throw new Error(_t`情境 ${s.name} 的 wait 必須是 0–5000 毫秒。`); return { act, ms: v }; }
      if (act === 'type') { if (!v || typeof v.text !== 'string' || v.text.length > 100) throw new Error(_t`情境 ${s.name} 的 type 需要 {"selector": "...", "text": "..."}（文字最多 100 字）。`); return { act, sel: sel(v.selector, 'type'), text: v.text }; }
      if (act === 'select') { if (!v || typeof v.value !== 'string' || v.value.length > 100) throw new Error(_t`情境 ${s.name} 的 select 需要 {"selector": "...", "value": "..."}。`); return { act, sel: sel(v.selector, 'select'), value: v.value }; }
      if (act === 'press') { if (!KEYS.has(v)) throw new Error(_t`情境 ${s.name} 的 press 只能用：${[...KEYS].join(', ')}（不含 Enter）。`); return { act, key: v }; }
      throw new Error(_t`情境 ${s.name} 有不認得的動作「${String(act).slice(0, 20)}」。`);
    });
    if (steps.length > 20) throw new Error(_t`情境 ${s.name} 最多 20 個步驟。`);
    const hide = (s.hide ?? []).map((x) => sel(x, 'hide')); if (hide.length > 20) throw new Error(_t`情境 ${s.name} 的 hide 最多 20 個。`);
    return { name: s.name, path: p, viewport: { width: w, height: h }, steps, hide, selector: s.selector == null ? null : sel(s.selector, 'selector') };
  });
}

/** ctx = a Playwright browser context that already has the safety guards. Writes <outDir>/scenarios/<name>.png and returns [{ name, path, file, error? }]. */
export async function runScenarios(ctx, startUrl, scenarios, outDir, { log = () => {} } = {}) {
  const dir = path.join(outDir, 'scenarios'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const origin = new URL(startUrl).origin, results = [];
  for (const sc of scenarios) {
    const page = await ctx.newPage(); const row = { name: sc.name, path: sc.path, file: null, error: null, blockedWrites: 0 };
    try {
      await page.setViewportSize(sc.viewport);
      await page.route('**/*', (route) => { const rq = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(rq.method())) return route.fallback(); row.blockedWrites++; return route.abort('blockedbyclient'); });
      await page.goto(new URL(sc.path, origin).href, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(500);
      for (const st of sc.steps) {
        try {
          if (st.act === 'click') await page.locator(st.sel).first().click({ timeout: 5000 });
          else if (st.act === 'hover') await page.locator(st.sel).first().hover({ timeout: 5000 });
          else if (st.act === 'scroll') { if (st.sel) await page.locator(st.sel).first().scrollIntoViewIfNeeded({ timeout: 5000 }); else await page.evaluate((y) => window.scrollTo(0, y), st.y); }
          else if (st.act === 'wait') await page.waitForTimeout(st.ms);
          else if (st.act === 'type') await page.locator(st.sel).first().fill(st.text, { timeout: 5000 });
          else if (st.act === 'select') await page.locator(st.sel).first().selectOption(st.value, { timeout: 5000 });
          else if (st.act === 'press') await page.keyboard.press(st.key);
          await page.waitForTimeout(150);
        } catch (e) { row.error = _t`步驟「${st.act}」失敗：${String(e.message).split('\n')[0].slice(0, 80)}`; break; }
      }
      if (sc.hide.length) await page.addStyleTag({ content: sc.hide.map((s) => `${s}{visibility:hidden !important}`).join('\n') });
      const file = path.join(dir, sc.name + '.png');
      if (sc.selector) await page.locator(sc.selector).first().screenshot({ path: file, timeout: 8000 }); else await page.screenshot({ path: file, fullPage: true, timeout: 20000 });
      row.file = `scenarios/${sc.name}.png`;
    } catch (e) { row.error = row.error || String(e.message).split('\n')[0].slice(0, 100); }
    finally { await page.close().catch(() => {}); }
    log(row); results.push(row);
  }
  return results;
}
