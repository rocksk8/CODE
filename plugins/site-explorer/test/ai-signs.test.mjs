// "Signs of AI-made?" — evidence only. The detector must be conservative: ordinary sites show nothing, builder fingerprints are strong, habits are weak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAiSigns, renderAiSignsMd, DISCLAIMER } from '../scripts/ai-signs.mjs';

const page = (o = {}) => ({ url: 'https://x.test/', status: 200, meta: {}, editing: { scripts: [] }, content: { headings: [], paragraphs: [], links: [], images: [] }, design: { cssVars: {}, backgrounds: [], textColors: [], fontFamilies: [], webFonts: [] }, ...o });

test('an ordinary site shows no signs', () => {
  const r = detectAiSigns([page({ content: { headings: [{ level: 1, text: 'Family bakery since 1952' }], paragraphs: ['We bake bread every morning and sell it until noon.'], links: [], images: [] } })]);
  assert.equal(r.level, 'none'); assert.equal(r.strong.length, 0); assert.equal(r.weak.length, 0); assert.equal(r.disclaimer, DISCLAIMER);
});

test('builder fingerprints are strong signs, with their evidence', () => {
  const r = detectAiSigns([page({ editing: { scripts: ['https://cdn.gpteng.co/gptengineer.js'] } }), page({ url: 'https://x.test/b', meta: { generator: 'Hostinger Website Builder' } }), page({ url: 'https://x.test/c', meta: { generator: 'Made with ChatGPT' } })]);
  assert.equal(r.level, 'strong');
  const ids = r.strong.map((s) => s.id).sort(); assert.deepEqual(ids, ['generator-ai', 'hostinger', 'lovable']);
  assert.ok(r.strong.find((s) => s.id === 'lovable').evidence[0].includes('gpteng.co'));
});

test('weak habits alone never make a strong claim; they need to add up before being mentioned at all', () => {
  const shadcn = Object.fromEntries(['--background', '--foreground', '--primary', '--primary-foreground', '--secondary', '--muted', '--muted-foreground', '--accent', '--border', '--radius'].map((v) => [v, '1']));
  const one = detectAiSigns([page({ design: { cssVars: shadcn, backgrounds: [], textColors: [], fontFamilies: [{ value: 'Inter, sans-serif' }], webFonts: [] } })]);
  assert.equal(one.level, 'none', 'two weak signs are not enough'); assert.equal(one.strong.length, 0); assert.equal(one.weak.length, 2);
  const many = detectAiSigns([page({
    design: { cssVars: shadcn, backgrounds: [{ value: 'rgb(99, 102, 241)' }, { value: 'rgb(139, 92, 246)' }], textColors: [], fontFamilies: [{ value: 'Inter, sans-serif' }], webFonts: [] },
    content: { headings: [{ level: 1, text: 'Unlock the power of your data' }], paragraphs: ['Elevate your workflow with seamless, cutting-edge tools. Lorem ipsum dolor sit amet.'], links: [], images: [] },
  })]);
  assert.equal(many.level, 'weak'); assert.equal(many.strong.length, 0); assert.ok(many.weak.length >= 4);
});

test('error pages are not examined; hostile text cannot break the report', () => {
  const r = detectAiSigns([page({ status: 404, editing: { scripts: ['https://cdn.gpteng.co/gptengineer.js'] } }), page({ meta: { generator: 'AI `</script><img src=x onerror=alert(1)>' } })]);
  assert.equal(r.pagesChecked, 1);
  const md = renderAiSignsMd(r);
  assert.ok(!/<img|<\/script/.test(md), md); assert.match(md, /不是判斷|not a verdict|跡象/);
  assert.match(md, /怎麼看這份結果/);
});

test('the report always carries the disclaimer and never says "AI-made" as a conclusion', () => {
  for (const pages of [[page()], [page({ editing: { scripts: ['https://cdn.gpteng.co/gptengineer.js'] } })]]) {
    const md = renderAiSignsMd(detectAiSigns(pages));
    assert.ok(md.includes(DISCLAIMER)); assert.ok(!/這個網站是 AI 做的|this site was made by AI/i.test(md));
  }
});
