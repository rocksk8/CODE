# 真實網站測試清單

這個工具的自動測試都跑在本機測試站上，雲端環境也連不到外部網站，所以**真實網站的表現只能由你來驗證**。請依下表在你自己的電腦上做，把結果（通過／不通過，加上錯誤訊息或截圖）回報，我再依結果調整。

準備：照 README 安裝並執行 `site-explorer setup`。Windows 建議加 `--no-motion`；macOS 可以不加。

## A. 基本流程（每個網站都做）

| # | 網站類型 | 指令 | 要確認的事 |
|---|---|---|---|
| A1 | 你自己的公司官網 | `site-explorer explore https://網址 --max-pages 12` | 主控台有「最該先處理的 3 件事」；`dashboard.html` 能開、左側導覽每一頁都能點 |
| A2 | 有很多動畫或 3D 的網站 | `site-explorer explore https://網址 --max-pages 10` | 「3D／動畫」頁列出多個頁面（不是只有首頁）；Windows 上若太慢請改 `--motion-pages 3` 並回報耗時 |
| A3 | 一個沒有動畫的簡單網站 | `site-explorer explore https://網址 --no-motion` | 結果合理，沒有誤報 |
| A4 | 有 Cookie 同意橫幅的網站 | 同 A1 | 內容有被讀到，沒有只剩橫幅 |
| A5 | 用 JavaScript 才顯示內容的網站（單頁應用） | 同 A1 | 健檢有「內容要靠 JavaScript 才看得到」的提示，文字內容有被擷取 |

## B. 進階功能（有需要再做）

| # | 功能 | 指令 | 要確認的事 |
|---|---|---|---|
| B1 | 對照設計規範 | `... --tokens 你的規範.json --max-off-token 10` | `token-check.md` 的不符合項目是否正確；超過門檻時結束代碼是 4 |
| B2 | 品牌手冊 | `... --brand-guide` | `design-bundle` 內有 `brand-guide.pdf`，顏色與字型對得上網站 |
| B3 | 深色模式 | 挑一個有深色模式的網站 | `design-bundle/tokens.json` 的 `darkMode.colors` 是深色模式實際用的顏色 |
| B4 | 登入後頁面 | 先 `site-explorer login 網址`，再 `... --storage-state 檔案` | 能看到登入後的頁面，沒有點到登出或刪除；輸出不含你的帳號資料以外的敏感內容 |
| B5 | cookie／標頭／基本認證 | `... --cookie-file 檔案` 等 | 能進入受保護的頁面 |
| B6 | 前後對照 | 先 `--approve`，改版後 `--compare` | `drift.md` 與 `visual-review.html` 反映真的有改的地方 |
| B7 | HAR／WARC | `... --har --warc` | `network.har` 能用瀏覽器開發者工具（Network 面板 → 匯入）開啟；密鑰已被遮蔽 |
| B8 | Figma 外掛 | 照 `figma/plugin/README` 匯入 | 在真的 Figma 裡能產生畫面（這項我完全沒驗證過） |

## C. 回報格式

```
網站類型：
作業系統：Windows / macOS（版本）
指令：
結果：通過 / 不通過
耗時：
錯誤訊息或截圖：
```

## D. 不要測的
- 不要對你沒有權限分析的網站大量爬取；工具遵守 robots.txt 且只讀取，但請自行確認授權。
- 不要把登入狀態的輸出（截圖、文字）公開分享。
