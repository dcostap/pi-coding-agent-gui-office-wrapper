# For the User

## Repo

```powershell
cd C:\Projects\office-gui-for-agentic-ai
```

## Important PowerShell note

In PowerShell, set env vars like this:

```powershell
$env:NAME = "value"
```

Not like this:

```powershell
set NAME=value
```

---

## First-time / occasional setup

Bootstrap gateway auth:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run gateway:bootstrap-auth
```

Optional auth probe:

```powershell
npm run gateway:probe-auth
```

---

## Run the gateway

Open a terminal and run:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run dev:gateway
```

Leave that terminal open.

Current demo defaults are hardcoded to:

- gateway bind host: `0.0.0.0`
- gateway port: `8082`
- gateway token: `officeagent-demo-2026`

Current demo client target is hardcoded to:

- `http://10.0.7.234:8082/v1`

Gateway analytics dashboard:

- on the gateway PC: `http://localhost:8082/dashboard`
- on another PC in the LAN: `http://10.0.7.234:8082/dashboard`

---

## Run the TUI

Open a second terminal and run:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run tui
```

Optional version check:

```powershell
npm run tui -- --version
```

---

## Run the GUI

Open another terminal and run:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
$env:PI_APP_OPEN_DEVTOOLS = "0"
npm run gui:dev
```

Optional build check:

```powershell
npm run gui:build
```

---

## Daily startup blocks

### Terminal A — gateway

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run gateway:bootstrap-auth
npm run dev:gateway
```

### Terminal B — TUI

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run tui
```

### Terminal C — GUI

```powershell
cd C:\Projects\office-gui-for-agentic-ai
$env:PI_APP_OPEN_DEVTOOLS = "0"
npm run gui:dev
```

---

## Managed local state

GUI and TUI use:

- `%LOCALAPPDATA%\OfficeAgent\pi-agent`

Gateway auth uses:

- `%LOCALAPPDATA%\OfficeAgent\gateway-auth`

Gateway analytics log uses:

- `%LOCALAPPDATA%\OfficeAgent\gateway-analytics\events.jsonl`

---

## Boss demo / packaged GUI

Build the Windows portable package:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run gui:package
```

Output:

- `apps\gui\desktop\release\OfficeAgent-0.1.0-x64.exe`
- unpacked app dir: `apps\gui\desktop\release\win-unpacked\`

Simple boss-demo flow:

1. On your PC, run:

```powershell
cd C:\Projects\office-gui-for-agentic-ai
npm run gateway:bootstrap-auth
npm run dev:gateway
```

2. Open the analytics dashboard in a browser on the gateway PC:

- `http://localhost:8082/dashboard`

3. Make sure your Windows firewall allows inbound TCP on port `8082`.
4. Copy `OfficeAgent-0.1.0-x64.exe` to the boss PC.
5. Run it there.
6. Watch the dashboard while the boss uses the app.

The GUI/TUI now report simple client identity to the gateway using:

- Windows domain
- Windows username
- computer name
- client type (`gui` or `tui`)

It is currently hardcoded to connect to:

- `http://10.0.7.234:8082/v1`

If your PC's intranet IP changes, update the hardcoded URL in:

- `packages\office-agent-runtime\src\index.ts`

then rebuild the package.

---

## Manual packaged Python / uv sandbox test handoff

After the automated package/resource checks pass, please run the actual human smoke on a clean or representative Windows machine/profile.

Build the unpacked Windows package from repo root:

```powershell
npm run gui:package:dir
```

Confirm these packaged resources exist:

```powershell
Test-Path apps\gui\desktop\release\win-unpacked\resources\runtime\python
Test-Path apps\gui\desktop\release\win-unpacked\resources\runtime\uv
Test-Path apps\gui\desktop\release\win-unpacked\resources\windows-sandbox-helper\officeagent-windows-sandbox-helper.exe
Test-Path apps\gui\desktop\release\win-unpacked\resources\THIRD_PARTY_NOTICES.md
```

Then launch:

```powershell
apps\gui\desktop\release\win-unpacked\OfficeAgent.exe
```

In a managed project chat, ask the agent to run/check these Windows commands:

```cmd
python --version
python -m venv .venv
.venv\Scripts\python.exe -m pip --version
.venv\Scripts\python.exe -m pip install requests
.venv\Scripts\python.exe -c "import requests; print(requests.__version__)"
uv --version
uv python find
uv venv
uv pip install httpx
uv run python -c "import httpx; print(httpx.__version__)"
```

Expected current caveat: Python commands may print noisy `Failed to find real location of ...python.exe` warnings under AppContainer, but the commands should exit successfully.

---

## Useful scripts

From repo root:

```powershell
npm run gateway:bootstrap-auth
npm run gateway:probe-auth
npm run dev:gateway
npm run tui
npm run gui:dev
npm run gui:build
npm run gui:package
npm run gui:package:dir
```
