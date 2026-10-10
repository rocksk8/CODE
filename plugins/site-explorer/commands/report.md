---
description: 把探索與動態擷取結果做成圖形化儀表板（單一 HTML）
argument-hint: <url>
---

對 $ARGUMENTS 依序執行：`scripts/crawl.mjs`、`scripts/capture-3d.mjs`，再用 `scripts/build-report.mjs --site <site-report/host> --motion <motion-report/host> --out ./dashboard.html` 產生儀表板。完成後告訴使用者 `dashboard.html` 的位置（Mac 可用 `open dashboard.html` 開啟），並用三五句話說明最重要的發現。
