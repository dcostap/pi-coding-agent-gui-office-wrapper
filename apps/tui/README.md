# OfficeAgent TUI

Thin terminal entrypoint for OfficeAgent.

This app launches a pinned stock Pi CLI/TUI while sharing the same managed OfficeAgent runtime assumptions as the GUI:

- `%LOCALAPPDATA%\\OfficeAgent\\pi-agent`
- managed `corp/assistant` provider extension
- OfficeAgent gateway env defaults

## Run

From repo root:

```powershell
npm run tui
```

Or directly in this workspace:

```powershell
npm run tui --workspace @office-agent/tui
```
