---
description: 查詢或比較以前探索過的網站（資料庫）
argument-hint: list | search --lib three | history <host> | compare <idA> <idB>
---

執行 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" history $ARGUMENTS` 並用白話整理結果。沒給參數時先執行 `list`。可用查詢：`search --lib three`、`search --platform WordPress`、`search --color "#e4572e"`、`search --font Georgia`、`search --has-3d`、`history <host>`、`compare <idA> <idB>`。資料庫需要 Node ≥ 22.13；若回報版本過舊，告訴使用者升級方式。
