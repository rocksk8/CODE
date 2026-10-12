// HAR 1.2 export (--har): every network request a page made, in the format browser dev tools, Charles, and HAR viewers open.
// Written per page as pages/<slug>/network.har. No bodies, no cookies: header values that can carry a secret (Authorization, Cookie, Set-Cookie, API keys, tokens,
// and any header you passed with --header) and secret-looking URL parameters are replaced with "[redacted]". Not recorded at all for a logged-in exploration.
import { clean } from './untrusted.mjs';
import { CRED_ENV } from './auth-state.mjs';

const MAX_ENTRIES = 3000;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$|token|secret|api-?key|password|session/i;
const SECRET_PARAM = /token|secret|key|auth|sig(nature)?|password|passwd|session|code|jwt|bearer/i;
const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 410: 'Gone', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };

function customHeaderNames(env = process.env) { try { return new Set(Object.keys(JSON.parse(env[CRED_ENV.headers] || '{}')).map((k) => k.toLowerCase())); } catch { return new Set(); } }

/** A URL with the values of secret-looking query parameters replaced. */
export function redactUrl(u) {
  try { const x = new URL(u); let hit = false; for (const k of [...x.searchParams.keys()]) if (SECRET_PARAM.test(k)) { x.searchParams.set(k, '[redacted]'); hit = true; } x.username = ''; x.password = ''; x.hash = ''; return hit ? x.href.replace(/%5Bredacted%5D/g, '[redacted]') : x.href; } catch { return clean(String(u), 300); }
}
export function redactHeaders(h, extra = new Set()) { return Object.entries(h || {}).slice(0, 80).map(([name, value]) => ({ name: clean(name, 60), value: SECRET_HEADER.test(name) || extra.has(name.toLowerCase()) ? '[redacted]' : clean(String(value), 500) })); }

export class HarRecorder {
  constructor() { this.byPage = new Map(); this.secret = customHeaderNames(); }
  attach(ctx) {
    const add = async (req, failed) => {
      try {
        const page = req.frame()?.page(); if (!page) return;
        const st = this.byPage.get(page) || []; this.byPage.set(page, st); if (st.length >= MAX_ENTRIES) return;
        const t = req.timing(); let resp = null, sizes = null, headers = {}, reqHeaders = {};
        if (!failed) { resp = await req.response().catch(() => null); sizes = await req.sizes().catch(() => null); try { headers = resp ? await resp.allHeaders() : {}; reqHeaders = await req.allHeaders(); } catch { headers = resp?.headers() || {}; reqHeaders = req.headers(); } }
        else reqHeaders = req.headers();
        const start = Number.isFinite(t.startTime) && t.startTime > 0 ? t.startTime : Date.now();
        const end = t.responseEnd >= 0 ? t.responseEnd : 0, ttfb = t.responseStart >= 0 ? t.responseStart : 0;
        const u = new URL(req.url()); const mime = String(headers['content-type'] || '').split(';')[0].slice(0, 100);
        st.push({
          startedDateTime: new Date(start).toISOString(), time: Math.max(0, end),
          request: { method: req.method(), url: redactUrl(req.url()), httpVersion: 'HTTP/1.1', cookies: [], headers: redactHeaders(reqHeaders, this.secret), queryString: [...u.searchParams].slice(0, 60).map(([name, value]) => ({ name: clean(name, 80), value: SECRET_PARAM.test(name) ? '[redacted]' : clean(value, 200) })), headersSize: sizes ? sizes.requestHeadersSize : -1, bodySize: sizes ? sizes.requestBodySize : -1 },
          response: resp ? { status: resp.status(), statusText: clean(resp.statusText() || STATUS_TEXT[resp.status()] || '', 60), httpVersion: 'HTTP/1.1', cookies: [], headers: redactHeaders(headers, this.secret), content: { size: sizes ? sizes.responseBodySize : -1, mimeType: mime }, redirectURL: headers.location ? redactUrl(new URL(headers.location, req.url()).href) : '', headersSize: sizes ? sizes.responseHeadersSize : -1, bodySize: sizes ? sizes.responseBodySize : -1 }
            : { status: 0, statusText: '', httpVersion: 'HTTP/1.1', cookies: [], headers: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: -1, bodySize: -1, _error: clean(String(req.failure()?.errorText || 'failed'), 80) },
          cache: {}, timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: Math.max(0, ttfb), receive: Math.max(0, end - ttfb) }, _resourceType: req.resourceType(),
        });
      } catch {}
    };
    ctx.on('requestfinished', (r) => { add(r, false); });
    ctx.on('requestfailed', (r) => { add(r, true); });
  }
  take(page) { const st = this.byPage.get(page) || []; this.byPage.delete(page); return st; }
}

/** entries = HarRecorder.take(); returns the HAR object (JSON.stringify it to write the file). */
export function buildHar(entries, { url = '', title = '', loadMs = null, dclMs = null } = {}) {
  const sorted = [...entries].sort((a, b) => a.startedDateTime.localeCompare(b.startedDateTime));
  const first = sorted[0]?.startedDateTime || new Date().toISOString();
  return { log: { version: '1.2', creator: { name: 'site-explorer', version: '1' }, pages: [{ startedDateTime: first, id: 'page_1', title: clean(title || url, 200), pageTimings: { onContentLoad: Number.isFinite(dclMs) ? dclMs : -1, onLoad: Number.isFinite(loadMs) ? loadMs : -1 } }], entries: sorted.map((e) => ({ pageref: 'page_1', ...e })) } };
}
