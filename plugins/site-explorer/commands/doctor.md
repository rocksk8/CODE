---
description: 檢查環境（Node、瀏覽器、ffmpeg、資料庫、網路）並給出修復指令
argument-hint: [url]
---

執行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" $ARGUMENTS`，逐項說明結果；對 ❌／⚠️ 項目，照輸出的修復指令協助使用者處理。
