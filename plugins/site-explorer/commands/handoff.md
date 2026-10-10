---
description: 產生交接包：讓 AI 能做設計範本、讓後續開發知道所有該知道的資訊
argument-hint: <url> [最大頁數，預設 8]
---

使用 `site-to-design` skill 對 $ARGUMENTS 產生完整交接包：執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" handoff <url> --max-pages <N> --out ./explore-out`。完成後：
1. 讀 `explore-out/handoff/ai-brief.md`，並用 Read 直接檢視它列出的圖片；有 3D／影片再讀 `motion.md`。
2. 用 5 句內說明：這個網站的風格、頁面結構、值得注意的動態、健檢分數、以及 SPEC 第 11 節的「未知與限制」。
3. 告知交接包位置，並詢問下一步（建立 Claude Design 的 Design System、做設計稿，或直接交給開發）。
4. 之後做的任何設計／實作決策，都記錄到 `handoff/DECISIONS.md`。
