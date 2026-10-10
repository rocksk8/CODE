---
description: 把探索與動態擷取結果做成圖形化儀表板（單一 HTML）
argument-hint: <url>
---

對 $ARGUMENTS 依序執行（都在使用者目前的專案資料夾輸出，不要 cd 到外掛目錄）：
1. `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" crawl <url> --out ./site-report`
2. `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" motion <url> --out ./motion-report`
3. `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" report --site ./site-report/<host> --motion ./motion-report/<host> --out ./dashboard.html`

完成後告訴使用者 `dashboard.html` 的位置（單一檔案，雙擊即可開啟），並用三五句話說明最重要的發現。（一次做完全部請改用 `/site-explorer:explore`。）
