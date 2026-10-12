// HTML validity: certain errors are reported, valid and merely terse HTML is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHtml } from '../scripts/html-validity.mjs';

const ids = (h) => checkHtml(h).map((f) => f.id);
const wrap = (b, head = '<meta charset="utf-8"><title>t</title>') => `<!doctype html><html lang="en"><head>${head}</head><body>${b}</body></html>`;

test('valid documents, including optional end tags, void elements and raw-text elements, report nothing', () => {
  assert.deepEqual(ids(wrap('<ul><li>a<li>b</ul><table><tr><td>1<td>2<tr><td>3</table><p>one<p>two<br><img src=x alt=y><script>if (a<b && "<div>") {}</script><textarea><div></textarea><!-- <b> -->')), []);
  assert.deepEqual(ids(wrap('<select><option>a<option>b</select><dl><dt>t<dd>d</dl><input value="a>b"><svg><path d="M0"/></svg>')), []);
});

test('unclosed, stray and mis-nested tags', () => {
  assert.ok(ids(wrap('<div><span>text</div>')).includes('unclosed'));
  assert.ok(ids(wrap('<div>text</div></div>')).includes('stray-end-tag'));
  assert.ok(ids(wrap('<b><i>x</b></i>')).includes('unclosed'));
  assert.ok(ids('<div>no doctype').includes('no-doctype'));
});

test('duplicate ids and attributes, nested links and buttons, block in p, wrong parents, deprecated tags, late charset', () => {
  const r = checkHtml(wrap('<div id="a"></div><div id="a"></div><p class="x" class="y">q</p><a href="/1">x<a href="/2">y</a></a><button><a href="/z">go</a></button><p>para<div>box</div></p><li>orphan</li><center>c</center><font>f</font>'));
  const got = Object.fromEntries(r.map((f) => [f.id, f]));
  for (const id of ['duplicate-id', 'duplicate-attribute', 'nested-interactive', 'block-in-p', 'wrong-parent', 'deprecated-tag']) assert.ok(got[id], id + ' in ' + Object.keys(got));
  assert.match(got['duplicate-id'].examples[0], /#a ×2/); assert.equal(got['deprecated-tag'].count, 2);
  assert.ok(ids(wrap('x', '<title>' + 'a'.repeat(1200) + '</title><meta charset="utf-8">')).includes('late-charset'));
});

test('hostile or huge input finishes quickly and never throws', () => {
  const t0 = Date.now();
  checkHtml('<div '.repeat(50000)); checkHtml('<a>'.repeat(60000)); checkHtml('<'.repeat(300000)); checkHtml('<div a="'.repeat(20000)); checkHtml('<!-- ' + 'x'.repeat(100000));
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`); assert.deepEqual(checkHtml(''), [{ id: 'no-doctype', severity: 'low', message: checkHtml('')[0].message, count: 1, examples: [] }]);
});
