---
description: 一次搞定環境：檢查 Node、安裝相依套件、找瀏覽器（經同意才下載）、冒煙測試
argument-hint: [--with-ffmpeg]
---

執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" setup $ARGUMENTS`（需要時它會在終端機詢問；你在無法互動的環境，請先告訴使用者將下載 Chromium 約 150 MB，取得同意後才加 `--yes` 重跑）。用白話說明每一項結果；失敗時照它列出的修復指令處理。
