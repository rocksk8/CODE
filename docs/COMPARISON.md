# 與同類軟體的差異

查證日期：2026-10-11。對手的資料只取自各專案自己的 GitHub README（連結在文末），沒讀到的就寫「未提及」，不推測；「未提及」只代表那份說明頁沒寫，不代表一定沒有。site-explorer 這一欄只列已實作並有測試的功能。

## 一句話定位

site-explorer 是「把一個網站完整看一遍，再交給 AI 或工程師照著重建」的工具：設計 token、版面、3D／動畫、SEO／索引健檢、追蹤碼、前後對照、可執行的 starter、重建驗證，都在同一次執行裡完成。對手大多各自只做其中一段。

## 功能對照

| 能力 | site-explorer | dembrandt | extract-design-system | tokenscout |
|---|---|---|---|---|
| 抽出色彩、字型、間距、圓角、陰影、斷點 | 有 | 有（另有 icons、logo） | 有（斷點未提及） | 有（色彩以 CIELAB deltaE2000 分群） |
| token 輸出格式 | CSS、JSON、W3C DTCG、Tokens Studio、Tailwind v3 設定與 v4 `@theme`（OKLCH）、`DESIGN.md`、色票 SVG | DTCG、`DESIGN.md`、Tailwind、shadcn、HTML 報告、brand guide | W3C 相容 `tokens.json`、`tokens.css` | DTCG；CSS 變數與 Tailwind 靠另一個 transform 套件 |
| 多頁爬取 | 有（遵守 robots.txt，會讀 sitemap） | 有（`--crawl`、`--sitemap`，合併多頁） | 否（一次一個網址） | 未提及 |
| 3D／動畫 | 擷取畫格、偵測 three.js 等函式庫、CSS 動畫、互動狀態 | 有 motion 抽取；README 自述 canvas／WebGL 網站無法分析 | 未提及 | 只輸出 CSS 動畫時長；JS 動畫擷取為實驗性 |
| SEO／索引健檢並給分數與修法 | 有（8 類，含 robots、sitemap、連結、安全標頭、憑證、結構化資料、AI 爬蟲友善度） | 未提及 | 未提及 | 未提及 |
| 追蹤碼與 Cookie 清單 | 有（39 種服務；不存 Cookie 值） | 未提及 | 未提及 | 未提及 |
| 無障礙 | `--a11y` 用 axe-core 做 WCAG 2.2 AA（選用） | 真實 DOM 配色的 WCAG 2.1 對比檢查 | 未提及 | 對比為近似值 |
| 前後對照與歷史 | `changes.md`、歷史資料庫、Action 的 `max-drop`／`fail-on-new` | 本機 `--compare`／`--approve` 偏移檢查（失敗時結束碼 1）、GitHub Action | 未提及 | 未提及 |
| GitHub Action | 有（PR 留言、`fail-on`、`min-health`、`max-drop`、`fail-on-new`） | 有（Marketplace，標註 PR） | 未提及 | 未提及 |
| MCP | 4 個工具（探索、健檢、驗證、讀交接包） | 多個工具（token、偏移、DTCG、DESIGN.md 等） | 有（3 個工具） | 沒有（README 說明不維護 MCP） |
| 登入後頁面 | `login` 手動登入一次，之後用 storage state；輸出不含 Cookie 值，也不寫入共用資料庫 | `--cookie`、`--cookie-file`、`--basic-auth`、`--header`、互動式 `--login` | 否（公開網站） | 未提及 |
| 給 AI 的交接包與可執行 starter | 有（START-HERE、可直接貼的提示、starter 頁面骨架、規格） | 未提及 | 未提及 | 「rebuild evidence pack」（證據包），未提及可執行 starter |
| 重建驗證（重建結果對照原站逐區塊評分，附差異圖） | 有（`verify`，衡量版面：高度、明暗結構、顏色） | 未提及 | 未提及 | 未提及 |
| React／Vue／Astro 專案與 shadcn 主題 | 有（從 starter 轉出） | 只有 shadcn 主題 | 否 | 否 |
| 離線單檔儀表板 | 有 | `--html` 報告與選用 app | 未提及 | 未提及 |

## 相鄰類別的功能（本版新增，附對照）

下表只列 site-explorer 已實作且有測試的能力；對手那一欄只引用該專案 README（見文末連結）寫了的內容。

