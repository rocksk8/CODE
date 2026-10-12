# How the grades and verdicts are computed

Everything here is a heuristic on public information, meant for **comparing runs of the same site**, not a certification. Numbers come from `plugins/site-explorer/scripts/security-grade.mjs`, `verdicts.mjs` and `perf-budget.mjs`; the tests in `test/` pin them.

## Security headers (A+ … F)
Start at 100 and add the points of each test; the score is capped at 115. Grades: ≥100 A+, ≥90 A, ≥85 A-, ≥80 B+, ≥70 B, ≥65 B-, ≥60 C+, ≥50 C, ≥45 C-, ≥40 D+, ≥30 D, ≥25 D-, below that F.

| Test | Points |
|---|---|
| Content-Security-Policy missing | −25 |
| CSP without `script-src` / `default-src` | −10 |
| CSP allows `'unsafe-inline'` scripts (no nonce / hash / strict-dynamic) | −20 |
| CSP allows `'unsafe-eval'`, or `*` / `http:` / `https:` / `data:` as a script source | −10 |
| CSP restricts scripts (and `object-src 'none'` + `base-uri`) | +5 (+10) |
| HSTS missing (HTTPS sites only) | −20 |
| HSTS `max-age` below 15 552 000 s | −10 (−20 when 0) |
| HSTS ≥ 1 year with `includeSubDomains` and `preload` | +5 |
| `X-Content-Type-Options: nosniff` missing | −5 |
| No `X-Frame-Options` and no CSP `frame-ancestors` | −20 |
| Referrer-Policy `no-referrer`, `same-origin`, `strict-origin`, `strict-origin-when-cross-origin` | +5 |
| Referrer-Policy `unsafe-url`, `no-referrer-when-downgrade` | −5 |
| Session-type cookie without `Secure` (HTTPS) / without `HttpOnly` / `SameSite=None` without `Secure` | −20 / −10 / −5 |
| External scripts without `integrity` | −10 (+5 when all have it) |

CSP directives are read case-insensitively and the **first** occurrence of a repeated directive wins, as browsers do.

## TLS (A … F)
The grade is a cap: it starts at A and is lowered by the worst finding. Expired certificate, hostname mismatch, self-signed or untrusted → F; TLS 1.2 and 1.3 both unsupported → F; TLS 1.0 / 1.1 still accepted → B; certificate expiring within 14 days → B; RSA key under 2048 bits → B; DH key under 2048 bits → B; no forward secrecy on TLS 1.2 → B; no TLS 1.3 → A-; negotiated cipher not authenticated encryption → A-. Which protocol versions the server accepts is probed with one connection per version.

**Not tested:** obsolete cipher suites (RC4, 3DES, export grades). The Node.js crypto library cannot offer them, so they cannot be probed here; the report says "not tested" instead of assuming safe. Use SSL Labs for a full cipher review.

## Speed
Colours follow Google's published boundaries (good / poor): LCP 2.5 s / 4 s, CLS 0.1 / 0.25, TTFB 0.8 s / 1.8 s, FCP 1.8 s / 3 s, TBT 200 ms / 600 ms. The verdict is the worst of the measured metrics; a failed `--budget` always makes it red. Numbers are lab data from one machine; `--perf-runs 3` takes the median of three cold loads and `--throttle mobile` applies a mobile-network and 4× CPU slowdown (Chromium only).

## Results at a glance
Green: nothing to do. Yellow: worth a look. Red: fix this. Blue: information only. Health: red when the verdict is "fail", yellow with any critical/high issue or a score under 80. Privacy: red when typed text reached another site, yellow for session recording or third-party fingerprinting / page-wide key listeners. Visual: red when any screenshot differs by more than the threshold.
