---
description: 視覺化擷取網站的 3D 與動畫，並翻譯成 AI 看得懂的文字、數據與影格序列圖
argument-hint: <url> [--frames 12] [--wait 2500]
---

使用 `capture-motion` skill 擷取 $ARGUMENTS 的 3D／動畫：執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" motion <url> --out ./motion-report`（在使用者目前的專案資料夾輸出）。完成後讀 `./motion-report/<host>/motion.md`（AI 可讀版），並用 Read 直接檢視其中列出的影格序列圖（單張 PNG）。AI 無法直接觀看 3D 或影片，以文字與數據為準。說明動作類型、使用技術、觸發方式與節奏；必要時用 Playwright MCP 互動補查。
