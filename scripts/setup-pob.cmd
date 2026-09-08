@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-pob.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. See the error above.
  exit /b 1
)
endlocal
