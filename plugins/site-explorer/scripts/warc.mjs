// WARC export (--warc): the network responses a page actually loaded, written as a standard WARC 1.1 file (one gzip member per record, .warc.gz) that
// replay tools such as pywb / ReplayWeb.page can open. Responses only (no request records), GET only.
// Privacy: Set-Cookie, Authorization and similar headers are never written; bodies are stored decoded, so Content-Encoding / Content-Length / Transfer-Encoding
// are rewritten. Per-resource and per-page size caps keep the file bounded (what was skipped is counted). Not recorded for logged-in explorations.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const DROP = new Set(['set-cookie', 'set-cookie2', 'authorization', 'proxy-authorization', 'proxy-authenticate', 'cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
const MAX_ONE = 8 * 1024 * 1024, MAX_PAGE = 40 * 1024 * 1024, MAX_RECORDS = 1500;
const STATUS = { 200: 'OK', 201: 'Created', 203: 'Non-Authoritative Information', 206: 'Partial Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 410: 'Gone', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const clean = (v) => String(v).replace(/[\r\n\u0000]/g, ' ').slice(0, 2000);

export class WarcRecorder {
  constructor() { this.byPage = new Map(); }
  attach(ctx) {
    ctx.on('response', async (resp) => {
      try {
        const req = resp.request(); if (req.method() !== 'GET') return;
        const page = resp.frame()?.page(); if (!page) return;
        const st = this.byPage.get(page) || { records: [], bytes: 0, skipped: 0 }; this.byPage.set(page, st);
        const status = resp.status(); if (status < 200 || status >= 300 && status !== 404 && status !== 410) return; // redirects have no body worth keeping
        if (!/^https?:/i.test(resp.url()) || st.records.length >= MAX_RECORDS || st.bytes >= MAX_PAGE) { st.skipped++; return; }
        let body; try { body = await resp.body(); } catch { return; }
        if (body.length > MAX_ONE || st.bytes + body.length > MAX_PAGE) { st.skipped++; return; }
        st.bytes += body.length; st.records.push({ url: resp.url(), status, headers: resp.headers(), body, date: new Date().toISOString() });
      } catch {}
    });
  }
  take(page) { const st = this.byPage.get(page) || { records: [], bytes: 0, skipped: 0 }; this.byPage.delete(page); return st; }
}

const rec = (type, extra, payload) => {
  const head = [`WARC/1.1`, `WARC-Type: ${type}`, ...extra, `WARC-Record-ID: <urn:uuid:${crypto.randomUUID()}>`, `Content-Length: ${payload.length}`].join('\r\n') + '\r\n\r\n';
  return zlib.gzipSync(Buffer.concat([Buffer.from(head), payload, Buffer.from('\r\n\r\n')]));
};

/** records: [{ url, status, headers, body, date }] → Buffer of a .warc.gz */
export function buildWarc(records, { software = 'site-explorer', startUrl = '' } = {}) {
  const info = Buffer.from(`software: ${clean(software)}\r\nformat: WARC File Format 1.1\r\nisPartOf: ${clean(startUrl)}\r\ndescription: network responses recorded while exploring the page (no cookies or authorization headers)\r\n`);
  const parts = [rec('warcinfo', [`WARC-Date: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`, 'Content-Type: application/warc-fields'], info)];
  for (const r of records) {
    const h = Object.entries(r.headers || {}).filter(([k]) => !DROP.has(k.toLowerCase())).map(([k, v]) => `${clean(k).replace(/[:\s]/g, '-')}: ${clean(v)}`);
    const http = Buffer.concat([Buffer.from(`HTTP/1.1 ${r.status} ${STATUS[r.status] || 'Status'}\r\n${[...h, `Content-Length: ${r.body.length}`].join('\r\n')}\r\n\r\n`), r.body]);
    parts.push(rec('response', [`WARC-Target-URI: ${clean(r.url)}`, `WARC-Date: ${String(r.date).replace(/\.\d+Z$/, 'Z')}`, 'Content-Type: application/http; msgtype=response'], http));
  }
  return Buffer.concat(parts);
}

/** Minimal reader (used by the tests and available for checking a file): returns [{ type, uri, status, headers, body }]. */
export function readWarc(buf) {
  const text = zlib.gunzipSync(buf); const out = []; let i = 0;
  while (i < text.length) {
    const he = text.indexOf('\r\n\r\n', i); if (he < 0) break; const head = text.slice(i, he).toString('utf8'); const len = Number(/Content-Length: (\d+)/i.exec(head)?.[1] ?? 0);
    const payload = text.slice(he + 4, he + 4 + len); const type = /WARC-Type: (\S+)/.exec(head)?.[1]; const uri = /WARC-Target-URI: (\S+)/.exec(head)?.[1] ?? null;
    const r = { type, uri }; if (type === 'response') { const pe = payload.indexOf('\r\n\r\n'); const hh = payload.slice(0, pe).toString('utf8').split('\r\n'); r.status = Number(/HTTP\/1\.1 (\d+)/.exec(hh[0])?.[1]); r.headers = Object.fromEntries(hh.slice(1).map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()])); r.body = payload.slice(pe + 4); }
    out.push(r); i = he + 4 + len + 4;
  }
  return out;
}
