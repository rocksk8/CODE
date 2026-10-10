// What a page shows to a visitor is only part of what it delivers. These helpers record the rest:
//   attachNetworkRecorder  – every request: assets (3D models, fonts, video), API/JSON endpoints (where script-built sites keep their text), failures
//   deepContent            – visible text and elements INCLUDING open shadow roots and every frame (iframes), which innerText on the main document misses
//   ariaTree               – the accessibility tree: semantic structure (headings, links, buttons) even when the visuals are canvas
// Everything here only observes what the page already sent to this browser.

const ASSET_3D = /\.(glb|gltf|drc|ktx2?|basis|hdr|exr|obj|fbx|usdz|splat|ply)(\?|$)/i;
const FONT = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

function walkStrings(v, out, depth = 0) {
  if (out.length >= 60 || depth > 8) return;
  if (typeof v === 'string') { const s = v.trim(); if (s.length >= 12 && s.length <= 300 && /\p{L}{3,}/u.test(s) && !/^(https?:|data:|\/|#|[\w.-]+\.(png|jpe?g|svg|webp|mp4|glb|json)$)/i.test(s) && /\s/.test(s)) out.push(s); return; }
  if (Array.isArray(v)) { for (const x of v.slice(0, 200)) walkStrings(x, out, depth + 1); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v).slice(0, 200)) walkStrings(x, out, depth + 1);
}

export function attachNetworkRecorder(page) {
  const reqs = [], failed = [], jsonBodies = [];
  page.on('response', async (r) => {
    try {
      if (reqs.length >= 3000) return;
      const h = r.headers(), ct = String(h['content-type'] || '').split(';')[0].trim();
      reqs.push({ url: r.url(), status: r.status(), type: r.request().resourceType(), ct, size: Number(h['content-length']) || 0 });
      if (/json|graphql/i.test(ct) && r.status() < 400 && jsonBodies.length < 10) {
        const t = await r.text().catch(() => ''); if (t && t.length < 500000) jsonBodies.push({ url: r.url(), text: t });
      }
    } catch {}
  });
  page.on('requestfailed', (r) => { if (failed.length < 30) failed.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }); });
  return {
    summary(pageUrl) {
      let first = ''; try { first = new URL(pageUrl).host.replace(/^www\./, ''); } catch {}
      const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
      const short = (u) => { try { const x = new URL(u); return (x.host + x.pathname).slice(0, 120); } catch { return String(u).slice(0, 120); } };
      const byType = {}; for (const r of reqs) byType[r.type] = (byType[r.type] || 0) + 1;
      const hosts = {}; for (const r of reqs) { const h = host(r.url); if (h) hosts[h] = (hosts[h] || 0) + 1; }
      const thirdParty = Object.keys(hosts).filter((h) => h.replace(/^www\./, '') !== first && !h.endsWith('.' + first));
      const apis = reqs.filter((r) => /json|graphql/i.test(r.ct) || /graphql|\/api\//i.test(r.url)).slice(0, 15).map((r) => ({ url: short(r.url), status: r.status, size: r.size }));
      const strings = []; for (const j of jsonBodies) { try { walkStrings(JSON.parse(j.text), strings); } catch {} }
      const bad = reqs.filter((r) => r.status >= 400);
      return {
        total: reqs.length, byType, hosts: Object.keys(hosts).length, thirdParty: thirdParty.slice(0, 15),
        assets3d: reqs.filter((r) => ASSET_3D.test(r.url)).slice(0, 20).map((r) => ({ url: short(r.url), status: r.status, size: r.size })),
        fonts: reqs.filter((r) => FONT.test(r.url)).slice(0, 12).map((r) => short(r.url)),
        media: reqs.filter((r) => /^(video|audio)\//.test(r.ct) || r.type === 'media').slice(0, 8).map((r) => ({ url: short(r.url), status: r.status, size: r.size })),
        apis, apiTextSamples: [...new Set(strings)].slice(0, 40),
        errors: bad.slice(0, 12).map((r) => ({ url: short(r.url), status: r.status, type: r.type })), errorCount: bad.length,
        blockedLike: bad.filter((r) => r.status === 403 || r.status === 429).length,
        failed: failed.slice(0, 10).map((f) => ({ url: short(f.url), error: f.error })), failedCount: failed.length,
      };
    },
  };
}

/** Visible text + elements across the main document, open shadow roots and all frames. */
export async function deepContent(page) {
  const inFrame = () => {
    let text = 0, elements = 0, shadowHosts = 0, interactive = 0;
    const visit = (root) => {
      for (const el of root.querySelectorAll('*')) {
        elements++; if (el.matches('a[href],button,[role=button],input,select,textarea')) interactive++;
        if (el.shadowRoot) { shadowHosts++; visit(el.shadowRoot); }
      }
    };
    visit(document);
    const walk = (root) => { let n = 0; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { if (!/^(script|style|noscript)$/i.test(t.parentElement?.tagName || '')) n += t.textContent.trim().length; } for (const el of root.querySelectorAll('*')) if (el.shadowRoot) n += walk(el.shadowRoot); return n; };
    text = document.body ? walk(document.body) : 0;
    return { text, elements, shadowHosts, interactive };
  };
  const frames = [];
  for (const f of page.frames()) {
    try { const r = await f.evaluate(inFrame); frames.push({ url: String(f.url()).slice(0, 120), main: f === page.mainFrame(), ...r }); } catch {}
  }
  const sum = (k) => frames.reduce((n, f) => n + (f[k] || 0), 0);
  return { textChars: sum('text'), elements: sum('elements'), shadowHosts: sum('shadowHosts'), interactive: sum('interactive'), frames: frames.filter((f) => !f.main).slice(0, 10), frameCount: frames.length - 1, mainTextChars: frames.find((f) => f.main)?.text || 0 };
}

export async function ariaTree(page) {
  try {
    const yml = await page.locator('body').ariaSnapshot({ timeout: 8000 });
    const text = String(yml || '').slice(0, 200000);
    const count = (re) => (text.match(re) || []).length;
    return { text, lines: text ? text.split('\n').length : 0, headings: count(/^\s*- heading/gm), links: count(/^\s*- link/gm), buttons: count(/^\s*- button/gm), images: count(/^\s*- img/gm), landmarks: count(/^\s*- (banner|navigation|main|contentinfo|complementary|region)/gm) };
  } catch { return null; }
}
