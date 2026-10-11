# site-explorer（Claude Code 套件）

讓 Claude 自動控制瀏覽器探索網站，並把結果整理成**人看得懂、AI 看得懂、開發接得住**的形式：

- 🎨 **設計**：色彩、字型（含授權與替代）、間距、元件、版面網格、動態節奏
- 🧱 **結構**：自動辨識 Hero／功能格／價格／見證／CTA…，逐區塊裁切與骨架圖
- 🌀 **3D／影片／動畫**：AI 看不懂它們，所以翻譯成「文字描述＋量化數據＋three.js 場景事實＋單張影格序列圖」
- 🩺 **網站健檢**：SEO、爬蟲索引（robots／sitemap／canonical／noindex／soft 404／JS 依賴）、連結、效能、行動版、安全、AI 爬蟲友善度
- 📦 **交接包**：`ai-brief.md`＋`SPEC.md`＋`spec.json`＋`DECISIONS.md`＋圖片，讓 AI 做設計範本、讓後續開發知道所有該知道的事
- 🗄️ **本機資料庫**：累積每次探索，搜尋、比較、追蹤改版與健檢分數變化

## 安裝（一次搞定）

需要 Node 20+（歷史資料庫功能需 22.13+）。瀏覽器：Chrome／Edge／Chromium 任一個即可；都沒有時 `setup` 會在你同意後下載 Chromium。

**在 Claude Code 裡（建議）**
```
/plugin marketplace add rocksk8/code
/plugin install site-explorer@rocksk8-code
```
安裝後每次開啟工作階段，hook 會在背景把相依套件裝到 `~/.site-explorer/deps`（只裝一次、不卡住啟動、外掛更新後仍保留）。之後直接說「幫我分析 https://example.com」，或用 `/site-explorer:explore`。第一次可執行 `/site-explorer:setup` 確認環境。

**在終端機**（請一行一行貼，不要貼「#」開頭的說明文字）
```bash
npm i -g git+https://github.com/rocksk8/CODE.git
```
```bash
site-explorer setup
```
```bash
site-explorer example.com
```
`setup` 會檢查 Node → 安裝相依 → 找瀏覽器 → 冒煙測試；`site-explorer doctor` 在出問題時列出每項的修復指令。
不用 `github:rocksk8/code` 的簡寫，因為 npm 會改走 SSH，沒設定 SSH 金鑰的電腦會被拒絕。
免安裝：`npx git+https://github.com/rocksk8/CODE.git example.com`。

**輸出位置**：預設在目前資料夾的 `explore-out/`。用 `--out <資料夾>` 指定，或設環境變數 `SITE_EXPLORER_OUT` 一次指定。資料夾根目錄會自動放 `ABOUT-THIS-FOLDER.md`（這是什麼、看哪裡、怎麼重跑）和 `runs.json`（做過哪些網站），日後打開就知道來歷。

貢獻者：`cd plugins/site-explorer && npm run test:full`。

## 指令

| 指令 | 做什麼 |
|---|---|
| `/site-explorer:explore <url>` | 一鍵探索，產生儀表板與交接包 |
| `/site-explorer:handoff <url>` | 產生交接包，並說明風格、結構、動態、健檢與未知 |
| `/site-explorer:health <url>` | 網站健檢（SEO／索引／連結／效能／行動／安全／AI 爬蟲） |
| `/site-explorer:to-design <url> [要做的設計]` | 探索 → 交接包 → 建立 Claude Design 的 Design System → 設計稿 |
| `/site-explorer:capture-motion <url>` | 只做 3D／動畫擷取（AI 可讀） |
| `/site-explorer:compare <A> <B>` | 並排比較兩個網站（競品／改版前後） |
| `/site-explorer:report <url>` | 分階段產生儀表板 |
| `/site-explorer:history list｜search --lib three｜history <host>｜compare a b` | 查詢、比較以前探索過的網站 |
| `/site-explorer:doctor [url]` | 環境診斷 |

## 讓 AI 看得懂：3D、影片、動畫、超長頁面

AI 只能讀文字和圖片。所以：

