---
name: site-to-design
description: 把網站探索結果變成「AI 能據以做設計範本、後續開發能接手」的交接包，並串接 Claude Design（Design System → 設計稿）。當使用者想以某網站為基礎做設計系統、改版、延伸頁面、競品風格參考，或要把網站規格交給開發時使用。
---

# 從網站到設計範本與交接包

核心觀念：**AI 只能讀文字和圖片**。3D、影片、動畫、超長截圖它都看不懂，所以工具會先把它們翻成文字＋數據＋單張影格序列圖，再整理成一個可獨立存在、可持續更新的交接包。

## 1. 產生交接包
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install --silent        # 僅首次（會自動安裝）
node scripts/explore.mjs <url> --max-pages 8 --out ./explore-out
```
輸出 `explore-out/handoff/`（可整包丟進專案、交給開發或 AI）：

| 檔案 | 用途 |
|---|---|
| `ai-brief.md` | **先讀這個**。精簡簡報：風格、可貼的 CSS token、元件、頁面骨架（含真實內容結構）、文案語氣、必守規則、該先看的圖 |
| `SPEC.md` | 完整規格：資訊架構、設計系統、元件、各頁各區塊內容、動態、素材、技術、健檢、實作順序、**未知與限制** |
| `spec.json` | 同上，結構化 |
| `motion.md` | 3D／影片／動畫的文字描述＋量化數據＋重現建議 |
| `health.md` | SEO／爬蟲索引健檢 |
| `DECISIONS.md` | 持續更新的決策紀錄與待確認問題 |
| `CLAUDE.md` | 給在此資料夾工作的 AI 的指引 |
| `tokens/` | css、W3C、Tokens Studio（Figma）、Tailwind、palette.svg |
| `media/sections/` | 每個區塊的裁切圖（比整頁截圖清楚，優先看） |
| `media/motion/` | 動態元素的影格序列圖（一張圖看完整個動畫） |

## 2. 讀的順序（重要）
1. 讀 `handoff/ai-brief.md`。
2. 用 Read **直接檢視**它列出的圖片（`media/sections/...png`、`media/motion/...png`）。整頁截圖很長會被縮小到看不清，不要依賴它。
3. 有 3D／影片時讀 `motion.md`：以文字與數據為準，影格序列圖交叉驗證。你無法觀看影片或操作 3D 場景。
4. 需要細節再讀 `SPEC.md`；**一定要讀第 11 節「未知與限制」**，不要把未知當成事實。

## 3. 建立 Claude Design 的 Design System
1. `Artifact` 的 `action: "quickstart"`、`intent: "other"`，取得 Design System 類型的 `type_url`，用它發佈，`title` 取 `<網站名> Design System`。
2. 依類型說明填入：README ← `ai-brief.md` 的風格與規則；Tokens ← `tokens/tokens.json`（色彩含深色模式、字級、間距、圓角、陰影）；Components ← SPEC 第 4 節（按鈕含 hover、卡片、輸入框、導覽），每個做可預覽範例；Assets ← `media/assets/`（logo 僅在使用者確認有權使用時放入）。
3. 非免費字型保留名稱並指定 SPEC 第 3.2 節的替代字體，並告知使用者。

## 4. 用它做設計
再 `quickstart`（`intent: "design"`），用 Design 類型建立設計稿並指定剛建好的 Design System。常見任務：改版、延伸頁面（定價／活動／404）、響應式三個 artboard（1440／768／390）、依「頁面骨架」產出線框、多站比較（`/site-explorer:compare`）。

## 5. 記錄（讓後面的人知道所有該知道的事）
**每做一個設計或實作決策，就在 `handoff/DECISIONS.md` 的「已做決策」最上方新增一筆**：日期、決策、原因（含替代方案）、影響的檔案／元件／頁面、作者（人或 AI）、依據（SPEC 哪一節／哪張圖）。把你遇到的新疑問加入「待確認問題」。不要改寫舊紀錄。

## 規範
- 風格參考，不是複製：用佔位文案與自有／授權素材；不照搬原站文字、圖片、Logo、3D 模型。
- 偏離原站時（例如修正低對比）在 DECISIONS.md 寫明原值與修正值與原因。
- 規格與截圖衝突時以截圖為準並記錄差異。
- 發佈的 artifact 預設私有；交付時把連結給使用者，不要自行分享。
