@echo off
rem Double-click to open the site-explorer graphical interface (Windows).
rem Plain ASCII on purpose: Windows cmd can mis-parse non-ASCII text and parentheses in batch files, which makes the window vanish.
setlocal
chcp 65001 >nul
title site-explorer
cd /d "%~dp0"
echo.
echo  site-explorer - starting. Please keep this window open while you use it.
echo  To finish, click the Quit button at the top right of the web page.
echo.
echo  [1/3] Checking Node.js ...
where node >nul 2>nul
if errorlevel 1 goto nonode
for /f "delims=" %%v in ('node -v') do echo        found Node.js %%v
if exist "node_modules\playwright-core" goto ready
echo.
echo  [2/3] First start only: installing what site-explorer needs. About one minute, needs internet.
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto installfail
:ready
echo.
echo  [3/3] Starting. Your browser opens by itself. If it does not, copy the long address printed below into your browser.
echo.
node "plugins\site-explorer\bin\site-explorer.mjs" ui
set RC=%errorlevel%
echo.
if "%RC%"=="10" goto quitok
echo  site-explorer stopped unexpectedly. Exit code %RC%.
echo  Take a screenshot of this window and send it to the developer.
echo.
pause
exit /b %RC%
:quitok
echo  Program closed. This window closes in 8 seconds. Press any key to close it now.
timeout /t 8 >nul
exit /b 0
:nonode
echo.
echo  Node.js is not installed. Download it from https://nodejs.org/en/download then double-click this file again.
echo.
pause
exit /b 1
:installfail
echo.
echo  Install failed. Check your internet connection, then double-click this file again.
echo.
pause
exit /b 1
