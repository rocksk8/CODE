// A site full of edge cases that real crawlers meet. Used by test/regressions.test.mjs.
import zlib from 'node:zlib';
const html = (b, title = 'T') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"></head><body>${b}</body></html>`;
const words = '<p>' + 'word '.repeat(90) + '</p>';
export function edgeSite({ origin = () => 'http://localhost' } = {}) {
  return (q, r) => {
    const u = q.url.split('?')[0], send = (c, b, t = 'text/html; charset=utf-8', h = {}) => { r.writeHead(c, { 'content-type': t, ...h }); r.end(b); };
    const O = origin();
    if (u === '/robots.txt') return send(200, `User-agent: *\nDisallow: /new\nSitemap: ${O}/sm.xml.gz\n`, 'text/plain');
    // gzip sitemap, with the awkward-but-legal shapes: CDATA, namespace prefix, lastmod before loc, image:loc first, entities
    if (u === '/sm.xml.gz') return send(200, zlib.gzipSync(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><lastmod>2026-01-01</lastmod><loc>${O}/</loc></url><url a="b"><image:image><image:loc>${O}/img.png</image:loc></image:image><loc><![CDATA[${O}/docs/]]></loc></url><url><loc>${O}/search?a=1&#38;b=2</loc></url></urlset>`), 'application/gzip');
    if (u === '/') return send(200, html('<h1>Home</h1>' + words + '<svg width=40 height=40><a href="/svgpage"><text y=20>hi</text></a></svg><svg width=40 height=40><g role="button"><rect width=40 height=40/></g></svg><a href="/docs/">docs</a> <a href="/doc.json">json</a> <a href="/file.pdfx">pdf</a> <a href="/old">old</a> <a href="/color">color</a> <a href="/About">A</a> <a href="/about">a</a> <a href="/docs/api">x</a> <a href="/docs-api">y</a> <a href="/%E7%94%A2%E5%93%81">cjk</a> <a href="/nolang">nolang</a>', 'Edge case home page with a decent title'));
    if (u === '/docs/') return send(200, html('<h1>Docs</h1>' + words + '<a href="/docs/guide/">guide</a>', 'Documentation index page for the edge site'));
    if (u === '/docs/guide/') return send(200, html('<h1>Guide</h1>' + words, 'Guide page for the edge site documentation'));
    if (u === '/docs' || u === '/docs/guide') return send(404, html('<h1>Not found</h1>'));
    if (u === '/doc.json') return send(200, '{"a":1}', 'application/json');
    if (u === '/file.pdfx') return send(200, '%PDF-1.4 fake', 'application/pdf');
    if (u === '/old') return send(302, '', 'text/html', { location: '/new' });
    if (u === '/new') return send(200, html('<h1>Forbidden by robots</h1>' + words, 'Should never be crawled'));
    if (u === '/svgpage') return send(200, html('<h1>SVG page</h1>' + words, 'Page reached through an SVG link'));
    if (u === '/color') return send(200, html('<section style="background:oklch(0.25 0.02 260);padding:40px"><h1 style="color:oklch(0.95 0.01 260)">Light on dark</h1><p style="color:oklch(0.4 0.02 260)">low contrast paragraph here with enough words to count</p><button style="background:oklch(0.7 0.15 30);color:oklch(0.2 0 0);padding:8px 16px;border:0">Go</button></section>', 'Colour page using oklch values'));
    if (u === '/About') return send(200, html('<h1>About (capital A)</h1>' + words, 'Capital About page title'));
    if (u === '/about') return send(200, html('<h1>about (lowercase)</h1>' + words, 'Lowercase about page title'));
    if (u === '/docs/api') return send(200, html('<h1>API slash</h1>' + words, 'API docs under a slash path'));
    if (u === '/docs-api') return send(200, html('<h1>API dash</h1>' + words, 'API docs under a dash path'));
    if (u === '/%E7%94%A2%E5%93%81') return send(200, html('<h1>產品</h1>' + words, '產品頁面：這是一個以中文路徑命名的頁面標題'));
    if (u === '/nolang') return send(200, `<!doctype html><html><head><meta charset="utf-8"><title>Page without a lang attribute here</title></head><body><h1>x</h1>${words}</body></html>`);
    send(404, html('<h1>404</h1>'));
  };
}
