@echo off
rem DEEP DRIFT - double-click to run locally (server + client), then opens the browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run dev -- --open
pause
