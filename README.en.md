<div align="center">

# site-explorer

**Let an AI actually *understand* a website — then hand it the keys to rebuild it.**

One command turns any public website into a handoff package that AI and engineers can pick up: design tokens, **runnable page skeletons**, animation/3D translated into text, an SEO/health report, and an offline dashboard.

[![test](https://github.com/rocksk8/CODE/actions/workflows/test.yml/badge.svg)](https://github.com/rocksk8/CODE/actions/workflows/test.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A520-green)

**English** · [繁體中文](README.md) · [Sample output](docs/demo/) · [Dashboard screenshots](docs/images/)

![site-explorer dashboard tour](docs/images/demo.gif)

</div>

```bash
npm i -g git+https://github.com/rocksk8/CODE.git
site-explorer setup
site-explorer https://example.com
```

You get a folder: double-click `dashboard.html` for the overview; give the whole `handoff/` folder to an AI and paste the prompt from `PROMPT.md` — it can start building pages and motion without you writing any briefing.

> **Language note.** Output defaults to Traditional Chinese; add `--lang en` (or `SITE_EXPLORER_LANG=en`) and the console, reports, dashboard, handoff documents and the issue text in PR comments are all English. The handoff entry points (`START-HERE.md`, `PROMPT.md`, `AI-PACKAGE.md`, the starter code) are English either way, and everything is plain text / JSON that any LLM reads fine.

## What it does

| | |
|---|---|
| ![](docs/images/dashboard-overview.png) | **A visual overview**: real desktop/tablet/phone renders, health score and verdict, brand colours (click to copy), fonts, a wall of every page. The *Details* switch (top right) reveals per-page technical data and raw JSON. |
| ![](docs/images/starter-vs-original.png) | **Runnable page skeletons**: `starter/*.html` generated from the *measured* section structure, columns, spacing, backgrounds/gradients and phone navigation. All copy and images are placeholders — nothing from the source site is reproduced. Left: the original; right: the generated starter. |
| ![](docs/images/dashboard-motion-preview.png) | **3D / video / animation an AI can read**: three.js scene facts, which objects rotate, video specs, plus single-image filmstrips. `starter/motion/index.html` runs every observed animation with its reference frames next to it. |
| ![](docs/images/dashboard-export.png) | **One-click export for AI**: pick a goal (pages / motion / both), copy a ready prompt. `AI-PACKAGE.md` is the single-file version for chats that can't take a folder. |
| ![](docs/images/dashboard-health.png) | **Website health**: SEO, crawlability/indexability, links, performance, mobile, security, structured data, trackers & cookies, AI-crawler friendliness — with a verdict (pass / conditional / fail) and `--fail-on` exit codes for CI. |

## How it differs from other tools

| You might use | What it's good at | What site-explorer adds |
|---|---|---|
| Lighthouse / PageSpeed | Standard performance, accessibility and best-practice scores | It doesn't capture *what the site looks like*, and produces nothing for an AI to build from |
| axe / WAVE | Accessibility rules | Same; this tool also covers SEO indexability, trackers and before/after comparison |
| Wappalyzer / BuiltWith | Technology detection | Detection only: no design capture, no usable skeleton |
| Screenshot-to-code AI tools | A page from one image | Usually just one image: no measured section structure, tokens, animation data or responsive behaviour |
| SiteSucker / wget | Mirroring a site | Mirrors someone else's files; this records observed facts and rebuilds with placeholders |

**Positioning:** explore → hand off → (let an AI) rebuild. It does not replace Lighthouse or axe; it turns "what a site really looks like and how it behaves" into data an AI can use.

## Who it's for

- **Redesigns / rebuilds** — the old site's page inventory (with 301 needs), content structure and design tokens in one go; automatic before/after comparison.
- **Building front-ends with AI** — give it measured structure and reference images instead of a vague description.
- **SEO and acceptance testing** — a health check that can gate CI (exit codes) and lists new/fixed issues between runs.
- **Competitor research, design-system extraction** — colours, fonts (with licensing), spacing, components, motion rhythm.

---

## Install

Node 20+ (the history database needs 22.13+). Browser: any of Chrome / Edge / Chromium; if none is found, `setup` offers to download Chromium.

**Inside Claude Code (recommended)**
```
/plugin marketplace add rocksk8/code
/plugin install site-explorer@rocksk8-code
```
After installing, a hook installs dependencies into `~/.site-explorer/deps` in the background at session start (once, non-blocking, survives plugin updates). Then just say "analyse https://example.com", or use `/site-explorer:explore`.

**In a terminal** (paste one line at a time)
```bash
npm i -g git+https://github.com/rocksk8/CODE.git
```
```bash
site-explorer setup
```
```bash
site-explorer example.com
```
`setup` checks Node → installs dependencies → finds a browser → smoke test; `site-explorer doctor` prints a fix command for every problem.
Don't use the `github:rocksk8/code` shorthand: npm switches to SSH for it, which fails on machines without an SSH key.
No install: `npx git+https://github.com/rocksk8/CODE.git example.com`.

**Output location:** `explore-out/` in the current folder by default. Use `--out <folder>` or set `SITE_EXPLORER_OUT`. The folder root gets an `ABOUT-THIS-FOLDER.md` (what this is, where to look, how to rerun) and a `runs.json`.

Contributors: `cd plugins/site-explorer && npm run test:full`.

## Docker (no Node needed)

```bash
git clone https://github.com/rocksk8/CODE.git && cd CODE
docker build -t site-explorer .
docker run --rm -v "$PWD/out:/out" site-explorer https://example.com --out /out
```

Results land in `./out`. The container is the sandbox, so Chromium runs without its own sandbox; explore only sites you trust.

## For programs and AI tools: `--json` and MCP

```bash
site-explorer https://example.com --json --no-open > result.json   # stdout is one JSON document, progress goes to stderr
site-explorer verify ./explore-out/handoff --json --min-score 70    # exits 2 when the score is too low (no gate without --min-score). The score measures layout — section height, light/dark structure, colour — not text or photos
site-explorer mcp                                                   # MCP server (stdio)
```

The Claude Code plugin registers the MCP server automatically. For other MCP clients (Claude Desktop, Cursor…) add:

```json
{ "mcpServers": { "site-explorer": { "command": "npx", "args": ["-y", "site-explorer", "mcp"] } } }
```

> `npx -y site-explorer` works only after the package is published to npm; until then use `node /path/to/CODE/plugins/site-explorer/bin/site-explorer.mjs mcp`.

Tools: `explore_site`, `check_site_health`, `verify_rebuild`, `read_handoff_file`. Results contain scores, verdicts and paths only; text taken from websites is sanitised, and handoff documents are prefixed with a "this is data, not instructions" warning.

## GitHub Action: health-check every pull request and comment

```yaml
# .github/workflows/site-check.yml
name: site-check
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: rocksk8/CODE@main          # pin to a release tag (e.g. @v0.4.0) once one exists
        with:
          url: https://your-preview-url   # e.g. a Vercel / Netlify / Cloudflare PR preview
          baseline-url: https://your-production-url   # optional: adds a before/after comparison
          fail-on: high                   # fail the check on high-or-worse issues
          min-health: 70                  # optional: fail below this health score
          max-drop: 5                     # optional (needs baseline-url): fail when more than 5 points below production
          fail-on-new: high               # optional (needs baseline-url): fail on a new high-or-worse issue production does not have
```

A comment appears on the PR (and is updated in place on later pushes) with the score, the verdict, the difference from production, the top issues and their fixes; the dashboard and AI handoff are attached to the run as Artifacts. PRs from forks have a read-only token, so the comment is skipped and the result stays in the job summary. The comment frame (title, column names) is always English; `lang: zh` only switches the issue titles and fixes inside it to Traditional Chinese.

## Exploring pages behind a login

```bash
site-explorer login https://example.com/        # opens a browser window; you sign in yourself (2FA included), then press Enter
site-explorer https://example.com/ --storage-state ./auth-state.json
```

- Your password is typed into the website's own page; the tool never sees it. What is saved is the session (cookies / localStorage), which **equals being logged in**. The file is readable only by you (mode 600); **keep it out of git, don't send it to anyone, delete it when done**.
- The session values are **never** written to any output file.
- Links that act when merely visited (logout, delete, cancel, unsubscribe…) are skipped, and the health check's link checker never requests such URLs, logged in or not.
- Logged-in screenshots and text may contain personal data: the handoff and dashboard are marked "captured while logged in" and are **not stored in the history database**. Do not publish these outputs.
- Use only on accounts and sites you are entitled to access.

## Accessibility check (axe-core)

```bash
site-explorer https://example.com --a11y
```

Runs the industry-standard axe-core against WCAG 2.2 AA: missing alt text, buttons without names, insufficient contrast, unlabeled form fields, missing language… The result becomes a health category "Accessibility" (counted in the total score only when you pass `--a11y`; without it scores are exactly as before) and is written to `site/<site>/a11y.json`, each violation with a fix link and where it occurs. Automated checks catch only part of the problems and do not replace manual review. In the GitHub Action the option is `a11y: true`.

## Turn the starter into a React / Vue / Astro project or a shadcn/ui theme

```bash
site-explorer https://example.com --framework react       # react | vue | astro | shadcn | all
site-explorer framework ./explore-out/handoff --to all    # convert an existing handoff afterwards
cd explore-out/handoff/frameworks/react && npm install && npm run dev
```

Every section of every page becomes a component (`src/components/<page>/<section>`); text and images stay placeholders, spacing and colours are the measured values, and the design tokens travel with the project. React and Vue use Vite, Astro is Astro 4; versions are pinned to the ones that were actually run. `shadcn` writes `globals-theme.css` (the HSL variables shadcn/ui reads, brand colour as `primary`) plus a Tailwind config snippet; the dark palette is derived, so check it by eye.

All three projects were really installed and built, then compared section by section in a browser: they render **identically** to the plain-HTML starter (CI re-runs this check on Node 22). On regeneration, a project you edited is moved to `<name>.backup-<time>` instead of being overwritten.

## English output: `--lang en`

```bash
site-explorer https://example.com --lang en     # or set SITE_EXPLORER_LANG=en
```

Console messages, the health report, the exploration report, the handoff documents, the before/after report, the dashboard UI and the PR comment all come out in English (Traditional Chinese is still the default). The test suite runs the full pipeline in English and checks that no Chinese and no untranslated string is left; text that belongs to the website itself (titles, copy) is of course left as it is. The GitHub Action's `lang` input defaults to `en`.

## Commands

| Command | What it does |
|---|---|
| `/site-explorer:explore <url>` | One-shot exploration: dashboard + handoff package |
| `/site-explorer:handoff <url>` | Produce the handoff package and explain style, structure, motion, health and unknowns |
| `/site-explorer:health <url>` | Website health (SEO / indexability / links / performance / mobile / security / AI crawlers) |
| `/site-explorer:to-design <url> [design to make]` | Explore → handoff → build a Claude Design design system → mock-up |
| `/site-explorer:capture-motion <url>` | 3D/animation capture only (AI-readable) |
| `/site-explorer:compare <A> <B>` | Side-by-side comparison of two sites (competitors / before-after) |
| `/site-explorer:report <url>` | Build the dashboard in stages |
| `/site-explorer:history list｜search --lib three｜history <host>｜compare a b` | Query and compare earlier explorations |
| `/site-explorer:doctor [url]` | Environment diagnosis |

## Making 3D, video, animation and very long pages readable for AI

An AI can only read text and images, so:

| Source | What the AI gets |
|---|---|
| three.js / WebGL scene | Object list (name, geometry, material colours, lights), camera (fov/position), **which objects rotate**, draw calls per frame, plus a filmstrip image |
| Video | Duration, resolution, autoplay/loop/muted, source, plus frames at 0/25/50/75% |
| Ordinary animation | Self-running?, period, amount and area of change, dominant colours, reacts to mouse/drag/scroll?, plus a filmstrip |
| CSS 3D / keyframes | transform / perspective, keyframes text, duration and easing, reproduction hints |
| Very long full-page screenshot (gets downscaled until unreadable) | One crop per section (≤ 1800px tall) |

Everything goes into `motion.md`, each item marked "an AI cannot watch this directly — trust the text and numbers".

## The handoff package `handoff/`

| File | For whom / purpose |
|---|---|
| `START-HERE.md`, `PROMPT.md`, `AI-PACKAGE.md` | **Start here**: 3 steps; paste-ready prompts (A pages / B motion / C both); single-file version |
| `starter/` | Runnable skeletons: `index.html` and one file per page, `styles.css`, `app.js`; `starter/motion/index.html` runs every observed animation next to its reference filmstrip |
| `ai-brief.md` | **AI reads first**: style in one sentence, pasteable CSS tokens, components, page skeletons (with real content structure), voice, hard rules, which images to look at |
| `SPEC.md` / `spec.json` | Full specification: information architecture, design system, components, per-page sections and content, motion, assets, tech and editing method, health, build order, **unknowns and limits** |
| `motion.md`, `health.md` | Motion and health |
| `DECISIONS.md` | **Living** decision log, open questions, assumptions, provenance (who read which pages, when, as whom) |
| `CLAUDE.md` | For an AI working in this folder: how to read it, what not to do, log every decision |
| `inventory.csv` | Every page (opens in Excel): URL inventory for redirect planning |
| `content/` | The readable text of every page as Markdown, in document order (`content/INDEX.md` lists them). Links are written as `text (url)` and images as `[image: alt]`, so the files can never render a clickable or tracking element |
| `tokens/`, `media/` | css / W3C / Tokens Studio / Tailwind (v3 config and v4 `@theme`, OKLCH colours) / `DESIGN.md` (design rules for AI coding tools) / palette SVG; section crops, filmstrips, brand assets |

The whole package is relocatable: every file referenced in a document is inside it (tests guarantee that). Regenerating never deletes your work: an edited `starter/` is kept as `starter.backup-<time>`, and `DECISIONS.md` is only appended to.

## Designer workbench (the dashboard)

| You want to… | Feature |
|---|---|
| "What font, size, colour is this heading?" | **Inspect**: hover the screenshot for font, size, colour, contrast, spacing, radius; click to pin and copy CSS |
| "How is this page built?" | **Section slices** + **page skeleton**, with the evidence for each guess |
| "How does it reflow on a phone?" | **Responsive side-by-side** (scroll-synced) |
| "Can I use this font?" | **Font sources** (Google / Adobe / self-hosted / system) with substitutes |
| "Which text is hard to read?" | **Contrast check on real backgrounds** |
| "Bring it into Figma" | `palette.svg`, `tokens.studio.json` |
| "What's wrong with the SEO?" | **Health** tab: score, issues (why it matters + how to fix + examples), page table, robots / AI crawlers, sitemap, performance, security |
| "Compare with a competitor" | `/site-explorer:compare` |

## What the health check covers

Indexing & crawling 25% · on-page SEO 20% · links 10% · performance 15% · mobile 10% · security & transport 10% · structured data & social 5% · AI-crawler friendliness 5% (with `--a11y` an accessibility category of weight 10 is added and the others shrink proportionally). Scoring has diminishing returns, and any *critical* problem (site blocked, whole site noindex, no HTTPS, expired certificate) caps the total at 55. **The score is a relative indicator, not Google's score**; it only covers the crawled pages (a sample); performance is lab data.

The report opens with a **verdict** (pass / conditional / fail). For automation: `site-explorer explore <url> --fail-on high` exits with code 4 when there are issues of that severity or worse. Run the same site again and the report lists new and fixed issues.

**Local drift baseline.** `site-explorer explore <url> --approve` stores this run's design tokens (colours, fonts, spacing…) and health result as a baseline (default `<out>/baseline.json`; choose a path with `--baseline <file>` to keep it in version control). Later, `site-explorer explore <url> --compare` compares with it and exits with code 4 — writing `drift.md` — when any design token changed, the health score dropped by more than `--max-drop` (default 5), or a new issue at `--fail-on-new` (default high) or worse appeared. Tokens are compared exactly; to accept a new look, review it and run `--approve` again.

**Technology stack.** Every exploration writes `techstack.md/json`: about 55 technologies (CMS, frameworks, libraries, hosting/CDN, analytics) recognised from script URLs, response headers, cookies, the generator tag and page globals, each with evidence and confidence — never guessed from visual style.

**Performance budgets and run history.** `--budget <file.json>` (e.g. `{"lcpMs": 2500, "totalKB": {"max": 1500, "level": "warn"}}`). Metrics: ttfbMs, fcpMs, lcpMs, loadMs, cls, totalKB, requests, thirdPartyRequests, renderBlockingScripts, domNodes. A violated `fail`-level budget exits with code 4; every result is appended to `<out>/perf-history.json` (last 60 runs); the report is `performance.md/json` in each site folder.

**Tracking behaviour check.** `tracking-behaviors.md/json` goes beyond listing trackers: does the page use a session-recording service (Hotjar, Clarity, FullStory…), read canvas / WebGL / audio fingerprints or probe fonts heavily, and is typed text sent to another site? (The probe types a random string into one ordinary text box and clears it — it never submits; forms with a password field, payment-looking fields and logged-in sessions are never probed.) A hit is a reason to look, not proof of misuse.

**Whole-page visual regression.** `--approve` also stores the desktop / tablet / mobile full-page screenshots in `<baseline name>-visual/` next to the baseline file; `--compare` compares them pixel by pixel (a pixel differs when a colour channel is off by more than 16/255), allows `--visual-threshold` (default 0.5%) of pixels to differ per screenshot, and otherwise exits with code 4, writing `visual.md` and `visual-diff/*.png` (changes in red). `--no-visual` skips it. This compares whole screens, so dynamic content (carousels, ads, clocks) causes differences — tune the threshold.

**Page archive.** `--archive` saves `pages/<page>/archive.html` for every page — a single HTML file that opens offline (CSS and images embedded up to a size cap; scripts, iframes and event attributes removed and a Content-Security-Policy added), a simplified SingleFile. Off by default because the files are large; resources over the cap stay as URLs (they will not load offline).

**Security header and TLS grade.** Every exploration writes `security.md/json` — a Mozilla-Observatory / SSL-Labs-style configuration check: CSP strength, HSTS, nosniff, framing protection, Referrer-Policy, login-cookie flags, subresource integrity of external scripts, plus which TLS versions the server accepts and the certificate's validity / domain / trust / key size, each with its score effect and how to fix it, graded A+ to F. It is a configuration check on public information, not a vulnerability scan; the grade is for comparing runs, not a certification.

**CI output (SARIF / JUnit).** `--sarif <file>` and `--junit <file>` write health issues, performance-budget violations, security-grade deductions, TLS problems and (when a comparison ran) visual differences as SARIF 2.1.0 (GitHub code scanning and others) and JUnit XML (Jenkins, GitLab, CircleCI, Azure DevOps). The GitHub Action always produces `results.sarif` / `results.xml`; their paths are the outputs `sarif-file` / `junit-file`, ready for `github/codeql-action/upload-sarif`.

**Figma files.** Every exploration writes one layered SVG per page into `figma/` (real positions, sizes, fills, corner radii and text) that you drag into Figma and edit; import design variables with Tokens Studio from `design-bundle/tokens.studio.json`. It is a layout draft built from the measured elements (up to 240), not a pixel-exact copy: each text run is limited to its first 200 characters and images are grey placeholders.

**HTML validity.** The health check inspects the raw HTML the server sends — unclosed or mis-nested tags, stray closing tags, duplicate ids / attributes, nested links or buttons, block elements inside `<p>`, list / table children in the wrong parent, deprecated elements, missing doctype, late charset. It is conservative (reports only what is certainly wrong), not a full W3C validator.

**Custom extraction rules.** `--extract rules.json`, e.g. `{"price": {"css": ".price"}, "sku": {"css": "[itemprop=sku]", "attr": "content"}, "order": {"regex": "order-(\\d+)"}}`. css rules run on the rendered page (up to 50 matches); regex rules run on the visible text (or on the HTML with `"in": "html"`); the result is `extractions.csv/json`, one row per page. The rules file is parsed strictly (rule names, counts and regexes that could hang are rejected).

**Reading the dashboard.** Open `dashboard.html`: at the top of the overview is *Results at a glance* — one card per check whose colour says whether to act (green = fine, yellow = worth a look, red = fix this, blue = just information), with a one-sentence verdict and a next step; click a card for the detail tab. The tabs come in four groups: Look (design, layout, content, 3D, editing), Check (health, security, speed, privacy, technology), Compare (screens, history, custom extraction) and Deliver (export for AI, details, about). The terminal prints the same summary at the end, and `ABOUT-THIS-FOLDER.md` in the output folder explains what each file is for. `site-explorer explore --help` is grouped by purpose and starts with the three most common commands.

**Deeper checks.** `--tech-rules rules.json` adds your own technology-recognition rules (about 120 built in, including payments, support chat, captcha and Taiwanese shop platforms); `--perf-runs 3` repeats the measurement and takes the median, `--throttle mobile` simulates a mobile network and a 4x slower CPU (Chromium only), and the speed page gains Total Blocking Time (TBT); the security grade gains forward secrecy, DH size and authenticated-encryption checks (obsolete suites such as RC4 / 3DES cannot be probed actively in this environment, and the report says "not tested"); the HTML check gains label-for / aria-* / #anchor references to ids that do not exist; the privacy check gains third-party scripts listening to page-wide keyboard events. The scoring rules are in `docs/SCORING.md`.

**Screen scenarios and review.** `--scenarios scenarios.json` defines screens that need steps first — click, hover, scroll, type… then screenshot (a menu open, a dropdown) — and `--hide '.clock'` hides parts that always change; they are stored in the baseline and compared together with the whole-page screenshots. When something differs, `visual-review.html` lets you drag a slider to compare before and after, one screenshot at a time, with the "approve this one" command beside it; `--approve-visual home:mobile,scenario:menu-open` (or `all`) updates only the named screenshots. Scenarios run only on the site's own origin, every non-GET request is blocked, and Enter cannot be pressed.

**HAR network log.** `--har` saves `network.har` per page (HAR 1.2: URL, status, size and timings of every request; opens in the browser dev-tools Network panel or any HAR viewer). No response bodies and no cookies; Authorization, Cookie, API keys, headers passed with `--header` and URL parameters whose names look like secrets (token, key, session, sig, code, ...; also inside Referer and Location headers) are replaced with `[redacted]`; not recorded when logged in.

**WARC and Figma.** `--warc` saves `archive.warc.gz` per page (WARC 1.1, no cookies or auth headers, not recorded when logged in; verified readable with the independent warcio library, not yet replayed in ReplayWeb.page). Besides the SVGs, the Figma folder has `*.figma.json` and `plugin/` (a small Figma plugin): import `plugin/manifest.json` in the Figma desktop app, choose the `*.figma.json` files, and every page becomes nested auto-layout Frames with the full text and the images. The plugin has only been tested against a mocked Figma API, not inside real Figma.

**Other ways to log in.** `--cookie-file` (a Playwright login-state file, a JSON array of cookies, cookies.txt, or one "a=1; b=2" line), `--header-file file.json` (e.g. Authorization; sent to the start site only, never to third parties) and `--basic-auth-file` (first line `user:password`, or the environment variable `SITE_EXPLORER_BASIC_AUTH`). Do not write secrets directly on the command line (they stay in shell history); these values are never written to any output file, and cookies live only in a mode-600 temporary file that is deleted when the run ends.  With `--header`, each request is fetched by the tool first and then handed to the page (so a redirected request never carries the secret): live streams (EventSource) and media skip that layer, large downloads are held in memory first, and requests to other sites do not carry your cookies.

**Firefox / WebKit (experimental).** Run `site-explorer setup --browser firefox` (or `webkit`) once, then explore with `--browser firefox`. The core (pages, design tokens, health check, screenshots, dashboard) is tested on Firefox and WebKit by the `engines` CI workflow; the 3D / animation capture and mobile-network emulation remain Chromium-only. Windows and macOS run the same test suite in the `platforms` CI workflow.

**Verify masks.** `verify` accepts `--ignore <selector>` (repeatable) to exclude dynamic regions (ads, clocks, carousels); elements marked `data-verify-ignore` are excluded too; `--min-section <0-100>` fails the run when any single section scores below the threshold.

**Per-page Markdown.** The readable text of every page is written in document order to `content/<page>.md` (plus `INDEX.md`); links are written as `text (url)`, so the files never contain a clickable or tracking element.

### Trackers, cookies, structured data, tablet/phone, before/after

- **Trackers & cookies** — recognises nearly 40 services (39 today) (Google Analytics/GTM, Meta Pixel, Hotjar…), lists cookies (name, who sets it, lifetime, Secure/HttpOnly) and whether a cookie banner exists. It looks at the state "before a new visitor clicks any consent button"; **only names and flags are stored, never cookie values**. Trackers without a banner become a finding (whether that is a violation is for the owner to judge).
- **Structured data** — beyond "is there any": required properties per type (Product, Article, FAQ, LocalBusiness…), `@context`, and markup that only exists after JavaScript runs.
- **Tablet/phone, measured** — each page is measured at 1440 / 768 / 390: navigation style, side-by-side columns, type size, horizontal overflow, how much content a phone loses. Written into the report, dashboard and handoff — no guessed breakpoints.
- **Before/after** — rerun the same site and `changes.md` is written automatically; for an old site vs a staging domain use `site-explorer history compare <old run> <new run> --md changes.md`. Pages are matched by *path*; it lists vanished URLs (need a 301), pages that became noindex, dropped descriptions, big text loss, lost structured data.

### Handing over to an AI

The handoff starts at **`START-HERE.md`**: `PROMPT.md` (paste-ready prompts), `starter/` (runnable skeletons; structure, columns, spacing, backgrounds and phone navigation come from measurement), `starter/motion/index.html` (every observed animation/3D element running, with the reference filmstrip beneath), and `AI-PACKAGE.md` (single file). The dashboard's **Export for AI** tab offers the same with one-click copy.

## What's inside

| Component | Role |
|---|---|
| `.mcp.json` | Mounts Playwright MCP so Claude can drive the browser live |
| `scripts/explore.mjs` | Single entry: env check → crawl → design bundle → health → 3D → database → dashboard → handoff; a failing stage doesn't stop the others |
| `scripts/crawl.mjs` | Crawler; honours robots.txt (incl. Allow rules), detects blocking, handles cookie banners precisely, de-duplicates by final URL, section crops |
| `scripts/designer-extract.mjs`, `seo-extract.mjs` | In-page extraction: designer data; SEO / performance / structured data |
| `scripts/export-design.mjs` | Design bundle (tokens, Tailwind, W3C, Tokens Studio, palette SVG, font licensing) |
| `scripts/health-check.mjs`, `robots.mjs` | Health check; a Google-semantics robots.txt parser |
| `scripts/capture-3d.mjs`, `motion-ai.mjs` | 3D/animation capture; AI-readable translation |
| `scripts/starter.mjs`, `build-handoff.mjs` | Starter skeletons; the handoff package |
| `scripts/build-report.mjs`, `report/` | Offline dashboard (single file, images embedded) |
| `scripts/compare-report.mjs`, `db.mjs`, `doctor.mjs` | Comparison; database; diagnostics |
| `skills/`, `commands/`, `agents/` | Skills, commands and analysis agents for Claude Code |
| `test/` | `npm test`: end-to-end and regression tests (real three.js, deliberately broken sites, adversarial cases) |

Design trade-offs and review records: [`docs/ux-review.md`](docs/ux-review.md), [`docs/stakeholder-review.md`](docs/stakeholder-review.md) (in Chinese). **Not sure what the output looks like?** See [`docs/demo/`](docs/demo/) (real output on fictional sites).

## Boundaries

Honours robots.txt (stops and says so when a site forbids everything); identifies itself as automation (User-Agent `site-explorer-claude-plugin`); does not log in by default (to explore pages behind a login you sign in yourself with `site-explorer login` and pass `--storage-state` explicitly), does not submit forms, or bypass CAPTCHAs / bot protection; extra requests (robots, sitemap, link status, 404 probe) are concurrency-limited. When blocked it says so rather than reporting an empty result. Fonts, images, copy and 3D models are copyrighted: use them as reference only, don't copy. Use on public or authorised sites only.