| 原始內容 | AI 拿到的 |
|---|---|
| three.js／WebGL 場景 | 物件清單（名稱、幾何、材質色、光源）、相機（fov／位置）、**哪些物件在轉**、每幀 draw call，加影格序列圖 |
| 影片 | 時長、解析度、自動播放／循環／靜音、來源，加 0／25／50／75% 的畫格 |
| 一般動畫 | 是否自走、週期、變化量與集中區域、主色、是否回應滑鼠／拖曳／捲動，加影格序列圖 |
| CSS 3D／keyframes | transform／perspective、keyframes 原文、時長與緩動、重現建議 |
| 超長整頁截圖（會被縮到看不清） | 每個區塊一張裁切圖（≤ 1800px 高） |

全部寫進 `motion.md`，並在每項註明「AI 無法直接觀看，請以文字與數據為準」。

## 交接包 `handoff/`

| 檔案 | 給誰／用途 |
|---|---|
| `ai-brief.md` | **AI 先讀**：風格一句話、可貼的 CSS token、元件、頁面骨架（含真實內容結構）、文案語氣、必守規則、該先看的圖 |
| `SPEC.md`／`spec.json` | 完整規格：資訊架構、設計系統、元件、各頁各區塊內容、動態、素材、技術與編輯方式、健檢、實作順序、**未知與限制** |
| `motion.md`、`health.md` | 動態與健檢 |
| `DECISIONS.md` | **持續更新**的決策紀錄、待確認問題、假設、擷取紀錄（誰在何時用什麼身分讀了哪些頁面） |
| `CLAUDE.md` | 給在此資料夾工作的 AI：怎麼讀、不能做什麼、每個決策都要記錄 |
| `tokens/`、`media/` | css／W3C／Tokens Studio／Tailwind／色票 SVG；區塊裁切圖、影格序列圖、品牌素材 |

整包可獨立搬移：文件中引用的每個檔案都在包內（有測試保證）。

## 設計師工作台（儀表板）

| 你想做的事 | 功能 |
|---|---|
| 「這個標題是什麼字型、多大、什麼色？」 | **檢視元素**：游標移上截圖即時顯示字型、字級、色碼、對比、間距、圓角；點擊釘選並複製 CSS |
| 「這頁怎麼組成？」 | **區塊切片**＋**頁面骨架**，並標示「推測依據」 |
| 「手機版怎麼重排？」 | **響應式並排**（捲動同步） |
| 「這字型我能用嗎？」 | **字型來源**（Google／Adobe／自架／系統）與替代建議 |
| 「哪些字看不清？」 | **真實背景對比檢查** |
| 「帶進 Figma」 | `palette.svg`、`tokens.studio.json` |
| 「SEO 哪裡有問題？」 | **健檢**分頁：分數、問題清單（為什麼重要＋怎麼修＋範例）、頁面一覽、robots／AI 爬蟲、sitemap、效能、安全 |
| 「和競品比」 | `/site-explorer:compare` |

## 網站健檢涵蓋

索引與爬取 25%・頁面 SEO 20%・連結 10%・效能 15%・行動版 10%・安全與傳輸 10%・結構化資料與社群 5%・AI 爬蟲友善度 5%。評分有遞減效果，且出現「嚴重」問題（全站被擋、全站 noindex、無 HTTPS、憑證過期）時總分上限 55。**分數是相對指標，不是 Google 的評分**；只分析本次爬取的頁面（抽樣）；效能為實驗室數據。

健檢報告最上面有**驗收結論**（通過／有條件通過／不通過）。給自動化用：`site-explorer explore <網址> --fail-on high`，有「高」以上問題時以結束代碼 4 結束。再跑一次同一個網站，報告會列出「新出現／已修復」的問題。

### 追蹤碼、Cookie、結構化資料、手機／平板、改版前後

- **追蹤碼與 Cookie**：辨識 Google Analytics／GTM、Meta Pixel、Hotjar 等 40 多種服務，列出 Cookie（名稱、誰設的、有效期、Secure／HttpOnly）與是否有 Cookie 橫幅。看的是「新訪客還沒點任何同意按鈕」時的狀態；**只記名稱與旗標，不記 Cookie 的值**。有追蹤碼卻沒橫幅會列為健檢問題（是否違規由負責人判斷）。
- **結構化資料**：不只看「有沒有」，還檢查各類型（Product、Article、FAQ、LocalBusiness…）的必填欄位、`@context`，以及標記是否只在執行 JavaScript 後才出現。
- **手機／平板實測**：在 1440／768／390 三種寬度各量一次——導覽是連結還是選單按鈕、並排欄數、字級、橫向溢出、手機版少掉多少內容；寫進報告、儀表板與交接包，不再用預設斷點猜。
- **改版前後對照**：同一網站再跑一次會自動產生 `changes.md`；舊站與新站在不同網域（例如測試站）時用 `site-explorer history compare <舊 run> <新 run> --md 對照.md`，以「路徑」對應頁面，列出消失的網址（需要 301）、變成 noindex、description 被拿掉、文字大減、結構化資料不見等風險。交接包另有 `inventory.csv`（所有頁面清單，Excel 可開）。

