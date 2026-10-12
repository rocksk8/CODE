# site-explorer — test and inspection report

Generated 2026-10-12 for version 0.4.0 (main after pull requests #32–#35, which are listed at the end). This report only states what was actually run or checked; anything that could not be checked is listed under **Not verified**.

## 1. Automated tests

| Item | Result |
|---|---|
| Test files | 62 files (`plugins/site-explorer/test/*.test.mjs`, run with `npm test`) |
| Tests (Node 22, local, with a real Chromium) | 297 tests: 294 pass, 0 fail, 3 skipped (the framework build test, which runs only on CI, and the Firefox/WebKit tests, which need those browsers) |
| Tests on CI, Node 20 | the same suite on the CI Node 20 job (no `node:sqlite`, so the history-database tests are skipped there by design) |
| Tests on CI (GitHub Actions) | Node 20 and Node 22 matrix plus a Docker image build on every pull request; since pull request #34 also the full suite on **Windows** and **macOS** (workflow `platforms`), and Firefox/WebKit smoke tests (workflow `engines`) |
| Windows (GitHub runner, Node 22, latest full run, after pull request #42) | 335 tests: 327 pass, 2 fail, the rest skipped. Both failures are about capturing 3D / animation for the *second and later* crawled pages (each of those timed out after 4 minutes while the first page took 11 seconds); the cause is **not understood**. Pull request #44 keeps a log per page and prints its last lines on failure, and captures one page at a time on Windows; whether that fixes it is not yet confirmed. A real run against a real site on a Windows desktop (the owner's) showed the 3D stage printing no progress for a long time; time limits, progress lines and a per-page time budget were added in pull request #42 because of it |
| macOS (GitHub runner, Node 22) | the full suite passes (latest: pull request #45). Along the way CI exposed a real defect in the new low-memory guard: macOS reports "available" memory so low that healthy runs were stopped; the guard now never stops anything on macOS (it only warns) and elsewhere only below 128 MB / 2 % for 30 s |
| Node 20 specifics | no `node:sqlite`: history database and `changes.md` are skipped there by design; everything else runs |
| Browser | Chromium via Playwright 1.64.0 (pinned); axe-core 4.14.0 (pinned). Firefox and WebKit (`--browser`) are experimental and only smoke-tested on CI |

What the tests cover (by area): argument handling and URL normalisation; robots.txt parsing and matching; crawler behaviour on odd pages (empty, JSON/PDF, redirect loops, endless responses, infinite scroll, iframes, canvas-only pages); health checks (indexing, links, performance, mobile, security headers and certificates, structured data, AI-crawler friendliness); trackers and cookies; accessibility (axe); responsive checks; the history database and before/after report; the handoff package and runnable starter; `verify` scoring; React / Vue / Astro / shadcn outputs (an opt-in build test also runs `npm install && build` on Node 22 in CI); the MCP server protocol; the GitHub Action logic including regression gates; logged-in exploration (state file handling, destructive links never followed, no cookie values in any output); English output (`--lang en`: zero CJK characters and zero untranslated strings across all text outputs and every dashboard tab); injection handling (hidden text, instruction-like text quarantined); path-safety of every output location.

## 2. Independent inspection rounds

Besides the test suite, fresh read-only reviewers (separate agents with no knowledge of the fixes) attacked the tool from different angles. Every finding was reproduced before it was fixed, and each fix got a regression test that fails without it.

| Round | Angle | Reported | Outcome |
|---|---|---|---|
| 1 | First-run user experience (23 findings); correctness and docs honesty (21 confirmed or suspected) | 44 | fixed or documented; unreadable body-text token, unclear failures for unreachable sites, stale help text, wrong README claims |
| 2 | Security (10 groups); robustness / edge cases (15 groups) | 25 | fixed: read-only interaction (POST/PUT/DELETE refused), passwords in URLs, robots.txt matcher ReDoS, charset (Big5 etc.), unknown flags rejected, DNS-aware SSRF guard, WebSocket blocking, bounded HTML scanning, `file://` iframe hang, defanged Markdown, query-string tokens, terminal escapes, planted symlink, output path confinement |
| 3 | Regression review of rounds 1–2 (7); docs-vs-behaviour review (9) | 16 | fixed: trailing-dot hosts, private-resolving start hosts, long tags in word counts, stale results after a failed run, destructive-link rule, docs wording |
| 4 | Regression review of round 3 plus three realistic fixture sites (marketing site, SPA, cookie banner + delete button) | 8 | fixed, including one high-severity regression introduced by round 3 itself (a widened regex could hang the crawler on a hostile page); replaced by a linear tag scanner |
| 5 | Regression review of the remaining-audit-items and new-format PRs; claims in this report and the comparison checked against the code | 7 | fixed: regression gates silently passing when the baseline failed, gate reasons missing from the PR comment, invalid `DESIGN.md` front matter when site text tripped the injection filter, Chinese banner in an English Action run, MCP `out_dir` escaping through a symlink, wrong font fallbacks in the Tailwind v4 theme, stale test count |
| 6 | Adversarial review of the newest features (tracking behaviour, visual regression, page archive, security grading, SARIF/JUnit, Figma, HTML validity, custom extraction, tech stack, performance budgets) | 16 + 9 minor | fixed in the same pull request: two high (a regex that could freeze the crawler on a hostile page; CSS text that could turn the offline archive into active content), plus a visual-baseline folder that could be deleted, a keystroke probe that could type into a sensitive field, CSP / Referrer-Policy grading errors, budgets passing on unmeasured metrics, regex rules without a time limit, false positives in the HTML and technology checks; each with a regression test |
| 7 | Adversarial review of pull request #34 (dashboard verdicts and tabs, scenarios and review page, WARC, Figma plugin, cookie/header/basic-auth credentials, Firefox/WebKit, custom tech rules, throttling, TLS grading) | 14 | fixed in pull request #35: one high (a custom header followed a redirect to another origin), cookie domains silently losing their leading dot (login did not work on sub-domains), scenario paths able to leave the site's origin, stale comparison results shown as current, an A grade without any CSP, plus 9 smaller ones |
| 8 | Regression review of the round-7 fixes and of `--har` | 10 | fixed in the same pull request: the first fix for the header leak buffered streams and sent the cookie jar to other origins (replaced by a cookie-less request context for other origins, streams left alone), HAR leaks through `Referer`/`Location` and more secret parameter names, `--approve-visual` deleting the review files it needs, several CSP policies, a few smaller ones |

Rounds 3, 4, 5, 6 and 8 each found real problems *in the previous round's fixes*, which is why the loop was repeated rather than stopped after the first round.

## 3. Safety properties that are tested

- Text from a website is never executed or trusted as instructions: hidden text, comments and instruction-like text are dropped or quarantined; every generated Markdown/CSS/JS file is sanitised for its type.
- The explorer never clicks anything that looks like buying/deleting/subscribing, refuses all non-read requests while interacting, never follows delete/logout-style links, and never requests them from the link checker.
- Requests to the user's own machine or network are blocked for public sites (IP forms, trailing dots, single-label names, names resolving to private addresses, WebSockets, redirects).
- robots.txt is respected; the user agent is `site-explorer-claude-plugin`.
- Cookie values and storage-state contents are never written to any output, and logged-in results are not stored in the shared history database.
- Output folders: a foreign non-empty folder, the home folder, the filesystem root and the plugin directory are refused; single-file outputs must have the right extension.

## 4. Known flaky points

The total-blocking-time test failed on CI for three runs in a row: the busy page started blocking before the first paint on the slower runner, so the lab measurement correctly excluded it. The test page now starts blocking only after the first paint, and the measurement flushes pending long-task records before reading.

Two timing-sensitive browser tests each failed once on a shared CI runner and passed on the single permitted re-run of the same commit. One of them had a limit of 25 s and took 25.06 s; its limit was widened to 40 s (the assertion is "does not stall", it used to hang forever).

## 5. Not verified

These could not be exercised in the build environment, so they are untested here:

- `docker build` / running the image (no Docker daemon available; the image build job on GitHub Actions is green, but running the container was not tested).
- The GitHub Action on a real runner against a real pull request (the Action's logic is tested by calling it directly; posting a comment was not exercised).
- The interactive `login` flow with a real site and a real person.
- Windows and macOS: the full suite runs on GitHub Actions runners (see section 1 for the latest result); path-length and reserved-name handling were reviewed by reading the code, and no person tried the tool on a Windows or macOS desktop.
- Firefox and WebKit: smoke tests only; the credential layer was only exercised on Chromium.
- The Figma plugin inside real Figma (it is tested against a mocked Figma API); the WARC files in ReplayWeb.page (they are read back with the independent `warcio` library); the HAR in a real browser dev-tools panel (it validates with the `har-validator` package).
- Logging in with a cookie file, header or basic auth against a real site (only local fixture servers).
- The graphical interface (`site-explorer ui`) and the double-click launchers on a real Windows or macOS desktop; webhook delivery to a real Slack / Teams / Discord endpoint; a real scheduler entry created from `site-explorer schedule`.
- Real-world sites on the open internet (the sandbox has no outbound access; all browser tests use local fixture servers).

## 6. Known limitations (not fixed, by design or by cost)

- DNS rebinding between the safety check and the actual connection is not prevented.
- The Docker image runs Chromium without its sandbox (typical for containers); only explore sites you trust there.
- Third-party GitHub Actions in the workflows are pinned by tag, not by commit.
- Pure canvas / WebGL pages cannot have their text structure analysed; the tool reports what it can measure and says so.
- Heuristics (instruction-like text detection, tracker list of 39 services, destructive-link patterns) are best effort.
- With `--header`, each request is fetched by the tool first (so a redirected request never carries the secret): live event streams and media skip that layer, and large downloads are held in memory.
- `--har`, `--warc` and `--archive` are not recorded for logged-in explorations (cookie file, storage state).
- On Windows, the 3D / animation capture works but is slow (about 75 seconds for one small page on the GitHub Windows runner, against about 30 seconds on a Linux machine here), so the tests that capture several pages get a longer time limit there.
- The technology rules (about 120 plus your own) are far fewer than a fingerprint database such as Wappalyzer's; the performance numbers are Playwright lab data, not a Lighthouse score.

## 7. Pull requests behind this report

#21 framework outputs · #22 English output · #23 review rounds 1–2 · #24 security fixes · #25 `--json` early failures and help · #26 round-3 fixes · #27 Chinese console lines · #28 round-4 fixes · #29 remaining audit items · #30 Tailwind v4 `@theme` · #31 DESIGN.md weight fix · #32 drift baseline, Markdown export, technology stack, performance budgets, tracking behaviour, verify masks, whole-page visual regression, page archive, security/TLS grading, SARIF/JUnit, Figma export, HTML validity, custom extraction rules and the round-6 fixes, `DESIGN.md`, OKLCH, Action regression gates, this report and the comparison document · #31 `DESIGN.md` weights · #32 round-5 fixes · #33 round-6 fixes and comparison · #34 dashboard pages for the new checks, depth fixes, scenarios/review/WARC/Figma plugin, cookie/header/basic-auth login, Windows/macOS/Firefox/WebKit CI · #35 round-7 and round-8 fixes and `--har`. · #38–#40 dashboard shell, top fixes, enterprise logo · #41 motion capture for every page, design extraction (ΔE merge, `--tokens`, brand guide, dark tokens), TLS ciphers, `check`, history trend · #42 crawler view, performance depth, unused JS/CSS, crawler tab, graphical interface, time limits and resource guards · #43 HTML validity and Windows console hint · #44 webhook notifications and `schedule` · #45 double-click launchers · #46 reports and comparison updated
