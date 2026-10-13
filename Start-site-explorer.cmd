@echo off
rem Double-click to open the site-explorer graphical interface (Windows).
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Please install Node.js 22 LTS from https://nodejs.org and double-click this file again.
  echo  Node.js 尚未安裝。請先到 https://nodejs.org 安裝 22 LTS 版，再雙擊這個檔案。
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\playwright-core" (
  echo  First start: installing what site-explorer needs (one time, about a minute)...
  echo  第一次啟動：安裝需要的元件（只要一次，約一分鐘）...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo. & echo  Install failed. Check your internet connection. & pause & exit /b 1 )
)
echo.
echo  Opening the page in your browser... (use the "Quit" button at the top right of the page to close this window)
echo  正在開啟網頁...（要關閉這個視窗，請按網頁右上角的「結束程式」）
node "plugins\site-explorer\bin\site-explorer.mjs" ui
if errorlevel 1 (
  echo.
  echo  site-explorer stopped with an error. Press any key to close / 發生錯誤，按任意鍵關閉
  pause >nul
)
exit /b 0
