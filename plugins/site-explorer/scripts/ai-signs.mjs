#!/usr/bin/env node
// "Does this site show signs of being made with AI?" — evidence only, never a verdict.
// Nobody can tell for sure from the outside: people use AI site builders and write by hand, and text-based "AI detectors" are known to be unreliable.
// So this reports (1) STRONG signs: fingerprints that AI site-building tools leave in the page (a script, a generator tag, a template image), and
// (2) WEAK signs: design and wording habits that are common in AI output but also common in human work. It always says which is which and why it cannot prove anything.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

const TOOLS = [ // [id, label, test(url-or-text)]
  ['lovable', 'Lovable / GPT Engineer', /cdn\.gpteng\.co|gptengineer\.js|lovable\.dev|\.lovable\.app/i],
  ['bolt', 'Bolt (StackBlitz)', /bolt\.new|\.bolt\.host/i],
  ['v0', 'v0 (Vercel)', /\bv0\.(dev|app)\b/i],
  ['hostinger', 'Hostinger Website Builder', /hostinger website builder/i],
  ['durable', 'Durable', /durable\.co/i],
];
const GEN_MENTIONS_AI = /\b(ai|chatgpt|openai|gpt-?\d?|claude|gemini|copilot)\b/i;
const SHADCN_VARS = ['--background', '--foreground', '--primary', '--primary-foreground', '--secondary', '--muted', '--muted-foreground', '--accent', '--destructive', '--border', '--input', '--ring', '--radius'];
const PLACEHOLDER = /lorem ipsum|\byour company\b|\bacme inc\b|\bcompany name\b|\bjohn doe\b|\bjane doe\b|\byour (name|brand|business) here\b/i;
const BUZZ = ['unlock the power', 'elevate your', 'seamless', 'revolutionize', 'cutting-edge', 'game-changer', 'in today\'s fast-paced', 'to the next level', 'empower', 'leverage', 'streamline', 'harness the power', 'transform your', 'delve', 'tapestry', 'ever-evolving', 'navigate the complexities'];
const EMOJI = /^\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u;
const PURPLE = /#(6366f1|8b5cf6|a855f7|7c3aed|9333ea|d946ef|ec4899)\b/i;

export const DISCLAIMER = _t('這只是「跡象」，不是判斷：用 AI 建站工具做的網站可以是人工調整過的，人手寫的網站也可能長得像 AI 的產出；文字型的「AI 偵測」本來就不可靠，不要拿它指控任何人。');

const uniq = (a) => [...new Set(a)];

