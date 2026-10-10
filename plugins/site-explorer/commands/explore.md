---
description: 一鍵探索網站：設計、內容、排版、3D／動畫、編輯方式，並產生圖形化儀表板
argument-hint: <url> [最大頁數，預設 6]
---

使用 `site-explore` skill 探索 $ARGUMENTS：

1. 執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" explore <url> --max-pages <N> --out ./explore-out`（第一次會自動準備環境）
   （它會先做環境檢查，再依序爬取、整理設計包、SEO／爬蟲索引健檢、擷取 3D、存入資料庫、產生 `dashboard.html`、產生交接包 `handoff/`）。
2. 若環境檢查失敗，照它列出的修復指令處理；缺瀏覽器時先詢問使用者是否同意下載 Chromium（約 150 MB），同意才執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" setup --yes`；必要時改用 Playwright MCP 瀏覽器工具。
3. 讀 `explore-out/handoff/ai-brief.md`、`explore-out/site/<host>/health.md`，有 3D 時讀 `explore-out/motion/<host>/motion.md`；用 Read 直接檢視 `handoff/media/` 的圖片（AI 看不懂影片與 3D，以文字描述與影格序列圖為準）。
4. 回報：用 5 句內說明最重要的發現，告知 `dashboard.html` 位置，並詢問使用者是否要接著用 `/site-explorer:to-design` 做成 Claude Design 的設計系統。
