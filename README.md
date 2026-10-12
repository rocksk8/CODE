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

**不會用指令？** 在 GitHub 頁面按 Code → Download ZIP，解壓縮後雙擊 `Start-site-explorer.cmd`（Windows）或 `Start-site-explorer.command`（Mac）。第一次會自動安裝需要的元件（要先裝好 [Node.js](https://nodejs.org) 22），接著會開啟圖形介面，輸入網址就能用；沒有瀏覽器時介面上有「下載瀏覽器」按鈕。

```bash
npm i -g git+https://github.com/rocksk8/CODE.git
site-explorer setup
site-explorer ui                          # 不想打指令：開啟圖形介面（瀏覽器裡輸入網址、看進度、複製「最該先處理的 3 件事」）
site-explorer check https://example.com   # 最快：幾分鐘內知道最該先修什麼
site-explorer https://example.com         # 完整：設計、3D／動畫、健檢、交接包
```

**網站變差時通知你**：`site-explorer check https://你的網站 --webhook <Slack／Teams／Discord 的 webhook 網址>`，跑完若分數比上次掉 5 分以上、或高／緊急問題變多，就把摘要（分數、變化、前 3 件事）送出去（`--notify-on always` 每次都送、`issues` 有高／緊急問題就送）。要每天自動跑：`site-explorer schedule https://你的網站 --every day --at 08:30` 會印出 Windows 工作排程器、cron、GitHub Actions 三種做法的指令（它不會自己改你的電腦）。

**跑太久、吃太多資源時**：每個階段有時間上限（爬取 30 分鐘、3D 25 分鐘、其他 10～20 分鐘；整個探索 120 分鐘），超過會印出「⏱ 超時通知」並停止該階段、繼續其他階段；可用記憶體剩不到 128 MB（或 2%）並持續 30 秒時印出「🧠 記憶體不足通知」並停止該階段，避免整台電腦卡死（macOS 只提醒、不停止，因為它的「可用記憶體」讀數不可靠）；CPU 長時間滿載會印出「🔥」提醒；超過 90 秒沒有新訊息會印出「⏳ 仍在執行」。可用環境變數 `SITE_EXPLORER_STAGE_MINUTES`、`SITE_EXPLORER_MAX_MINUTES` 調整。**Windows 的終端機若中文變亂碼**，先執行 `chcp 65001`，或加 `--lang en`。

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
site-explorer verify ./explore-out/handoff --json --min-score 70    # 分數不夠就以結束代碼 2 結束（不加 --min-score 就不設門檻）。分數衡量「版面」：區塊高度、明暗結構、顏色；不比對文字與照片
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
          max-drop: 5                     # 選填（需要 baseline-url）：比正式站低超過 5 分就失敗
          fail-on-new: high               # 選填（需要 baseline-url）：出現正式站沒有的 high 以上新問題就失敗
```

PR 底下會出現（並在之後更新同一則）留言：分數、判定、與正式站的差異、前幾名問題與修法；儀表板和交接包會附在該次執行的 Artifacts。fork 來的 PR 沒有寫入權限，留言會略過，結果仍在 job summary。留言的外框（標題、欄位名稱）一律是英文；`lang: zh` 只會把其中的問題標題與修法改成繁體中文。

## 探索登入後的頁面

```bash
site-explorer login https://example.com/        # 開瀏覽器視窗，你自己登入（含兩步驟驗證），回終端機按 Enter
site-explorer https://example.com/ --storage-state ./auth-state.json
```

- 密碼只打在網站自己的頁面，工具看不到；存下來的是登入狀態（cookie／localStorage），**等於你已登入**。檔案只有你讀得到（權限 600）；**不要放進 git、不要寄給別人，用完請刪除**。
- 登入狀態值**不會**寫進任何輸出檔。
- 爬取（登入與未登入都一樣）會略過登出、刪除、移除、退訂、停用帳號等路徑與 `?action=delete` 這類「點了會改資料」的連結；探索互動時也會拒絕所有非讀取（POST／PUT／DELETE）請求；健檢的連結檢查任何時候都不會請求這類網址。這是盡力而為的規則，不是保證——請只探索你信任的網站。
- 登入後的截圖與文字可能含個人資料：交接包、儀表板都會標註「以登入狀態探索」，且**不會存進歷史資料庫**。請勿公開分享這些輸出。
- 只用於你有權存取的帳號與網站。

## 無障礙檢查（axe-core）

```bash
site-explorer https://example.com --a11y
```

用業界標準的 axe-core 檢查 WCAG 2.2 AA：缺少替代文字、按鈕沒有名稱、對比不足、表單沒有標籤、沒有語言標示…。結果會成為健檢的一個類別「無障礙」（併入總分，只有加 `--a11y` 才會量測，不加則分數與以前完全一樣），也寫在 `site/<網站>/a11y.json`，每項違規附修法連結與出現位置。自動檢查只能發現一部分問題，不能取代人工檢查。GitHub Action 對應的選項是 `a11y: true`。

## 轉成 React／Vue／Astro 專案或 shadcn/ui 主題

```bash
site-explorer https://example.com --framework react       # react | vue | astro | shadcn | all
site-explorer framework ./explore-out/handoff --to all    # 對已有的交接包事後轉換
cd explore-out/handoff/frameworks/react && npm install && npm run dev
```

每個頁面的每個區塊會變成一個元件（`src/components/<頁面>/<區塊>`），文字與圖片仍是佔位內容，間距與顏色是量到的數值；設計 token 一併帶入專案。React／Vue 專案用 Vite，Astro 用 Astro 4；版本都固定在實測過的版本。`shadcn` 會產生 `globals-theme.css`（shadcn/ui 讀的 HSL 變數，品牌色成為 primary）與 Tailwind 設定片段，深色配色是推算的，請目視確認。

我們實際安裝並建置過三種專案，再用瀏覽器逐區塊比對，畫面與純 HTML 的 starter **完全一致**（CI 的 Node 22 會重跑這項檢查）。再次產生時，你改過的專案會被搬到 `<名稱>.backup-<時間>`，不會被覆蓋。

## 英文輸出：`--lang en`

```bash
site-explorer https://example.com --lang en     # 或設環境變數 SITE_EXPLORER_LANG=en
```

主控台訊息、健檢報告、探索報告、交接包文件、前後對照、儀表板介面、PR 留言全部輸出英文（預設仍是繁體中文）。測試會用英文跑完整流程，確認沒有殘留中文、也沒有漏翻的字串；網站本身的文字（標題、文案）當然維持原樣。GitHub Action 的 `lang` 選項預設為 `en`。

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
| `content/` | 每一頁的可讀文字，依網頁順序輸出成 Markdown（`content/INDEX.md` 是索引）。連結寫成「文字 (網址)」、圖片寫成 `[image: 說明]`，檔案不會出現可點擊或追蹤用的元素 |
| `tokens/`、`media/` | css／W3C／Tokens Studio／Tailwind（v3 設定檔與 v4 `@theme`，色彩為 OKLCH）／`DESIGN.md`（給 AI 工具先讀的設計規則）／色票 SVG；區塊裁切圖、影格序列圖、品牌素材 |

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

索引與爬取 25%・頁面 SEO 20%・連結 10%・效能 15%・行動版 10%・安全與傳輸 10%・結構化資料與社群 5%・AI 爬蟲友善度 5%（加 `--a11y` 時多一類「無障礙」權重 10，其他類別等比例縮小）。評分有遞減效果，且出現「嚴重」問題（全站被擋、全站 noindex、無 HTTPS、憑證過期）時總分上限 55。**分數是相對指標，不是 Google 的評分**；只分析本次爬取的頁面（抽樣）；效能為實驗室數據。

健檢報告最上面有**驗收結論**（通過／有條件通過／不通過）。給自動化用：`site-explorer explore <網址> --fail-on high`，有「高」以上問題時以結束代碼 4 結束。再跑一次同一個網站，報告會列出「新出現／已修復」的問題。

**本機偏移基準**：`site-explorer explore <網址> --approve` 把這次的設計 token（色彩、字型、間距…）和健檢結果存成基準（預設 `<輸出資料夾>/baseline.json`，可用 `--baseline <檔案>` 指定，方便放進版本控制）；之後 `site-explorer explore <網址> --compare` 會和基準比較，設計 token 有任何變動、健檢分數掉超過 `--max-drop`（預設 5 分），或出現 `--fail-on-new`（預設 high）以上的新問題，就以結束代碼 4 結束，並寫出 `drift.md`。設計 token 是逐項精確比對；想接受新的樣子，確認後再跑一次 `--approve`。

**技術堆疊**：每次探索會寫出 `techstack.md/json`——依據腳本網址、回應標頭、Cookie、generator 標籤與全域變數辨識約 120 種技術（可用 `--tech-rules` 加上自己的規則）（CMS、框架、函式庫、主機／CDN、分析），附證據與信心；不靠外觀猜測。

**效能預算與歷次紀錄**：`--budget <檔案.json>`（例：`{"lcpMs": 2500, "totalKB": {"max": 1500, "level": "warn"}}`）。指標有 ttfbMs、fcpMs、lcpMs、loadMs、cls、totalKB、requests、thirdPartyRequests、renderBlockingScripts、domNodes。超標的 `fail` 項目以結束代碼 4 結束；每次結果存進 `<輸出資料夾>/perf-history.json`（最近 60 筆），報告為各站資料夾的 `performance.md/json`。

**追蹤行為檢查**：`tracking-behaviors.md/json`——不只列追蹤碼，而是看頁面做了什麼：有沒有錄製訪客操作的服務（Hotjar、Clarity、FullStory…）、有沒有讀 canvas／WebGL／音訊指紋或大量量測字型、輸入的文字是否被送到別的網站（只在一般文字框輸入隨機字串並清掉，不送出；有密碼欄的表單、疑似付款欄位與登入狀態一律不測）。命中是「值得查」的線索，不是濫用的證據。

**整頁視覺回歸**：`--approve` 同時把桌機／平板／手機的整頁截圖存到基準檔旁的 `<基準檔名>-visual/`；`--compare` 逐張逐像素比對（任一色版差超過 16/255 算不同），每張容許 `--visual-threshold`（預設 0.5%）的像素不同，超過就以結束代碼 4 結束，寫出 `visual.md` 與 `visual-diff/*.png`（變動處標紅）。`--no-visual` 可略過。這比的是整頁畫面，動態內容（輪播、廣告、時間）會造成差異，請以門檻調整。

**頁面封存**：`--archive` 為每頁另存 `pages/<頁面>/archive.html`——一個離線也打得開的單一 HTML（CSS 與圖片內嵌到大小上限，腳本、iframe、事件屬性全部移除並加上 Content-Security-Policy），像 SingleFile 的簡化版。預設不開，因為檔案較大；超過大小上限的資源會保留為網址（離線時載不出來）。

**安全標頭與 TLS 評等**：每次探索寫出 `security.md/json`——類似 Mozilla Observatory／SSL Labs 的設定檢查：CSP 強度、HSTS、nosniff、防嵌入、Referrer-Policy、登入類 Cookie 旗標、外部腳本的 integrity，以及伺服器接受哪些 TLS 版本、憑證效期／網域／信任／金鑰長度，各項附分數影響與修正方式，給 A+～F 評等。這是公開資訊的設定檢查，不是漏洞掃描；評等用來比較不同次的結果，不是認證。

**CI 輸出（SARIF／JUnit）**：`--sarif <檔案>`、`--junit <檔案>` 把健檢問題、效能預算超標、安全評等扣分、TLS 問題與（有做比對時的）視覺差異輸出成 SARIF 2.1.0（GitHub code scanning 等）與 JUnit XML（Jenkins、GitLab、CircleCI、Azure DevOps）。GitHub Action 每次都會產生 `results.sarif`／`results.xml`，路徑在輸出 `sarif-file`／`junit-file`，可用 `github/codeql-action/upload-sarif` 上傳。

**Figma 匯入檔**：每次探索在 `figma/` 寫出每頁一個圖層化 SVG（真實位置、大小、填色、圓角與文字），拖進 Figma 即可編輯；設計變數用 Tokens Studio 匯入 `design-bundle/tokens.studio.json`。這是依實測元素（最多 240 個）生成的版面草稿，不是逐像素複製：文字每段最多取前 200 字、圖片為灰色佔位。

**HTML 有效性**：健檢會檢查伺服器送出的原始 HTML——標籤沒關或順序錯、多餘結束標籤、id／屬性重複、連結或按鈕巢狀、`<p>` 內放區塊元素、清單／表格父元素錯誤、已廢棄元素、缺 doctype、charset 太晚。這是保守的檢查（只報確定有問題的），不是完整的 W3C 驗證器。

**自訂擷取規則**：`--extract rules.json`，例：`{"price": {"css": ".price"}, "sku": {"css": "[itemprop=sku]", "attr": "content"}, "order": {"regex": "order-(\\d+)"}}`。css 規則在渲染後的頁面執行（最多 50 筆），regex 規則對可見文字（或加 `"in": "html"` 對 HTML）執行；結果輸出 `extractions.csv/json`，每頁一列。規則檔會先嚴格檢查（規則名稱、數量、可能造成當機的 regex 會被拒絕）。

**儀表板怎麼看**：打開 `dashboard.html`，總覽最上面是「結果一覽」——每項檢查一張卡片，用顏色告訴你要不要處理（綠＝沒事、黃＝值得看、紅＝要處理、藍＝資訊），一句白話結論加一句下一步，點卡片進到詳細分頁。分頁分四區：看網站（設計、排版、內容、3D、編輯方式）、檢查（健檢、安全、速度、隱私、技術）、比較（畫面比對、歷史、自訂擷取）、交付（匯出給 AI、詳細資料、關於）。終端機結束時也會印同樣的結果一覽，輸出資料夾裡的 `ABOUT-THIS-FOLDER.md` 說明每個檔案是做什麼的。`site-explorer explore --help` 依用途分組，最上面有三個最常用的指令。

**更深的檢查**：`--tech-rules 規則.json` 加入你自己的技術辨識規則（內建約 120 條，含付款、客服、驗證碼、台灣電商平台）；`--perf-runs 3` 重複量測取中位數、`--throttle mobile` 模擬行動網路與 4 倍慢的 CPU（只支援 Chromium），速度頁新增總阻塞時間（TBT）；安全評等新增前向保密、DH 長度與認證式加密檢查（RC4／3DES 這類過時套件在這個環境無法主動試探，報告會明說「未測試」）；HTML 檢查新增 label for／aria-*／#錨點指向不存在 id；隱私檢查新增第三方腳本監聽整頁鍵盤事件。評分規則見 `docs/SCORING.md`。

**畫面情境與審核**：`--scenarios 情境.json` 定義「先點、懸停、捲動、打字…再截圖」的畫面（例如選單展開、下拉選單），`--hide '.clock'` 隱藏一直在變的區塊；它們和整頁截圖一起存進基準、一起比對。比對有差異時產生 `visual-review.html`——逐張拖曳滑桿比較改版前後，並附上「核准這張」的指令；`--approve-visual home:mobile,scenario:menu-open`（或 `all`）只把指定的截圖更新為新基準。情境只在網站自己的來源上執行、所有非 GET 請求都會被擋下、不能按 Enter。

**3D／動畫會擷取每一個爬到的頁面**：預設爬 12 頁，並把每一頁的動畫與 3D 都擷取（兩頁同時進行、單頁最多 4 分鐘、有進度顯示）；用 `--motion-pages 3` 可以限制數量，`--no-motion` 完全跳過。

**品牌手冊與深色模式**：`--brand-guide` 另外產生可列印的品牌手冊（`design-bundle/brand-guide.html` 與 `.pdf`：顏色含對比、字型階層、間距、圓角陰影）；網站有深色模式時，`tokens.json` 的 `darkMode.colors` 與 `palette` 是深色模式下實際用到的顏色，`tokens.css` 也會帶上。

**對照你的設計規範**：`--tokens 你的規範.json`（W3C Design Tokens 格式）會檢查網站實際用到的顏色、圓角、字級有沒有符合，輸出 `token-check.md`（列出每個不符合的值與最接近的 token）。顏色用人眼感知的 CIEDE2000 色差比對（差 ≤ 2 視為同一個色，不只是十六進位相同），長度允許 0.5 px。加 `--max-off-token 10` 可在不符合比例超過 10% 時以結束代碼 4 結束，方便放進 CI。另外，擷取設計時，肉眼看不出差異的近似色（CIEDE2000 ≤ 2）會合併成一個色，被合併的色票會列在 `tokens.json` 的 `palette[].merged`。

**儀表板外觀**：頂部深色列放公司 LOGO 與健檢分數；左側是分組導覽（開始／看網站／檢查／比較／交付），每個分頁都有圖示、標題與一句話說明；配色取自 LOGO（黃、橘、青綠、藍），支援淺色與深色模式，手機上導覽會變成橫向捲動，列印時只輸出內容。要換成別的 LOGO，取代 `plugins/site-explorer/scripts/report/brand/` 裡的 `logo-on-dark.png`（白色字樣、透明背景）與 `mark.png`（只有圓環）即可。

**最該先處理的 3 件事**：每次探索結束時，主控台、儀表板總覽最上方，和 `site/<網站>/top-fixes.md` 都會列出依「影響大小 × 影響頁數 ÷ 修起來的難度」排出的前 3 項問題（影響大又容易修的排在前面，每項標示很快／需要一點時間／較費工；`top-fixes.md` 列前 10 項）（來自健檢、安全設定、無障礙），每項附一段可以直接貼給 AI 或工程師的修正指令。完整清單仍在 `health.md`。

**HAR 網路紀錄**：`--har` 每頁另存 `network.har`（HAR 1.2：每個請求的網址、狀態、大小與時間，可用瀏覽器開發者工具的 Network 面板或任何 HAR 檢視器開啟）。不含回應內容與 Cookie；Authorization、Cookie、API 金鑰、`--header` 給的標頭，以及網址裡名稱看起來像密鑰的參數值（token、key、session、sig、code 等；也包含 Referer 與 Location 標頭裡的網址）都會換成 `[redacted]`；登入狀態的探索不錄。

**WARC 與 Figma**：`--warc` 每頁另存 `archive.warc.gz`（WARC 1.1，不含 Cookie 與驗證標頭，登入狀態不錄；已用獨立的 warcio 讀取驗證，尚未用 ReplayWeb.page 實際重播過）。Figma 資料夾除了 SVG，還有 `*.figma.json` 與 `plugin/`（一個小型 Figma 外掛）：在 Figma 桌面版匯入 `plugin/manifest.json`，選 `*.figma.json`，每頁會變成帶 auto layout 的巢狀 Frame、完整文字與圖片。這個外掛只在模擬的 Figma 介面上測過，還沒有在真正的 Figma 裡驗證。

**登入的其他方式**：`--cookie-file`（Playwright 登入狀態檔、cookie 陣列 JSON、cookies.txt，或「a=1; b=2」一行）、`--header-file 檔.json`（例如 Authorization；只會送給起始網站，不會送給第三方）、`--basic-auth-file`（第一行寫 `使用者:密碼`，或設環境變數 `SITE_EXPLORER_BASIC_AUTH`）。機密不要直接寫在指令列（會留在 shell 歷史）；這些值不會寫進任何輸出檔案，cookie 只存在一個權限 600 的暫存檔，結束就刪除。使用 `--header` 時，每個請求會先由工具取回再交給頁面（為了讓轉址後的請求不帶密鑰），所以即時串流（EventSource）與媒體不經過這一層，大型下載會先整個載入記憶體；其他網站的請求不帶你的 cookie。

**Firefox／WebKit（實驗性）**：先執行 `site-explorer setup --browser firefox`（或 `webkit`），再用 `--browser firefox` 探索。核心功能（頁面、設計 token、健檢、截圖、儀表板）由 CI 的 `engines` 工作流程在 Firefox 與 WebKit 上實際跑測試；3D／動畫擷取與行動網路模擬仍只支援 Chromium。Windows 與 macOS 由 CI 的 `platforms` 工作流程實際執行同一套測試。

**驗證遮罩**：`verify` 可用 `--ignore <選擇器>`（可重複）排除動態區域（廣告、時間、輪播），元素加上 `data-verify-ignore` 也會被排除；`--min-section <0-100>` 讓任何單一區塊低於門檻就判定未通過。

**逐頁 Markdown**：每頁的可讀文字依網頁順序輸出成 `content/<頁面>.md`（含 `INDEX.md`）；連結寫成「文字 (網址)」，不會出現可點擊或追蹤用的元素。

### 追蹤碼、Cookie、結構化資料、手機／平板、改版前後

- **追蹤碼與 Cookie**：辨識 Google Analytics／GTM、Meta Pixel、Hotjar 等 近 40 種服務（目前 39 種），列出 Cookie（名稱、誰設的、有效期、Secure／HttpOnly）與是否有 Cookie 橫幅。看的是「新訪客還沒點任何同意按鈕」時的狀態；**只記名稱與旗標，不記 Cookie 的值**。有追蹤碼卻沒橫幅會列為健檢問題（是否違規由負責人判斷）。
- **結構化資料**：不只看「有沒有」，還檢查各類型（Product、Article、FAQ、LocalBusiness…）的必填欄位、`@context`，以及標記是否只在執行 JavaScript 後才出現。
- **手機／平板實測**：在 1440／768／390 三種寬度各量一次——導覽是連結還是選單按鈕、並排欄數、字級、橫向溢出、手機版少掉多少內容；寫進報告、儀表板與交接包，不再用預設斷點猜。
- **改版前後對照**：同一網站再跑一次會自動產生 `changes.md`；舊站與新站在不同網域（例如測試站）時用 `site-explorer history compare <舊 run> <新 run> --md 對照.md`，以「路徑」對應頁面，列出消失的網址（需要 301）、變成 noindex、description 被拿掉、文字大減、結構化資料不見等風險。交接包另有 `inventory.csv`（所有頁面清單，Excel 可開）。

### 交給 AI 直接開工（匯出）

交接包（`handoff/`）現在從 **`START-HERE.md`** 開始（注意：`START-HERE.md`、`PROMPT.md`、`AI-PACKAGE.md` 與 starter 程式碼是英文，因為它們是要貼給 AI 用的；`ai-brief.md`、`DECISIONS.md`、`README.md` 等說明文件是繁體中文）：
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
