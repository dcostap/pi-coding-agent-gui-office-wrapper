@echo off
setlocal
cd /d "%~dp0"
call npm run gateway:bootstrap-auth
call npm run dev:gateway
