// A deliberately unhealthy site used to verify the health check. Exports a request handler factory.
const page = (head, body) => `<!doctype html><html${head.includes('NOLANG') ? '' : ' lang="en"'}><head><meta charset="utf-8">${head.replace('NOLANG', '')}</head><body>${body}</body></html>`;
const words = (n) => Array.from({ length: n }, (_, i) => 'content' + (i % 40)).join(' ');
export function sickSite({ soft404 = false, origin = () => 'http://localhost' } = {}) {
  return (req, res) => {
    const u = req.url.split('?')[0], send = (c, b, t = 'text/html; charset=utf-8', h = {}) => { res.writeHead(c, { 'content-type': t, ...h }); res.end(b); };
    const O = origin();
    if (u === '/robots.txt') return send(200, `User-agent: *\nDisallow: /private\nAllow: /private/ok\nFoo bar\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${O}/sitemap.xml\n`, 'text/plain');
    if (u === '/sitemap.xml') return send(200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${O}/</loc></url><url><loc>${O}/about</loc><lastmod>2026-01-01</lastmod></url><url><loc>${O}/gone</loc></url><url><loc>${O}/redir</loc></url><url><loc>${O}/noindex-page</loc></url><url><loc>https://elsewhere.example/page</loc></url></urlset>`, 'application/xml');
    if (u === '/') return send(200, page('<title>Hi</title>', `<h1>Welcome</h1><h1>Second title</h1><h4>Skipped level</h4><p>${words(60)}</p><img src="/x.png"><img src="/y.png" alt="ok"><img src="/missing-photo.png" alt="gone"><a href="/about">click here</a> <a href="/noindex-page">Hidden</a> <a href="/csr">App</a> <a href="/dup1">One</a> <a href="/dup2">Two</a> <a href="/gone">Old link</a> <a href="/redir">Moved</a> <a href="/chain1">Chain</a> <a href="/private/secret">Secret</a> <a href="/icon-only"><img src="/y.png"></a>`));
    if (u === '/about') return send(200, page(`<title>About Acme Studio — who we are and what we build</title><meta name="description" content="Acme Studio is an independent design studio building brands, products and motion for ambitious teams around the world."><link rel="canonical" href="${O}/about"><meta name="viewport" content="width=device-width,initial-scale=1"><meta property="og:title" content="About"><meta property="og:image" content="${O}/og.png"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"${O}"}</script>`, `<main><h1>About us</h1><h2>Team</h2><p>${words(200)}</p></main>`));
    if (u === '/noindex-page') return send(200, page('<title>Private page that should not be indexed ok</title><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width">', `<h1>Hidden</h1><p>${words(120)}</p>`));
    if (u === '/csr') return send(200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Client side app</title><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script>document.getElementById('root').innerHTML='<h1>Rendered by JS</h1><p>${words(150)}</p>';</script></body></html>`);
    if (u === '/dup1' || u === '/dup2') return send(200, page('<title>Same title on two pages</title><meta name="viewport" content="width=device-width">', `<h1>Page ${u}</h1><p>${words(180)}</p>`));
    if (u === '/redir') return send(301, '', 'text/html', { location: '/about' });
    if (u === '/chain1') return send(302, '', 'text/html', { location: '/chain2' });
    if (u === '/chain2') return send(301, '', 'text/html', { location: '/about' });
    if (u === '/gone') return send(404, page('<title>Not found</title>', '<h1>Gone</h1>'));
    if (u === '/x.png' || u === '/y.png') return send(200, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), 'image/png');
    if (u === '/llms.txt') return send(404, 'no');
    if (soft404) return send(200, page('<title>Soft</title>', '<h1>Nothing here, but 200</h1>'));
    return send(404, page('<title>Not found</title>', '<h1>404</h1>'));
  };
}
