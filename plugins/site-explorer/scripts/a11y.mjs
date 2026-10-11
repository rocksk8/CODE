#!/usr/bin/env node
// a11y — accessibility check with axe-core on the pages a crawl already saved.   a11y.mjs --site <crawl dir> [--max-pages 10] [--storage-state f.json]
// Writes <crawl dir>/a11y.json; the health check turns it into the "無障礙" category. Reads only: no clicking, no forms.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, axeSource, pinnedAxe } from './launch.mjs';
import { guardInternal, isMain } from './util.mjs';
import { intOpt } from './args.mjs';
import { clean, cleanDeep } from './untrusted.mjs';
import { loadAuthState } from './auth-state.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const IMPACT_TO_SEVERITY = { critical: 'high', serious: 'medium', moderate: 'low', minor: 'low' };

/** Run axe on one page that is already open. Returns a compact, sanitised result (no page text beyond short element snippets). */
export async function auditPage(page, axe) {
  await page.evaluate(axe); // CDP evaluate: works under a strict Content-Security-Policy too
  const r = await page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'], elementRef: false });
    const pick = (v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags.filter((t) => /^wcag\d+[a]*$|^wcag2|^best/.test(t)).slice(0, 6), nodes: v.nodes.length, examples: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' ').slice(0, 160), html: (n.html || '').slice(0, 160) })) });
    return { axeVersion: res.testEngine?.version, violations: res.violations.map(pick), incomplete: res.incomplete.length, passes: res.passes.length };
  }, TAGS);
  const suspects = [];
  return { ...cleanDeep(r, 'a11y', suspects, { max: 200, skip: [] }), injectionSuspects: suspects.length }; // snippets are the site's own text: sanitised, injection quarantined
}

export async function runA11y(siteDir, { maxPages = 10, storageState = null } = {}) {
  const site = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
  const targets = site.pages.filter((p) => (!p.status || p.status < 400) && !p.blocked).slice(0, maxPages);
  const axe = axeSource();
  const auth = storageState ? loadAuthState(storageState) : null;
  const browser = await launchBrowser();
  const pages = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(auth ? { storageState: auth.file } : {}) });
    await guardInternal(ctx, site.startUrl);
    for (const t of targets) {
      const page = await ctx.newPage();
      try {
        await page.goto(t.url, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(500);
        pages.push({ url: clean(t.url, 300), slug: t.slug, ...(await auditPage(page, axe)) });
      } catch (e) { pages.push({ url: clean(t.url, 300), slug: t.slug, error: clean(String(e.message).split('\n')[0], 160) }); }
      finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close(); }
  const ok = pages.filter((p) => !p.error);
  const byId = new Map();
  for (const p of ok) for (const v of p.violations) { const e = byId.get(v.id) || { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, pages: 0, nodes: 0, examples: [] }; e.pages++; e.nodes += v.nodes; for (const x of v.examples) if (e.examples.length < 3) e.examples.push({ ...x, page: p.url }); byId.set(v.id, e); }
  const result = { schemaVersion: 1, engine: 'axe-core', axeVersion: ok.find((p) => p.axeVersion)?.axeVersion || pinnedAxe(), standard: _t('WCAG 2.2 AA（自動檢查只能發現一部分問題，仍需人工檢查）'), checkedAt: new Date().toISOString(), pagesChecked: ok.length, pagesFailed: pages.length - ok.length, authenticated: !!auth, pages, rules: [...byId.values()].sort((a, b) => ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impact) || b.pages - a.pages) };
  fs.writeFileSync(path.join(siteDir, 'a11y.json'), JSON.stringify(result, null, 2));
  return result;
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const i = a.indexOf('--site'); const j = a.indexOf('--storage-state');
  if (i < 0 || !a[i + 1] || !fs.existsSync(path.join(a[i + 1], 'site.json'))) { console.error(_t('用法：a11y.mjs --site <含 site.json 的爬取資料夾> [--max-pages 10] [--storage-state f.json]')); process.exit(1); }
  try {
    const r = await runA11y(path.resolve(a[i + 1]), { maxPages: intOpt(a, 'max-pages', 10, { min: 1, max: 100 }), storageState: j >= 0 ? a[j + 1] : null });
    const sev = (k) => r.rules.filter((x) => x.impact === k).length;
    console.log(_t`無障礙（axe-core ${r.axeVersion}）：檢查 ${r.pagesChecked} 頁，${r.rules.length} 種違規（嚴重 ${sev('critical')}、重要 ${sev('serious')}、中等 ${sev('moderate')}、輕微 ${sev('minor')}）${r.pagesFailed ? _t`；${r.pagesFailed} 頁無法檢查` : ''}`);
  } catch (e) { console.error('✖ ' + e.message); process.exit(1); }
}
