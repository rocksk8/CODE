---
name: capture-motion
description: 視覺化擷取網站的 3D 與動畫（WebGL/three.js/Spline/model-viewer/CSS 3D/Lottie/影片/捲動動畫）：連續畫格、捲動序列、滑鼠互動畫格、錄影，並分析技術與素材。當網站含 3D 或動態效果、要理解或重現其動畫時使用。 Use when a site has WebGL / three.js / video / scroll animations that need to be captured and described for an AI that cannot watch video.
---

# 3D／動畫視覺擷取

單張截圖看不到 3D 與動畫，必須取「時間序列」。

## 一鍵擷取
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/site-explorer.mjs" motion <url> --out ./motion-report [--frames 12] [--interval 250] [--max-targets 6] [--wait 2500]
```
輸出 `<out>/<host>/`：
- `motion.json`：偵測到的目標（webgl／css-3d／model-viewer／video…）、是否自己動、是否回應滑鼠、使用的函式庫（three、gsap、Spline…）、載入的 3D 素材網址（.glb/.hdr/.ktx2…）、shader 原始碼片段、CSS keyframes、捲動前後畫面是否變化
- `frames/<目標>/idle-*.png`：靜置時隨時間的畫格（看自走動畫）
- `frames/<目標>/hover-*.png`、`drag-*.png`：滑鼠掃過與拖曳（看視角旋轉／視差）
- `frames/scroll/s-*.png`：整頁捲動序列（看捲動驅動的 3D）
- `contact-sheet.html`：所有畫格總覽
- `recording.webm`：整段錄影（需 ffmpeg：`npx playwright install ffmpeg`；缺少時自動略過）

## 判讀
用 `Read` 逐張看 PNG（可直接檢視圖片）並對照 `motion.json`：
1. **動作類型**：自走旋轉／漂浮、滑鼠視差、拖曳旋轉（OrbitControls）、捲動綁定（ScrollTrigger／相機路徑）、進場動畫
2. **技術**：`libs` 有 three 就是 three.js；`assets3d` 有 .glb 就是載入模型；shader 片段可看出材質／後處理
3. **節奏**：用 `--interval` 與 idle 畫格推算週期；CSS 動畫看 `cssKeyframes` 的 duration／easing
4. 畫格全部相同 → 該元件靜態，或需先互動／載入（調大 `--wait`），或畫面在 iframe 內

## 補強（Playwright MCP 互動式）
腳本抓不到的用瀏覽器工具：點擊切換場景／材質、按鈕觸發的動畫、特定捲動位置、iframe 內 3D。

## 限制與規範
- 無 GPU 時以 SwiftShader 軟體渲染，畫面正確但幀率低；複雜場景可能較慢或略有差異。
- 抓到的是外觀與行為，不是原始碼；3D 模型與素材受版權保護，只供參考，不要下載後轉用。
- 遵守網站條款與 robots.txt，不對同一站高頻重複擷取。

## 串接 Claude Design
把 `contact-sheet.html` 與關鍵畫格放進 Design System 的動態規範（動作類型、時長、easing、觸發條件），再用 `site-to-design` 建立含動態說明的設計稿。
