---
description: 自動探索網站，取得設計、內容、排版與編輯方式
argument-hint: <url> [最大頁數，預設 10]
---

使用 `site-explore` skill 探索這個網站：$ARGUMENTS

步驟：先執行爬取腳本取得結構化資料與截圖，再用 Playwright MCP 瀏覽器工具互動式補查（選單、彈窗、登入頁、動態內容），最後輸出整合報告。
