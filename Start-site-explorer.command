#!/usr/bin/env bash
# Double-click (macOS) or run (Linux) to open the site-explorer graphical interface.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo " Node.js is not installed. Please install Node.js 22 LTS from https://nodejs.org and open this file again."
  echo " Node.js 尚未安裝。請先到 https://nodejs.org 安裝 22 LTS 版，再打開這個檔案。"
  echo
  read -r -p "Press Enter to close / 按 Enter 結束" _
  exit 1
fi
if [ ! -d node_modules/playwright-core ]; then
  echo " First start: installing what site-explorer needs (one time, about a minute)..."
  echo " 第一次啟動：安裝需要的元件（只要一次，約一分鐘）..."
  npm ci --omit=dev --no-audit --no-fund || { echo " Install failed. Check your internet connection."; read -r -p "Press Enter / 按 Enter" _; exit 1; }
fi
echo " Opening the page in your browser... Use the \"Quit\" button at the top right of the page to close this window."
echo " 正在開啟網頁...要關閉請按網頁右上角的「結束程式」"
node plugins/site-explorer/bin/site-explorer.mjs ui; rc=$?
if [ "$rc" != "10" ]; then echo " site-explorer stopped unexpectedly (exit code $rc)."; read -r -p "Press Enter / 按 Enter" _; exit "$rc"; fi
echo " Program closed. / 程式已結束。"
