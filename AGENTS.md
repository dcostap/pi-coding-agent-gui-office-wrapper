# AGENTS.md

OfficeAgent is an Electron GUI around a pinned Pi agent runtime.

Key points for coding agents:

- Main GUI: `apps/gui/desktop`.
- Shared runtime helpers: `packages/office-agent-runtime` and `packages/pi-sdk-driver`.
- Windows sandbox helper: `native/windows-sandbox-helper`.
- Planning/history docs live in `docs/planning/`; do not treat them as current requirements without checking code.
- Agent data defaults to `%LOCALAPPDATA%\OfficeAgent\AgentData` on Windows.
- In managed GUI sessions, Pi `write`/`edit` tools are constrained to AgentData; shell commands go through the Windows helper.
- Prefer updating existing tests/smokes when touching sandbox/runtime behavior.

Useful checks:

```bash
npm run build --workspace @pi-gui/pi-sdk-driver
npm run build --workspace @office-agent/gui
npm run sandbox:smoke
```
