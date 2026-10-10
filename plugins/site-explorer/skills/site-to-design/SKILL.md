---
name: site-to-design
description: 把 site-explore 的爬取結果轉成 Claude Design 可用的設計系統（Design System）與設計稿（Design）。當使用者想「以這個網站為基礎」做設計系統、改版、延伸頁面、競品風格參考時使用。
---

# 從網站到 Claude Design

流程：**探索 → 萃取 token → 建立 Design System artifact → 用它產出 Design**。

## 1. 探索與萃取
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && npm install --silent
node scripts/crawl.mjs <url> --max-pages 8 --out ./site-report
node scripts/export-design.mjs ./site-report/<host>
```
產生 `design-bundle/`：`README.md`（品牌簡報）、`tokens.json`、`tokens.css`、`components.json`、`assets/`（logo/favicon）、`reference/`（桌機/手機截圖）。
先讀 `README.md` 與 `reference/` 截圖，再讀 `tokens.json`；`contrastAudit` 有 ⚠️ 的項目要在設計系統中標註並提出修正色。

## 2. 建立 Design System artifact
1. 呼叫 `Artifact` 的 `action: "quickstart"`、`intent: "other"`（設計系統用 other），取得 Design System 類型的 `type_url`。
2. 用該 `type_url` 發佈，`title` 取 `<網站名> Design System`，依類型說明填入：
   - README ← `design-bundle/README.md`（品牌定位、語氣、使用原則；缺的部分根據截圖與文案補寫）
   - Tokens ← 色彩（含 dark mode）、字型與字級、間距、圓角、陰影，取自 `tokens.json`
   - Components ← `components.json`（按鈕含 hover、輸入框、卡片、導覽列），每個做可預覽範例
   - Assets ← `assets/` 的 logo、favicon（`Artifact` 上傳 asset）
3. 字型若是網站專有字體，保留名稱並指定近似的替代字體，並告知使用者。

## 3. 用它做設計
再呼叫 `quickstart`（`intent: "design"`），用 Design 類型的 `type_url` 建立設計稿，並**指定剛建立的 Design System** 當設計系統。常見任務：
- 改版：保留 token 與元件，重排版面（參考 `site.json` 的 sections 與 `reference/` 截圖）
- 延伸：以同一風格新增頁面（定價、活動頁、404、登入頁）
- 響應式：依 `breakpoints` 建立桌機/平板/手機三個 artboard
- 比較：多個網站各建一份 Design System，再並列比較

## 規範
- 這是「風格參考」：沿用 token 與模式，不要原樣複製受版權保護的文案、圖片、logo；logo 僅在使用者確認有權使用時才放入。
- 偏離原站時（例如修正低對比），在設計系統裡寫明原值與修正值。
- 發佈的 artifact 預設私有；交付時把連結給使用者，不要自行分享。
