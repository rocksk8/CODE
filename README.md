# site-explorer（Claude Code 套件）

讓 Claude 自動控制瀏覽器探索網站，取得：**網站設計、網頁內容、網站排版、編輯方式**。

## 安裝

```
/plugin marketplace add rocksk8/code
/plugin install site-explorer@rocksk8-code
```

## 使用

- `/site-explorer:explore https://example.com 10`：一鍵探索並輸出報告
- `/site-explorer:to-design https://example.com 改版首頁`：探索後萃取設計 token，建立 **Claude Design** 的 Design System 並產出設計稿
- `/site-explorer:capture-motion https://example.com`：視覺化擷取 **3D／動畫**（WebGL、three.js、CSS 3D、Lottie、捲動動畫），輸出畫格序列、互動畫格、錄影與技術分析
- 或直接說「幫我分析 https://example.com 的設計與版面」，Claude 會自動啟用 `site-explore` skill

## 內容

| 元件 | 作用 |
|---|---|
| `.mcp.json` | 掛載 Playwright MCP，Claude 可即時操作瀏覽器（點擊、截圖、快照） |
| `scripts/crawl.mjs` | 批次爬取：設計權杖、內容、排版樹、元件（含 hover）、斷點、深色模式、logo/favicon 素材、三種視窗截圖、CMS/編輯方式偵測 |
| `scripts/export-design.mjs` | 把爬取結果轉成設計包：色彩角色、型階、間距基準、對比檢查、tokens.css、元件、素材 |
| `scripts/capture-3d.mjs` | 偵測並逐格擷取 3D／動畫：靜置、滑鼠、捲動畫格、shader、3D 素材、函式庫、錄影、contact sheet |
| `skills/capture-motion` | 3D／動畫擷取與判讀流程 |
| `skills/site-explore` | 探索流程與回報規範 |
| `skills/site-to-design` | 串接 Claude Design：Design System → Design 稿 |
| `commands/explore.md`、`commands/to-design.md` | `/site-explorer:explore`、`/site-explorer:to-design` |
| `agents/site-explorer.md` | 專職分析 subagent |

單獨執行腳本：`cd plugins/site-explorer && npm install && node scripts/crawl.mjs <url> --max-pages 10 --out ./site-report`
（需要 Chromium；可用 `CHROMIUM_PATH` 指定）。

## 注意

遵守 robots.txt，不登入、不繞過驗證，只探測後台路徑是否存在。僅用於公開或已授權的網站。
