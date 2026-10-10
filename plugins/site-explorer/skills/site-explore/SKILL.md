---
name: site-explore
description: 自動控制瀏覽器探索網站，取得網站設計（色彩/字型/間距）、網頁內容、版面排版與編輯方式（CMS/建站平台/後台入口）。當使用者要分析、拆解、複製參考、研究某個網站時使用。
---

# 網站探索流程

## 1. 自動爬取（批次、可重現）

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install --silent   # 僅首次
node "${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs" <url> --max-pages 10 --out ./site-report
```

選項：`--max-pages N`、`--depth N`（預設 2）、`--out DIR`、`--no-screenshots`。
若瀏覽器在別處，設 `CHROMIUM_PATH=/path/to/chromium`。

輸出（`<out>/<host>/`）：
- `report.md`：整合報告（先讀這份）
- `site.json`：全站彙整（設計權杖、技術棧、編輯方式、頁面清單）
- `pages/<slug>/page.json`：該頁內容、排版樹、設計資料
- `pages/<slug>/page.html`：渲染後 HTML
- `pages/<slug>/{desktop,tablet,mobile}.png`：三種視窗截圖

## 2. 互動補查（Playwright MCP 工具）

腳本抓不到的靠 `mcp__playwright__*` 工具補：
- 導覽選單/下拉/漢堡選單展開後的內容
- hover、focus、動畫、捲動觸發元件
- 彈窗、cookie banner、分頁籤、手風琴
- 需要點擊才出現的內容（載入更多、無限捲動）
- 用 `browser_snapshot` 看無障礙樹確認結構，用 `browser_take_screenshot` 看實際畫面

## 3. 整合回報

依四個面向回答，並引用輸出檔：
1. **設計**：色彩（主/輔/中性）、字型與字級階層、間距、圓角、陰影、CSS 變數
2. **內容**：站點地圖、每頁標題層級、主要文案、圖片/媒體、表單、CTA
3. **排版**：頁面區塊順序、grid/flex 使用、容器寬度、斷點行為（三張截圖比較）
4. **編輯方式**：建站平台/CMS（WordPress、Shopify、Wix、Webflow、Squarespace、Framer、Ghost、靜態框架…）、後台入口線索、內容是否由 API/靜態檔供應、建議的編輯途徑

## 規範

- 只分析公開可存取或使用者授權的網站，遵守 robots.txt 與合理的請求頻率。
- 不嘗試登入、猜密碼、繞過驗證；後台路徑只做存在性探測（HEAD/GET 狀態碼），不進入。
- 內容與設計屬原站所有，報告用於研究/參考，不要原樣重製受版權保護的素材。
