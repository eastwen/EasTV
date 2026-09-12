@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [EasTV] Node.js 20 or newer is required.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0scripts\eastv-agent.mjs" %*
endlocal
