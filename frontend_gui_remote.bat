@echo off
setlocal
set "OFFICE_AGENT_WINDOWS_SANDBOX_HELPER=%~dp0native\windows-sandbox-helper\target\debug\officeagent-windows-sandbox-helper.exe"
cd /d "%~dp0native\windows-sandbox-helper"
call cargo build
if errorlevel 1 exit /b %errorlevel%
cd /d "%~dp0apps\gui"
call bun run dev
