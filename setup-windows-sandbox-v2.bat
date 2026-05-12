@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows-sandbox-v2.ps1"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Setup failed or is still not ready. See messages above.
) else (
  echo.
  echo Done. Restart/retry the dev app.
)
pause
exit /b %EXIT_CODE%
