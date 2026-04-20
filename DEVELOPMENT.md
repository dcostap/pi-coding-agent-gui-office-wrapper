# Development Bootstrap

## Current first milestone

We are proving the smallest vertical slice first:

1. A-side gateway accepts one abstract model: `assistant`
2. B-side local pinned Pi uses that gateway through a local extension
3. Pi runs locally on B without depending on any globally installed `pi`
4. A-side auth is moving toward Pi-auth-backed Codex usage via a dedicated copied auth store

## Packages

- `apps/gateway` - minimal A-side gateway
- `apps/client-runtime` - pinned local Pi runtime + provider extension

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

## Run the local pinned Pi

In a second terminal:

```bash
npm run pi:managed
```

This should start the locally pinned Pi runtime and default it to `corp/assistant`.
