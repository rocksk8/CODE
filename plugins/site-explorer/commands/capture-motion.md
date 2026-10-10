---
description: 視覺化擷取網站的 3D 與動畫（畫格序列、捲動、互動、錄影）
argument-hint: <url> [--frames 12] [--wait 2500]
---

使用 `capture-motion` skill 擷取 $ARGUMENTS 的 3D／動畫：執行 `scripts/capture-3d.mjs`，逐張檢視輸出的 PNG 畫格，結合 `motion.json` 說明動作類型、使用技術、觸發方式與節奏；必要時用 Playwright MCP 互動補查。
