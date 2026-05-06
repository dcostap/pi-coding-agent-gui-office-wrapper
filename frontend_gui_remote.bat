@echo off
setlocal
cd /d "%~dp0apps\new_gui"
call bun run dev
