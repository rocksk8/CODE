---
description: 並排比較兩個網站（競品或改版前後）：色彩、字型、頁面骨架、網格、動態、對比
argument-hint: <網址A> <網址B>
---

比較 $ARGUMENTS 兩個網站：
1. 對兩個網址各執行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs" <url> --max-pages 3 --out ./compare-data`（已探索過的可直接用既有的 site 資料夾）。
2. 執行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/compare-report.mjs" --a <A 的 site 資料夾> --b <B 的 site 資料夾> --out ./compare.html`。
3. 用白話回報：兩者在版型順序、主色與字型、間距與圓角、動態節奏、對比與無障礙上的主要差異，並指出「如果我們要做出差異化，可以往哪裡走」。