/** pages = the page.json objects of a crawl. Returns { level, strong[], weak[], disclaimer, pagesChecked }. Pure and offline. */
export function detectAiSigns(pages) {
  const strong = [], weak = [];
  const add = (list, id, label, evidence, count = 1) => list.push({ id, label, evidence: uniq(evidence).slice(0, 3).map((e) => clean(String(e), 140)), pages: count });
  const live = (pages || []).filter((p) => p && (!p.status || p.status < 400));
  const urlsOf = (p) => [p.meta?.generator, p.meta?.ogImage, ...(p.editing?.scripts || []), ...(p.content?.images || []).map((i) => i.src), ...(p.content?.links || []).map((l) => l.href), ...(p.design?.webFonts || []), p.url].filter(Boolean).map(String);

  // ---- strong: fingerprints of AI site-building tools
  for (const [id, label, re] of TOOLS) {
    const hit = live.filter((p) => urlsOf(p).some((u) => re.test(u)));
    if (hit.length) add(strong, id, label, hit.flatMap((p) => urlsOf(p).filter((u) => re.test(u))), hit.length);
  }
  const genAi = live.filter((p) => GEN_MENTIONS_AI.test(String(p.meta?.generator || '')));
  if (genAi.length) add(strong, 'generator-ai', 'generator', genAi.map((p) => p.meta.generator), genAi.length);

  // ---- weak: habits
  const vars = new Set(live.flatMap((p) => Object.keys(p.design?.cssVars || {})));
  const shad = SHADCN_VARS.filter((v) => vars.has(v));
  if (shad.length >= 8) add(weak, 'shadcn-defaults', 'shadcn/ui', [`${shad.length}/${SHADCN_VARS.length} default CSS variables`], 1);
  const colours = live.flatMap((p) => [...(p.design?.backgrounds || []), ...(p.design?.textColors || [])].map((c) => hexOf(c.value)));
  const purple = uniq(colours.filter((h) => h && PURPLE.test(h)));
  if (purple.length >= 2) add(weak, 'purple-gradient', 'indigo/purple palette', purple, 1);
  const fonts = (live[0]?.design?.fontFamilies || []).map((f) => String(f.value).toLowerCase());
  if (fonts[0] && /^"?inter\b/.test(fonts[0])) add(weak, 'inter-font', 'Inter', [live[0].design.fontFamilies[0].value], 1);
  const texts = live.map((p) => [...(p.content?.headings || []).map((h) => h.text), ...(p.content?.paragraphs || [])].join(' \n '));
  const ph = live.filter((p, i) => PLACEHOLDER.test(texts[i]));
  if (ph.length) add(weak, 'placeholder-text', 'placeholder text', ph.map((p) => (texts[live.indexOf(p)].match(PLACEHOLDER) || [''])[0]), ph.length);
  const all = texts.join(' \n ').toLowerCase();
  const buzz = BUZZ.filter((b) => all.includes(b));
  if (buzz.length >= 4) add(weak, 'buzzwords', 'stock marketing phrases', buzz.slice(0, 5), 1);
  const emojiHeads = live.reduce((n, p) => n + (p.content?.headings || []).filter((h) => EMOJI.test(h.text)).length, 0);
  if (emojiHeads >= 4) add(weak, 'emoji-headings', 'emoji-led headings', [`${emojiHeads} headings`], 1);
  const words = all.split(/\s+/).filter(Boolean).length, dashes = (all.match(/—/g) || []).length;
  if (words >= 300 && dashes / words > 1 / 80) add(weak, 'em-dashes', 'em dashes', [`${dashes} in ${words} words`], 1);

  const level = strong.length ? 'strong' : weak.length >= 3 ? 'weak' : 'none';
  return { level, strong, weak, pagesChecked: live.length, disclaimer: DISCLAIMER };
}

function hexOf(v) { const m = String(v).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : /^#[0-9a-f]{6}$/i.test(v) ? v : null; }

const LEVEL = () => ({ none: _t('沒有發現明顯跡象'), weak: _t('有幾項弱跡象（不足以判斷）'), strong: _t('有 AI 建站工具的明確痕跡') });
const TITLE = () => ({
  lovable: _t('頁面載入了 Lovable／GPT Engineer 的腳本或範本資源'), bolt: _t('頁面引用了 Bolt 的資源或網域'), v0: _t('頁面標示 v0（Vercel）'), hostinger: _t('generator 標示為 Hostinger Website Builder（該工具提供 AI 建站）'), durable: _t('頁面引用了 Durable（AI 建站服務）'),
  'generator-ai': _t('generator 標籤直接提到 AI'),
  'shadcn-defaults': _t('使用 shadcn/ui 預設的 CSS 變數（許多人類工程師也用）'), 'purple-gradient': _t('用了靛／紫色系（常見的 AI 範本配色，也常見於人工設計）'), 'inter-font': _t('主要字型是 Inter（極為常見）'),
  'placeholder-text': _t('文字裡有範本留下的佔位字（Lorem ipsum、Your Company…）'), buzzwords: _t('多句常見的行銷套話（unlock the power、seamless…）'), 'emoji-headings': _t('多個標題以表情符號開頭'), 'em-dashes': _t('破折號密度偏高'),
});

export function renderAiSignsMd(r) {
  const T = TITLE();
  const L = [BANNER, '', _t('# 這個網站有 AI 製作的跡象嗎？'), '', `**${LEVEL()[r.level]}**${_t('（')}${_t`檢查了 ${r.pagesChecked} 頁`}${_t('）')}`, '', `> ${r.disclaimer}`, ''];
  L.push(_t('## 強跡象（建站工具留下的痕跡）'), '');
  L.push(...(r.strong.length ? r.strong.map((s) => `- ${T[s.id] || s.label}${s.evidence.length ? `${_t('：')}\`${s.evidence.join('`' + _t('、') + '`')}\`` : ''}${s.pages > 1 ? _t`（${s.pages} 頁）` : ''}`) : [_t('（沒有）')]));
  L.push('', _t('## 弱跡象（常見於 AI 產出，但人工作品也常見）'), '');
  L.push(...(r.weak.length ? r.weak.map((s) => `- ${T[s.id] || s.label}${s.evidence.length ? `${_t('：')}${s.evidence.join(_t('、'))}` : ''}`) : [_t('（沒有）')]));
  L.push('', _t('## 怎麼看這份結果'), '', _t('- 強跡象只代表「用過這類工具」，不代表內容全由 AI 生成，也不代表沒有人修改過。'), _t('- 弱跡象單獨出現沒有意義；只有多項同時出現時才值得多看一眼，而且仍然不是證據。'), _t('- 沒有跡象也不代表不是 AI 做的：工具可以刪掉標記，作者也可以改寫。'), '');
  return L.join('\n');
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：ai-signs.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const pages = (site.pages || []).map((p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const r = detectAiSigns(pages);
  fs.writeFileSync(path.join(dir, 'ai-signs.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(dir, 'ai-signs.md'), renderAiSignsMd(r) + '\n');
  console.log(_t`AI 製作跡象：${LEVEL()[r.level]}（強 ${r.strong.length}・弱 ${r.weak.length}；只是跡象，不是判斷）→ ${path.join(dir, 'ai-signs.md')}`);
}