### 交給 AI 直接開工（匯出）

交接包（`handoff/`）現在從 **`START-HERE.md`** 開始：
- **`PROMPT.md`**：可直接貼給 AI 的提示（A＝做頁面、B＝做動態／3D、C＝兩者）。
- **`starter/`**：可執行的頁面骨架（HTML＋CSS，結構、欄數、間距、手機導覽都來自實測；文案與圖片一律是佔位）；以及 **`starter/motion/index.html`**——把每個擷取到的動畫／3D 元素跑起來（CSS keyframes、three.js 骨架，帶入實測的顏色、鏡頭、轉速），下面附參考畫格序列圖，AI 可逐張比對修正。
- **`AI-PACKAGE.md`**：單一檔案版（說明＋簡報＋token＋起手 CSS／頁面＋動態程式），AI 讀不了資料夾時貼這個，再附上區塊截圖與畫格序列圖。
- 儀表板的「**匯出給 AI**」分頁：選目標、一鍵複製提示（可附資料夾絕對路徑）、檢查有沒有空白頁／被擋頁、每個檔案可複製或下載。

### 儀表板

總覽改成視覺優先：桌機／平板／手機的實際畫面、健檢分數、品牌色（點一下複製）、字型，下方是「每一頁長什麼樣」的縮圖牆（點開看全頁與各尺寸）與動態預覽（擷取到的畫格循環播放）。右上角的「**詳細資料**」開關會顯示每頁的技術細節，並多出「詳細資料」分頁：逐頁數據表與可展開、可下載的原始 JSON（site／tokens／motion／health…）。

## 內容

| 元件 | 作用 |
|---|---|
| `.mcp.json` | 掛載 Playwright MCP，Claude 可即時操作瀏覽器 |
| `scripts/explore.mjs` | 單一入口：環境檢查→爬取→設計包→健檢→3D→資料庫→儀表板→交接包；單階段失敗不中斷其他 |
| `scripts/crawl.mjs` | 爬取；遵守 robots.txt（含 Allow 規則）、偵測被擋、處理 Cookie 橫幅、依最終網址去重、區塊裁切圖 |
| `scripts/designer-extract.mjs`、`seo-extract.mjs` | 頁面內擷取：設計師資料；SEO／效能／結構化資料 |
| `scripts/export-design.mjs` | 設計包（tokens、Tailwind、W3C、Tokens Studio、色票 SVG、字型授權） |
| `scripts/health-check.mjs`、`robots.mjs` | 健檢；Google 語意的 robots.txt 解析器 |
| `scripts/capture-3d.mjs`、`motion-ai.mjs` | 3D／動畫擷取；AI 可讀化（three.js 場景、影片、量化、影格序列圖） |
| `scripts/build-handoff.mjs` | 交接包 |
| `scripts/build-report.mjs`、`report/` | 離線儀表板（可單檔內嵌圖片分享） |
| `scripts/compare-report.mjs`、`db.mjs`、`doctor.mjs` | 比較；資料庫；環境診斷 |
| `skills/`、`commands/`、`agents/` | `site-explore`、`site-to-design`、`site-health`、`capture-motion` 與對應指令、分析 agent |
| `test/` | `npm test`：端到端與回歸測試（含真實 three.js、故意有毛病的網站、對抗性案例） |

設計取捨與審視記錄見 [`docs/ux-review.md`](docs/ux-review.md)、[`docs/stakeholder-review.md`](docs/stakeholder-review.md)（四角度審視與已知缺口）。**不知道輸出長怎樣？** 看 [`docs/demo/`](docs/demo/)（虛構網站的實際輸出）。

## 邊界

遵守 robots.txt（網站全面禁止時會明確說明並停止）；明確標示為自動化工具（User-Agent：`site-explorer-claude-plugin`）；不登入、不送出表單、不繞過驗證碼或防機器人；額外請求（robots、sitemap、連結狀態、404 探測）限制併發。被擋住時會明確標示而不是回報空白結果。字型、圖片、文案、3D 模型受版權保護，只供參考，不要複製。僅用於公開或已授權的網站。
