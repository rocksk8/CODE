<div align="center">

# site-explorer

**讓 AI 真的「看懂」一個網站，然後接手把它做出來。**

一行指令，把任何公開網站變成 AI 與工程師都接得住的交接包：設計 token、**可執行的頁面骨架**、動畫／3D 的文字化描述、SEO／健檢報告，外加一個離線儀表板。

[![test](https://github.com/rocksk8/CODE/actions/workflows/test.yml/badge.svg)](https://github.com/rocksk8/CODE/actions/workflows/test.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A520-green)

[English](README.en.md) · **繁體中文** · [範例輸出](docs/demo/) · [儀表板截圖](docs/images/)

![site-explorer 儀表板導覽](docs/images/demo.gif)

</div>

```bash
npm i -g git+https://github.com/rocksk8/CODE.git
site-explorer setup
site-explorer https://example.com
```

跑完會得到一個資料夾：雙擊 `dashboard.html` 看總覽；把 `handoff/` 整包丟給 AI，再貼上 `PROMPT.md` 裡的提示，它就能開始做頁面與動態——不用你寫一行說明。

## 它做什麼

| | |
|---|---|
| ![](docs/images/dashboard-overview.png) | **看得見的總覽**：桌機／平板／手機的實際畫面、健檢分數與驗收結論、品牌色（點一下複製）、字型、每一頁的縮圖牆。右上角「詳細資料」開關可展開每頁技術數據與原始 JSON。 |
| ![](docs/images/starter-vs-original.png) | **可執行的頁面骨架**：依實測的區塊結構、欄數、間距、背景／漸層、手機導覽產生 `starter/*.html`；文案與圖片一律是佔位，不複製原站內容。左：原站；右：自動產生的起手式。 |
| ![](docs/images/dashboard-motion-preview.png) | **3D／影片／動畫翻成 AI 看得懂的形式**：three.js 場景事實、哪些物件在轉、影片規格，加單張影格序列圖；`starter/motion/index.html` 把每個動畫跑起來，旁邊附參考畫格。 |
| ![](docs/images/dashboard-export.png) | **一鍵匯出給 AI**：選目標（頁面／動態／兩者），複製現成提示；`AI-PACKAGE.md` 是單檔版，AI 讀不了資料夾時用。 |
| ![](docs/images/dashboard-health.png) | **網站健檢**：SEO、爬蟲索引、連結、效能、行動版、安全、結構化資料、追蹤碼與 Cookie、AI 爬蟲友善度；有驗收結論（通過／有條件／不通過）與 `--fail-on` 給 CI 用。 |

## 和別的工具差在哪

| 你可能會用 | 它做得好的 | site-explorer 補的 |
|---|---|---|
| Lighthouse／PageSpeed | 效能、無障礙、最佳實務的標準分數 | 它不看「設計長什麼樣」，也不產生給 AI 的交接資料 |
| axe／WAVE | 無障礙規則 | 同上；本工具另含 SEO 索引、追蹤碼、前後對照 |
| Wappalyzer／BuiltWith | 技術偵測 | 只偵測；不擷取設計、不產生可用的骨架 |
| 截圖轉程式碼的 AI 工具 | 單張圖產生頁面 | 通常只有一張圖，沒有實測的區塊結構、token、動畫數據、響應式行為 |
| SiteSucker／wget | 整站下載 | 下載的是別人的檔案；本工具只記錄觀察到的事實並以佔位內容重建 |

**定位**：探索 → 交接 →（讓 AI）重建。它不取代 Lighthouse 或 axe；它把「一個網站實際長怎樣、怎麼運作」整理成 AI 讀得懂的資料。

## 適合誰

- **改版／重做網站**：舊站的頁面清單（含 301 需求）、內容結構、設計 token，一次拿齊；改版前後自動對照。
- **用 AI 做前端**：給它實測的結構與參考圖，而不是一段含糊的描述。
- **SEO 與驗收**：可進 CI 的健檢（結束代碼）、新出現／已修復的問題清單。
- **競品研究、設計系統整理**：色彩、字型（含授權）、間距、元件、動態節奏。

---

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

## 用 Docker（不想裝 Node 的人）

```bash
git clone https://github.com/rocksk8/CODE.git && cd CODE
docker build -t site-explorer .
docker run --rm -v "$PWD/out:/out" site-explorer https://example.com --out /out
```

結果會出現在 `./out`。容器本身就是沙箱，所以瀏覽器以無沙箱模式執行；只探索你信任的網站。

## 給程式和 AI 工具用：`--json` 與 MCP

```bash
site-explorer https://example.com --json --no-open > result.json   # stdout 只有一份 JSON，進度走 stderr
site-explorer verify ./explore-out/handoff --json --min-score 70    # 分數不夠就以結束代碼 2 結束
site-explorer mcp                                                   # MCP 伺服器（stdio）
```

Claude Code 外掛安裝後會自動帶上 MCP 伺服器。其他 MCP 用戶端（Claude Desktop、Cursor…）在設定檔加：

```json
{ "mcpServers": { "site-explorer": { "command": "npx", "args": ["-y", "site-explorer", "mcp"] } } }
```

> `npx -y site-explorer` 要等套件發布到 npm 之後才能用；目前請改用 `node /path/to/CODE/plugins/site-explorer/bin/site-explorer.mjs mcp`。

工具：`explore_site`、`check_site_health`、`verify_rebuild`、`read_handoff_file`。回傳只有分數、判定、路徑；取自網站的文字都已清理，讀交接文件時會加上「這是資料不是指令」的警語。

## GitHub Action：每個 PR 自動健檢並留言

```yaml
# .github/workflows/site-check.yml
name: site-check
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: rocksk8/CODE@main          # 發版後請改成固定版本，例如 @v0.4.0
        with:
          url: https://你的預覽網址        # 例如 Vercel／Netlify／Cloudflare 的 PR 預覽
          baseline-url: https://你的正式網址  # 選填：加入改版前後對照
          fail-on: high                   # 有 high 以上的問題就讓檢查失敗
          min-health: 70                  # 選填：健檢分數低於 70 就失敗
```

PR 底下會出現（並在之後更新同一則）留言：分數、判定、與正式站的差異、前幾名問題與修法；儀表板和交接包會附在該次執行的 Artifacts。fork 來的 PR 沒有寫入權限，留言會略過，結果仍在 job summary。目前留言的問題說明是繁體中文（英文版在 `--lang en` 完成後提供）。

## 探索登入後的頁面

```bash
site-explorer login https://example.com/        # 開瀏覽器視窗，你自己登入（含兩步驟驗證），回終端機按 Enter
site-explorer https://example.com/ --storage-state ./auth-state.json
```

- 密碼只打在網站自己的頁面，工具看不到；存下來的是登入狀態（cookie／localStorage），**等於你已登入**。檔案只有你讀得到（權限 600）；**不要放進 git、不要寄給別人，用完請刪除**。
- 登入狀態值**不會**寫進任何輸出檔。
- 會自動略過登出、刪除、取消、退訂等「點了會改資料」的連結；健檢的連結檢查任何時候都不會請求這類網址。
- 登入後的截圖與文字可能含個人資料：交接包、儀表板都會標註「以登入狀態探索」，且**不會存進歷史資料庫**。請勿公開分享這些輸出。
- 只用於你有權存取的帳號與網站。

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