| 能力 | site-explorer | 相鄰工具（README 自述） |
|---|---|---|
| 技術堆疊偵測 | `techstack.md/json`：約 55 種技術，依腳本網址、回應標頭、Cookie、generator、全域變數，附證據與信心 | Wappalyzer（HTTPArchive 分支）：以 HTML、JS 變數、標頭、Cookie、DNS、meta、腳本網址比對指紋資料庫；我們的規則表小得多，沒有 DNS 比對 |
| 效能預算與歷次紀錄 | `--budget`（ttfb、fcp、lcp、load、cls、總 KB、請求數、第三方請求、阻擋渲染腳本、DOM 節點）＋ `perf-history.json`（最近 60 筆） | Lighthouse CI：斷言、預算、伺服器儀表板與差異介面、多次執行降低變異；我們是 Playwright 實測的實驗室數據，沒有 Lighthouse 分數、也沒有儀表板伺服器 |
| `verify` 區域遮罩與門檻 | `--ignore <選擇器>`、`data-verify-ignore`、`--min-section` | BackstopJS、Lost Pixel 有遮罩與敏感度門檻；我們的遮罩只用在 `verify` 的逐區塊比對 |
| 指紋、錄製與輸入外流偵測 | `tracking-behaviors.md/json`：canvas／WebGL／音訊指紋、字型探測、11 種錄製／熱點圖服務、輸入文字是否送往其他網站（探針不送出表單） | Blacklight collector（GPL-3.0）：canvas／字型指紋、key logging、session recorder 等，另有事件與 HAR；我們是獨立實作，偵測面較少，也沒有 HAR |
| 整頁視覺回歸 | `--approve`／`--compare` 連同桌機、平板、手機整頁截圖逐像素比對，門檻與差異圖，結束碼 4 | BackstopJS：情境腳本（點擊、懸停、Cookie）、等待條件、Docker 渲染、HTML 報告與核准流程；我們沒有情境腳本，也沒有互動式核准介面 |
| 頁面封存 | `--archive`：每頁一個離線單一 HTML（CSS、圖片內嵌，移除腳本） | SingleFile：完整單檔與註解、使用者腳本；ArchiveBox／Browsertrix：WARC／WACZ。我們沒有 WARC，也不處理需要腳本才能顯示的內容 |
| 安全標頭與 TLS 評等 | `security.md/json`：標頭 A+～F、TLS 協定版本與憑證評等，每項附修正方式 | MDN HTTP Observatory：10 項標頭測試加分數與字母等級；SSL Labs：協定、金鑰交換、加密強度加權評分。我們的評分規則是自訂的，沒有逐字對照它們的公開評分表，也不測密碼套件強度 |
| SARIF／JUnit | `--sarif`、`--junit`，Action 輸出檔案路徑 | BackstopJS 輸出 JUnit；Nuclei 輸出 SARIF |
| Figma | `figma/*.svg` 圖層化版面草稿 ＋ Tokens Studio 設計變數 | html.to.design、Builder.io figma-html：直接由網址或瀏覽器擴充功能轉成可編輯設計稿（含 auto layout）；我們的 SVG 沒有 auto layout，文字只取前 50 字，圖片是佔位 |
| HTML 有效性 | 健檢納入保守的原始 HTML 檢查 | Nu Html Checker：完整的 HTML／CSS／SVG 驗證；我們只報確定有問題的，沒有內容模型驗證 |
| 自訂擷取 | `--extract` CSS 選擇器與 regex，輸出 CSV／JSON | Screaming Frog 有 XPath／CSS／regex 擷取（只看到搜尋摘要，官網在本環境無法連線，未能查證其細節） |
| 逐頁 Markdown 匯出 | 每頁 `content.md` | Crawl4AI、Firecrawl 以此為核心；我們是附帶輸出，沒有託管或 SDK |
| 本機偏移基準 | `--approve`／`--compare`（設計 token、健檢分數、新問題、整頁畫面） | dembrandt 有互動式管理與選用 app；我們只有指令列 |

## 其他類別的工具（只做其中一段）

