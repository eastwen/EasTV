@echo off
setlocal
cd /d "%~dp0"
call "%~dp0eastv-agent.bat" install codex
if errorlevel 1 (
  echo.
  echo [EasTV] Installation did not finish. See AGENT-INTEGRATION.md.
  pause
  exit /b 1
)
echo.
echo [EasTV] Agent Bridge is ready. Restart Codex before using it.
pause
endlocal
