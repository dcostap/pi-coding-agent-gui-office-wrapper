@echo off
setlocal
cd /d "%~dp0apps\gui"
call bun run dev
