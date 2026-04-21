# Development Bootstrap

## Current first milestone

We are proving the smallest vertical slice first:

1. A-side gateway accepts one abstract model: `assistant`
2. B-side local pinned Pi uses that gateway through a shared OfficeAgent runtime layer
3. Pi runs locally on B without depending on any globally installed `pi`
4. A-side auth is moving toward Pi-auth-backed Codex usage via a dedicated copied auth store

## Packages

- `apps/gateway` - minimal A-side gateway
- `apps/tui` - terminal entrypoint using pinned local Pi
- `apps/gui/desktop` - desktop entrypoint
- `packages/office-agent-runtime` - shared managed OfficeAgent runtime wiring

## Setup

From repo root:

```bash
npm install
```

## Bootstrap gateway auth from your local Pi

```bash
npm run gateway:bootstrap-auth
npm run gateway:probe-auth
```

This copies the `openai-codex` OAuth entry from your normal local Pi auth file into the gateway-owned auth store and verifies that Pi can resolve `openai-codex/gpt-5.3-codex-spark` from that copied auth.

## Run the gateway

```bash
set OPENROUTER_API_KEY=...
npm run dev:gateway
```

## Run the OfficeAgent TUI

In a second terminal:

```bash
npm run pi:managed
```

or:

```bash
npm run tui
```

This starts the pinned Pi TUI using the shared OfficeAgent managed runtime and defaults it to `corp/assistant`.
