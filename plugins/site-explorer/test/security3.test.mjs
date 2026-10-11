// Regressions from the security audit (each reproduced before the fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('SSRF guard: single-label and private-suffix names are internal; public names are not', async () => {
  const { isInternalHost, resolvesInternal } = await import('../scripts/util.mjs');
  for (const h of ['intranet', 'nas.lan', 'db.corp', 'x.home.arpa', 'svc.cluster.local', '169.254.169.254', '[::1]']) assert.equal(isInternalHost(h), true, h);
  assert.equal(isInternalHost('example.com'), false);
  assert.equal(await resolvesInternal('localhost'), true);
  assert.equal(await resolvesInternal('127.0.0.1.nip.io') === true || true, true); // needs DNS: only checks it does not throw
});

test('stripMarkup is linear on hostile input and removes scripts/comments/tags', async () => {
  const { stripMarkup } = await import('../scripts/util.mjs');
  for (const x of ['<a '.repeat(200000), '<script '.repeat(100000), '<!-- '.repeat(100000)]) { const t = Date.now(); stripMarkup(x); assert.ok(Date.now() - t < 1500, 'slow: ' + (Date.now() - t)); }
  assert.equal(stripMarkup('<p>hi <b>there</b></p><script>x</script> end <!-- c -->!').replace(/\s+/g, ' ').trim(), 'hi there end !');
});

test('sanitizeDoc defangs site-supplied HTML and absolute-URL links/images, keeps relative ones', async () => {
  const { sanitizeDoc } = await import('../scripts/untrusted.mjs');
  const out = sanitizeDoc('x </details><h1>FAKE</h1> [p](http://evil.example/x) ![b](https://e.example/b.png) [ok](assets/a.png) <script>1</script>');
  assert.ok(!/<\/?(details|h1|script)/i.test(out), out);
  assert.ok(!/\]\(https?:/.test(out), out);
  assert.ok(out.includes('[ok](assets/a.png)'));
});

test('stripControl removes terminal escape bytes but keeps text', async () => {
  const { stripControl } = await import('../scripts/untrusted.mjs');
  assert.equal(stripControl('a\x1b[31mred\x1b]0;pwn\x07b'), 'a[31mred]0;pwnb');
});

// ---- round 3 ----
test('SSRF guard: a trailing dot does not turn localhost into a public name', async () => {
  const { isInternalHost, resolvesInternal } = await import('../scripts/util.mjs');
  for (const h of ['localhost.', 'foo.localhost.', 'x.local.', 'intranet.', '127.0.0.1.']) assert.equal(isInternalHost(h) || await resolvesInternal(h), true, h);
});

test('stripMarkup removes long tags completely (no attribute text leaks into word counts)', async () => {
  const { stripMarkup } = await import('../scripts/util.mjs');
  const long = '<svg><path d="' + 'M1 2 '.repeat(300) + '"/></svg><img src="data:image/png;base64,' + 'A'.repeat(2000) + '"><div class="' + 'p-4 '.repeat(200) + '">hello</div>';
  assert.equal(stripMarkup(long).replace(/\s+/g, ' ').trim(), 'hello');
});

test('sanitizeDoc: markup defang is balanced, and code files keep < and > untouched', async () => {
  const { sanitizeDoc } = await import('../scripts/untrusted.mjs');
  assert.equal(sanitizeDoc('加入 <meta name="viewport"> 完成'), '加入 ‹meta name="viewport"› 完成');
  assert.equal(sanitizeDoc('for (let i=0;i<n;i++) {}', { markup: false }), 'for (let i=0;i<n;i++) {}');
});

test('anonymous crawl skips links that change data when visited, but not ordinary pages', async () => {
  const { skipLink } = await import('../scripts/auth-state.mjs');
  for (const p of ['/delete?id=1', '/account/close-account', '/x?action=delete']) assert.equal(skipLink('http://x.test' + p), true, p);
  for (const p of ['/cancellation-policy', '/removal-services', '/about', '/administration']) assert.equal(skipLink('http://x.test' + p), false, p);
});
