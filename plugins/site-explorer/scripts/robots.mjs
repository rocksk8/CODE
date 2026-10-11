import { _t } from './i18n.mjs';
import { readCapped, gfetch } from './util.mjs';
// robots.txt parsing with Google-style semantics: UA groups, Allow/Disallow, * and $ wildcards, longest match wins (Allow wins ties).

export function parseRobots(text) {
  const out = { groups: [], sitemaps: [], issues: [], lines: 0, bytes: Buffer.byteLength(text || '') };
  let cur = null, lastWasAgent = false;
  const KNOWN = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay', 'host', 'clean-param', 'noindex']);
  const raw = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  raw.forEach((line, i) => {
    const t = line.split('#')[0].trim(); if (!t) return; out.lines++;
    const idx = t.indexOf(':');
    if (idx < 0) { out.issues.push({ line: i + 1, msg: _t`無法解析（缺少冒號）：${t.slice(0, 60)}` }); return; }
    const key = t.slice(0, idx).trim().toLowerCase(), val = t.slice(idx + 1).trim();
    if (!KNOWN.has(key)) { out.issues.push({ line: i + 1, msg: _t`未知指令：${key}` }); return; }
    if (key === 'sitemap') { out.sitemaps.push(val); return; }
    if (key === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], crawlDelay: null }; out.groups.push(cur); } if (val) cur.agents.push(val.toLowerCase()); else out.issues.push({ line: i + 1, msg: _t('User-agent 沒有值（已忽略，不會套用到任何爬蟲）') }); lastWasAgent = true; return; }
    lastWasAgent = false;
    if (!cur) { out.issues.push({ line: i + 1, msg: _t`規則出現在任何 User-agent 之前：${t.slice(0, 60)}` }); return; }
    if (key === 'allow' || key === 'disallow') cur.rules.push({ type: key, path: val });
    else if (key === 'crawl-delay') cur.crawlDelay = Number(val) || null;
    else if (key === 'noindex') out.issues.push({ line: i + 1, msg: _t('Noindex 指令在 robots.txt 中已不被 Google 支援，請改用 meta robots 或 X-Robots-Tag') });
  });
  if (out.bytes > 500 * 1024) out.issues.push({ line: 0, msg: _t`檔案 ${Math.round(out.bytes / 1024)} KiB，超過 Google 處理上限 500 KiB，超出部分會被忽略` });
  return out;
}

const encodeNonAscii = (s) => s.replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch));
const toRegex = (pat) => new RegExp('^' + encodeNonAscii(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));

/** The rules that apply to this crawler: every group naming exactly this product token (merged, as Google does), else every "*" group. */
export function groupFor(parsed, ua) {
  const token = String(ua).toLowerCase().split('/')[0].trim();
  const named = parsed.groups.filter((g) => token && g.agents.includes(token));
  const matching = named.length ? named : parsed.groups.filter((g) => g.agents.includes('*'));
  if (!matching.length) return null;
  return { agents: [...new Set(matching.flatMap((g) => g.agents))], rules: matching.flatMap((g) => g.rules), crawlDelay: matching.find((g) => g.crawlDelay)?.crawlDelay ?? null };
}

export function isAllowed(parsed, ua, pathAndQuery) {
  const g = parsed && groupFor(parsed, ua);
  if (!g) return { allowed: true, rule: null };
  let best = null;
  for (const r of g.rules) {
    if (r.path === '') continue; // "Disallow:" (empty) allows everything
    if (!toRegex(r.path).test(encodeNonAscii(pathAndQuery))) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === 'allow')) best = r;
  }
  return best ? { allowed: best.type === 'allow', rule: `${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.path}` } : { allowed: true, rule: null };
}

export async function fetchRobots(origin, ua = 'site-explorer-claude-plugin') {
  try {
    const r = await gfetch(origin + '/robots.txt', { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) });
    const text = r.ok ? await readCapped(r, 1_000_000) : '';
    // 4xx = no robots.txt (everything allowed); 5xx = cannot be verified, which crawlers must treat as "do not crawl"
    return { status: r.status, finalUrl: r.url, contentType: r.headers.get('content-type') || '', text, parsed: r.ok ? parseRobots(text) : null, serverError: r.status >= 500 };
  } catch (e) { return { status: null, error: String(e.message).slice(0, 100), text: '', parsed: null }; }
}

export const AI_BOTS = [
  ['GPTBot', _t('OpenAI（訓練）')], ['OAI-SearchBot', _t('OpenAI（搜尋）')], ['ChatGPT-User', _t('OpenAI（使用者代為瀏覽）')], ['ClaudeBot', _t('Anthropic（訓練）')], ['Claude-User', _t('Anthropic（使用者代為瀏覽）')], ['Claude-SearchBot', _t('Anthropic（搜尋）')], ['anthropic-ai', _t('Anthropic（舊）')],
  ['Google-Extended', _t('Google（Gemini 訓練）')], ['PerplexityBot', 'Perplexity'], ['Applebot-Extended', _t('Apple（AI 訓練）')], ['CCBot', 'Common Crawl'], ['Bytespider', 'ByteDance'], ['Amazonbot', 'Amazon'], ['Meta-ExternalAgent', 'Meta'], ['cohere-ai', 'Cohere'], ['Diffbot', 'Diffbot'],
];
export const SEARCH_BOTS = [['Googlebot', _t('Google 搜尋')], ['Bingbot', _t('Bing 搜尋')], ['DuckDuckBot', 'DuckDuckGo'], ['Baiduspider', _t('百度')], ['YandexBot', 'Yandex'], ['Slurp', 'Yahoo']];
