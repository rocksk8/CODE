# site-explorer（Claude Code 套件）

讓 Claude 自動控制瀏覽器探索網站：**設計、內容、排版、3D／動畫、編輯方式**，整理成圖形化儀表板，累積在本機資料庫，並可一鍵串接 Claude Design。

## 30 秒上手（Mac／Windows／Linux）

需要 Node 18+ 與 Google Chrome（資料庫功能需要 Node 22.13+）。

```bash
cd plugins/site-explorer && npm install
node scripts/doctor.mjs https://example.com      # 先檢查環境，每個問題都附修復指令
node scripts/explore.mjs https://example.com     # 一鍵：爬取→設計包→3D→資料庫→儀表板
open explore-out/dashboard.html                  # Mac
```

在 Claude Code 裡安裝：
```
/plugin marketplace add rocksk8/code
/plugin install site-explorer@rocksk8-code
```

## 指令

| 指令 | 做什麼 |
|---|---|
| `/site-explorer:explore <url>` | 一鍵探索並產生儀表板 |
| `/site-explorer:to-design <url> [要做的設計]` | 萃取 token → 建立 Claude Design 的 Design System → 產出設計稿 |
| `/site-explorer:capture-motion <url>` | 只做 3D／動畫視覺擷取 |
| `/site-explorer:report <url>` | 分階段產生儀表板 |
| `/site-explorer:history list｜search --lib three｜history <host>｜compare a b` | 查詢、比較以前探索過的網站 |
| `/site-explorer:doctor [url]` | 環境診斷 |

## 你會得到什麼

- **圖形化儀表板** `dashboard.html`（離線單檔）：色票、字型實際渲染、按鈕 hover、桌機／平板／手機截圖切換、區塊地圖、標題大綱、3D 畫格播放器、編輯方式、歷史比較、「下一步」建議
- **設計包**：`tokens.css`、`tokens.w3c.json`（W3C Design Tokens）、`tailwind.config.js`、元件樣式、logo／favicon、對比檢查
- **3D／動畫**：WebGL／CSS 3D／model-viewer／影片的靜置、滑鼠、拖曳、捲動畫格；shader、3D 素材、函式庫
- **資料庫**（SQLite，`~/.site-explorer/explorations.db`，可用 `SITE_EXPLORER_DB` 改位置）：搜尋「誰用了 three.js」「主色偏橘的網站」，追蹤同一網站的改版

## 內容

| 元件 | 作用 |
|---|---|
| `.mcp.json` | 掛載 Playwright MCP，Claude 可即時操作瀏覽器 |
| `scripts/explore.mjs` | 單一入口，分階段、有進度，單階段失敗不中斷其他階段 |
| `scripts/doctor.mjs` | Node／瀏覽器／ffmpeg／資料庫／網路檢查 |
| `scripts/crawl.mjs` | 爬取；偵測被擋（403／驗證碼）、自動處理 Cookie 橫幅、遵守 robots.txt |
| `scripts/export-design.mjs` | 設計包 |
| `scripts/capture-3d.mjs` | 3D／動畫擷取 |
| `scripts/db.mjs` | 資料庫：ingest／list／search／history／compare／export |
| `scripts/build-report.mjs` | 儀表板 |
| `skills/`、`commands/`、`agents/` | `site-explore`、`site-to-design`、`capture-motion` 與對應指令、分析 agent |
| `test/e2e.test.mjs` | `npm test`：本機夾具網站端到端測試（含 WebGL、CSS 3D、被擋頁面、資料庫歷史） |

設計取捨與使用者旅途盤點見 [`docs/ux-review.md`](docs/ux-review.md)。

## 邊界

遵守 robots.txt；不登入、不繞過驗證碼或防機器人；後台路徑只探測是否存在。被擋住時會明確標示而不是回報空白結果。3D 模型與網站素材受版權保護，只供參考。僅用於公開或已授權的網站。
