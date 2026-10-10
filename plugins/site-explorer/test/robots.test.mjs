import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, groupFor } from '../scripts/robots.mjs';

const R = (t) => parseRobots(t);
test('longest match wins and Allow beats Disallow on ties', () => {
  const p = R('User-agent: *\nDisallow: /\nAllow: /public/\nDisallow: /public/private\nAllow: /public/private/ok');
  assert.equal(isAllowed(p, 'x', '/').allowed, false);
  assert.equal(isAllowed(p, 'x', '/public/a').allowed, true);
  assert.equal(isAllowed(p, 'x', '/public/private/a').allowed, false);
  assert.equal(isAllowed(p, 'x', '/public/private/ok/z').allowed, true);
  assert.equal(isAllowed(R('User-agent: *\nDisallow: /a\nAllow: /a'), 'x', '/a').allowed, true, 'tie -> Allow');
});
test('wildcards and end anchors', () => {
  const p = R('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\nDisallow: /*?session=');
  assert.equal(isAllowed(p, 'x', '/files/a.pdf').allowed, false);
  assert.equal(isAllowed(p, 'x', '/files/a.pdf?x=1').allowed, true, '$ anchors the end');
  assert.equal(isAllowed(p, 'x', '/tmp123/cache').allowed, false);
  assert.equal(isAllowed(p, 'x', '/page?session=9').allowed, false);
  assert.equal(isAllowed(p, 'x', '/page').allowed, true);
});
test('the most specific user-agent group applies, not "*"', () => {
  const p = R('User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /');
  assert.equal(isAllowed(p, 'GPTBot', '/x').allowed, false);
  assert.equal(isAllowed(p, 'claudebot/1.0', '/x').allowed, false, 'case-insensitive substring match with version');
  assert.equal(isAllowed(p, 'Googlebot', '/private').allowed, true, 'Googlebot group has no Disallow, so "*" rules do not apply');
  assert.equal(isAllowed(p, 'SomeOtherBot', '/private').allowed, false);
  assert.equal(isAllowed(p, 'SomeOtherBot', '/ok').allowed, true);
});
test('empty Disallow allows everything; missing robots allows everything', () => {
  assert.equal(isAllowed(R('User-agent: *\nDisallow:'), 'x', '/anything').allowed, true);
  assert.equal(isAllowed(null, 'x', '/anything').allowed, true);
  assert.equal(groupFor(R('User-agent: a\nDisallow: /'), 'b'), null);
});
test('reports syntax problems and collects sitemaps', () => {
  const p = R('﻿Foo bar\nDisallow: /early\nUser-agent: *\nNoindex: /x\nCrawl-delay: 5\nBogus: 1\nSitemap: https://a.com/s.xml # c');
  const msgs = p.issues.map((i) => i.msg).join('|');
  assert.match(msgs, /缺少冒號/); assert.match(msgs, /任何 User-agent 之前/); assert.match(msgs, /Noindex/); assert.match(msgs, /未知指令：bogus/);
  assert.deepEqual(p.sitemaps, ['https://a.com/s.xml']);
  assert.equal(p.groups[0].crawlDelay, 5);
});
