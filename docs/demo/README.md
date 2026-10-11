# Demo output (fictional sites)

Real output of the current version against the fictional fixture sites in `plugins/site-explorer/test/fixtures/` (Acme Studio, and a WebGL + CSS-3D + video page). **Not an analysis of a real website.**
Regenerate with `node plugins/site-explorer/tools/make-demo.mjs`.

| Folder | What | Look at |
|---|---|---|
| `acme-studio/dashboard.html` | single-file dashboard (double-click) | overview, design, layout, health, **Export for AI** tab, **Details** switch |
| `acme-studio/handoff/` | the handoff package for the marketing site | `START-HERE.md`, `PROMPT.md`, `starter/index.html` (runnable skeleton), `ai-brief.md`, `SPEC.md`, `media/sections/` |
| `three-demo/dashboard.html` | dashboard with WebGL, CSS 3D and video | "3D／動畫" tab (frame player), live motion preview on the overview |
| `three-demo/handoff/` | handoff with motion | `starter/motion/index.html` (every animation running next to its filmstrip), `motion.md`, `media/motion/*-filmstrip.png` |

---

# Demo 輸出（虛構網站）

用目前版本對 `test/fixtures/` 內的**虛構網站**實際跑出來的結果；**不是真實網站的分析**。重新產生：`node plugins/site-explorer/tools/make-demo.mjs`。
