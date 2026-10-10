---
name: site-explore
description: 自動控制瀏覽器探索網站，取得網站設計（色彩/字型/間距）、網頁內容、版面排版與編輯方式（CMS/建站平台/後台入口）。當使用者要分析、拆解、複製參考、研究某個網站時使用。 Use when asked to analyze, audit, tear down or reverse-engineer a website (design, fonts, colors, layout, content, tech stack, how it is edited).
---

# 網站探索流程

## 0. 最快路徑：一個指令
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" explore <url> --max-pages 6 --out ./explore-out
```
會依序：環境檢查 → 爬取 → 設計包 → 3D 擷取 → 存入資料庫 → 儀表板（`explore-out/dashboard.html`）。任一階段失敗不影響其他階段。可加 `--no-motion`、`--no-db`。
遇到問題先跑 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" doctor <url>`。以下是分階段用法。

## 1. 自動爬取（批次、可重現）

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" crawl <url> --max-pages 10 --out ./site-report
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

腳本抓不到的靠 Playwright MCP 的瀏覽器工具（如 `browser_snapshot`、`browser_take_screenshot`）補：
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

## 延伸：串接 Claude Design
探索完若使用者要做設計，改用 `site-to-design` skill：`node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" design <out>/<host>` 產生設計包，再建立 Design System artifact。
若網站有 3D 或動態效果（WebGL、three.js、捲動動畫），改用 `capture-motion` skill 做視覺化擷取。

## 圖形化儀表板
完成後建議產生可視化報告：`node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" report --site <out>/<host> [--motion <motion-out>/<host>] --out ./dashboard.html`。內含色票、字型實際渲染、按鈕 hover、桌機/平板/手機切換、區塊地圖、標題大綱、3D 畫格播放器與捲動序列。

## 歷史與比較
每次 `explore.mjs` 會把摘要存進本機資料庫（`~/.site-explorer/explorations.db`，需 Node ≥ 22.13）。用 `node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" history list | search | history <host> | compare <a> <b>` 回頭查「誰用了 three.js」「主色偏橘的網站」「這個網站改版了什麼」。

## 被擋住時
`site.json` 的 `blockedPages` 與儀表板會標示被擋原因（403、驗證碼、防機器人頁）。不要硬闖或繞過；降低頻率、確認授權，或改用 Playwright MCP 以真實瀏覽器互動。

## 設計師常見需求（儀表板已內建）
- 看某元素的字型／色碼／間距：儀表板「排版」→「截圖／檢視元素」，游標指上去；`page.json` 的 `designer.elements` 有原始資料
- 頁面由哪些區塊組成：`designer.blocks`（kind：header／hero／features／pricing／testimonial／faq／form／logos／stats／gallery／cta／footer）
- 字型能否商用與替代：設計包 `tokens.json` 的 `typography.sources`
- 競品並排：`node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" compare --a <site dir> --b <site dir>`
- 帶進 Figma：設計包的 `palette.svg`、`tokens.studio.json`
