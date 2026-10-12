# site-explorer — test and inspection report

Generated 2026-10-11 for version 0.4.0 (main plus the pull requests listed at the end). This report only states what was actually run or checked; anything that could not be checked is listed under **Not verified**.

## 1. Automated tests

| Item | Result |
|---|---|
| Test files | 28 files (`plugins/site-explorer/test/*.test.mjs`, run with `npm test`) |
| Tests (Node 22, local, with a real Chromium) | 201 tests: 200 pass, 0 fail, 1 skipped (the opt-in framework build test, run only on CI Node 22) |
| Tests on CI (GitHub Actions) | Node 20 and Node 22 matrix plus a Docker image build, green on every merged pull request (#21–#28); two jobs failed once on timing and passed on a single re-run (see section 4) |
| Node 20 specifics | no `node:sqlite`: history database and `changes.md` are skipped there by design; everything else runs |
| Browser | Chromium via Playwright 1.64.0 (pinned); axe-core 4.14.0 (pinned) |

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

Rounds 3, 4 and 5 each found real problems *in the previous round's fixes*, which is why the loop was repeated rather than stopped after the first round.

## 3. Safety properties that are tested

- Text from a website is never executed or trusted as instructions: hidden text, comments and instruction-like text are dropped or quarantined; every generated Markdown/CSS/JS file is sanitised for its type.
- The explorer never clicks anything that looks like buying/deleting/subscribing, refuses all non-read requests while interacting, never follows delete/logout-style links, and never requests them from the link checker.
- Requests to the user's own machine or network are blocked for public sites (IP forms, trailing dots, single-label names, names resolving to private addresses, WebSockets, redirects).
- robots.txt is respected; the user agent is `site-explorer-claude-plugin`.
- Cookie values and storage-state contents are never written to any output, and logged-in results are not stored in the shared history database.
- Output folders: a foreign non-empty folder, the home folder, the filesystem root and the plugin directory are refused; single-file outputs must have the right extension.

## 4. Known flaky points

Two timing-sensitive browser tests each failed once on a shared CI runner and passed on the single permitted re-run of the same commit. One of them had a limit of 25 s and took 25.06 s; its limit was widened to 40 s (the assertion is "does not stall", it used to hang forever).

## 5. Not verified

These could not be exercised in the build environment, so they are untested here:

- `docker build` / running the image (no Docker daemon available; the image build job on GitHub Actions is green, but running the container was not tested).
- The GitHub Action on a real runner against a real pull request (the Action's logic is tested by calling it directly; posting a comment was not exercised).
- The interactive `login` flow with a real site and a real person.
- Windows and macOS runtime behaviour (only Linux was run; path-length and reserved-name handling were reviewed by reading the code).
- Real-world sites on the open internet (the sandbox has no outbound access; all browser tests use local fixture servers).

## 6. Known limitations (not fixed, by design or by cost)

- DNS rebinding between the safety check and the actual connection is not prevented.
- The Docker image runs Chromium without its sandbox (typical for containers); only explore sites you trust there.
- Third-party GitHub Actions in the workflows are pinned by tag, not by commit.
- Pure canvas / WebGL pages cannot have their text structure analysed; the tool reports what it can measure and says so.
- Heuristics (instruction-like text detection, tracker list of 39 services, destructive-link patterns) are best effort.

## 7. Pull requests behind this report

#21 framework outputs · #22 English output · #23 review rounds 1–2 · #24 security fixes · #25 `--json` early failures and help · #26 round-3 fixes · #27 Chinese console lines · #28 round-4 fixes · #29 remaining audit items · #30 Tailwind v4 `@theme`, `DESIGN.md`, OKLCH, Action regression gates, this report and the comparison document · #31 `DESIGN.md` weights · #32 round-5 fixes.
