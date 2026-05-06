@echo off
setlocal
set "OFFICE_AGENT_GATEWAY_URL=http://localhost:8082/v1"
set "OFFICE_AGENT_GATEWAY_TOKEN=officeagent-demo-2026"
cd /d "%~dp0apps\gui"
call bun run dev
