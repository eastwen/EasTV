@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [EasTV] Node.js 20 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\vite\package.json" (
  echo [EasTV] Installing dependencies for first use...
  call npm install
  if errorlevel 1 exit /b 1
)
echo [EasTV] Preparing the downloadable Agent Bridge package...
call npm run release:agent
if errorlevel 1 exit /b 1
echo [EasTV] Opening Web UI at http://127.0.0.1:4173/
start "" http://127.0.0.1:4173/
call npm run dev -- --host 127.0.0.1
endlocal
