---
description: 網站健檢：SEO、爬蟲索引、連結、效能、行動版、安全、AI 爬蟲友善度
argument-hint: <url> [最大頁數，預設 12]
---

使用 `site-health` skill 對 $ARGUMENTS 做健檢：執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" health <url> --max-pages <N> --out ./explore-out`，然後讀 `explore-out/site/<host>/health.md`。回報：總分與等級、最該先處理的 3–5 件事（附修法與影響頁數）、已通過的項目、限制（抽樣、實驗室數據）。告知儀表板（`explore-out/dashboard.html`）的「健檢」分頁位置。