| 工具 | 它做什麼 | 與 site-explorer 的關係 |
|---|---|---|
| Lighthouse CI、Unlighthouse | 用 Lighthouse 跑整站或每次提交，Lighthouse CI 有效能預算、分數追蹤、差異頁面 | 偏效能與品質稽核；site-explorer 的效能檢查比較簡單，不是完整 Lighthouse |
| Pa11y、`@axe-core/cli` | 單頁無障礙檢查（Pa11y 可選 htmlcs 或 axe；axe CLI 說明它不是爬蟲） | site-explorer 的 `--a11y` 用同一個 axe-core，但是在整站爬取裡順便跑 |
| Crawl4AI、Firecrawl | 把網頁轉成 Markdown／JSON 給 LLM，含深度爬取、Docker／雲端、多語言 SDK | 通用抓取；site-explorer 目標是設計與重建，不是內容轉 Markdown |
| screenshot-to-code | 用 LLM 把截圖、設計稿、影片轉成 HTML／React／Vue 等程式碼（需要 API 金鑰） | 起點是圖片、靠模型生成；site-explorer 是量測真實網站，沒有用模型生成，文案與圖片一律是佔位 |
| Playwright MCP | 讓 AI 操作瀏覽器（無障礙樹快照） | 通用瀏覽器工具，沒有設計 token 或 SEO 稽核；README 自述不是安全邊界 |
| Project Wallace css-analyzer | 分析 CSS 字串的統計 | 只吃 CSS 文字，不開瀏覽器 |

## 對手有、我們沒有（或我們比較弱）

- dembrandt：stealth 模式、brand guide 輸出、互動式偏移基準管理與選用 app、cookie／basic auth／自訂標頭等多種登入方式（我們只支援 storage state）。
- Crawl4AI：Firefox 與 WebKit、代理與輪替、通用的 LLM 抽取。
- Lighthouse 系列：完整的 Lighthouse 稽核分數與伺服器儀表板（我們只有 Playwright 實測的指標與預算）。
- Firecrawl、Crawl4AI：託管服務與多語言 SDK。
- BackstopJS：情境腳本與核准介面；Wappalyzer：大型指紋資料庫；Blacklight：HAR 與更多偵測項目；html.to.design：auto layout 與直接由網址轉換。
- 我們只用 Chromium，也只在 Linux 實測。
- 刻意不做：判斷網站是否由 AI 生成（準確度證據不足，容易誤判）、弱點掃描（需要授權）。

## 我們自己標明的限制

- 純 canvas／WebGL 頁面抓不到 DOM 文字結構，只能報告能量測的部分，並會明說。
- `verify` 的分數衡量版面，不比對文字與照片。
- DNS 重新綁定、Docker 映像內瀏覽器無沙箱、第三方 Action 以標籤而非 commit 固定，都已記錄為已知限制（見 `docs/TEST-REPORT.md`）。
- 無法在本環境實測：Docker 容器執行、真實 GitHub runner 上的 Action、真實登入流程、Windows／macOS。

## 資料來源（2026-10-11 開啟）

- dembrandt：https://github.com/dembrandt/dembrandt
- extract-design-system：https://github.com/arvindrk/extract-design-system
- tokenscout：https://github.com/Atroci/tokenscout
- screenshot-to-code：https://github.com/abi/screenshot-to-code
- Crawl4AI：https://github.com/unclecode/crawl4ai
- Firecrawl：https://github.com/firecrawl/firecrawl
- Unlighthouse：https://github.com/harlan-zw/unlighthouse
- Lighthouse CI：https://github.com/GoogleChrome/lighthouse-ci
- Playwright MCP：https://github.com/microsoft/playwright-mcp
- Wappalyzer（HTTPArchive 分支）：https://github.com/HTTPArchive/wappalyzer
- wappalyzergo：https://github.com/projectdiscovery/wappalyzergo
- BackstopJS：https://github.com/garris/BackstopJS
- Lost Pixel：https://github.com/lost-pixel/lost-pixel
- SingleFile：https://github.com/gildas-lormeau/SingleFile
- ArchiveBox：https://github.com/ArchiveBox/ArchiveBox
- Browsertrix：https://github.com/webrecorder/browsertrix
- Blacklight collector：https://github.com/the-markup/blacklight-collector
- MDN HTTP Observatory：https://github.com/mdn/mdn-http-observatory
- Builder.io figma-html：https://github.com/BuilderIO/figma-html
- Nuclei：https://github.com/projectdiscovery/nuclei
- Nu Html Checker：https://github.com/validator/validator
- Pa11y：https://github.com/pa11y/pa11y
- axe-core CLI：https://github.com/dequelabs/axe-core-npm
- Project Wallace css-analyzer：https://github.com/projectwallace/css-analyzer

未能查證（官網在本環境無法連線，只看到搜尋摘要或完全沒有資料，因此不比較細節）：Screaming Frog、Sitebulb、SSL Labs 官網、html.to.design 官網、Percy、Chromatic、BuiltWith。
