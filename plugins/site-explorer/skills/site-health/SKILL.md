---
name: site-health
description: 網站健檢：SEO、爬蟲索引（robots、sitemap、canonical、noindex、soft 404、重新導向）、頁面 SEO、連結、效能、行動版、安全、結構化資料，以及 AI 爬蟲友善度。當使用者要檢查網站 SEO、為什麼沒被收錄、做網站健檢或優先順序修復清單時使用。 Use for SEO audits, "why is my site not indexed", robots.txt / sitemap / canonical / noindex checks, broken links, Core Web Vitals-style lab checks, AI-crawler (GPTBot/ClaudeBot) access.
---

# 網站健檢（SEO／爬蟲索引）

## 執行
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" explore <url> --max-pages 12 --no-motion --out ./explore-out     # 爬取 + 健檢 + 儀表板 + 交接包
# 只重跑健檢（已有爬取結果）：
node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" health --site ./explore-out/site/<host> [--no-link-check] [--max-links 120]
```
輸出：`<site>/health.md`（AI 可讀）、`health.json`、儀表板「健檢」分頁。

## 檢查範圍
- **索引與爬取（25%）**：robots.txt（完整解析：UA 分組、Allow、萬用字元）、sitemap（存在、是否含壞網址／noindex／跨網域、與已抓頁面對照）、noindex／nofollow、canonical、重新導向（鏈、302、跨網域）、soft 404、http／https／www 是否統一、**內容是否依賴 JavaScript**（原始 HTML vs 渲染後）
- **頁面 SEO（20%）**：title／description 缺漏、長度、重複；h1；標題層級；內容量；lang；圖片 alt；網址整潔度
- **連結（10%）**：壞連結（內部全檢＋抽樣、外部抽樣）、孤兒頁、泛用／空白錨文字
- **效能（15%，實驗室數據）**：TTFB、LCP、CLS、頁面大小、請求數、阻塞腳本、第三方、圖片尺寸／格式、壓縮
- **行動版（10%）**、**安全與傳輸（10%）**（HTTPS、憑證到期、HSTS、混合內容、標頭）、**結構化資料與社群（5%）**、**AI 爬蟲友善度（5%）**（AI 爬蟲存取政策、llms.txt、JS 依賴）

## 怎麼判讀與回報
1. 先讀 `health.md` 的「最該先處理的事」，再讀完整問題清單（每項含：為什麼重要、怎麼修、範例網址）。
2. 評分：各面向 0–100，加權為總分；有「嚴重」問題時總分上限 55。分數是**相對指標**，不是 Google 的評分。
3. 回報時給：總分與等級、前 3–5 個最該修的問題（附修法與影響頁數）、「已通過」的好消息，以及限制。
4. 要修時可依問題 `id` 逐一處理，修完重跑健檢比較；`/site-explorer:history history <host>` 會顯示分數變化。

## 限制（務必說明）
- 只分析**本次爬取的頁面（抽樣）**，不是全站；真實涵蓋與 Core Web Vitals 要看 Search Console／CrUX。
- 效能是無頭瀏覽器、無節流的實驗室數據；僅供相對比較。
- 額外請求只有 robots.txt、sitemap、連結狀態（HEAD）與一次 404 探測，且限制併發；遵守 robots.txt，不登入、不送表單。
- 被防機器人頁面擋住時結果不完整，報告會標示；不要繞過。
- AI 爬蟲政策是**選擇題不是對錯題**：擋訓練爬蟲保護內容；擋搜尋／代使用者爬蟲則不會出現在 AI 搜尋與助理的回答中。
