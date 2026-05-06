# Gateway

Minimal A-side development gateway.

## Current scope

This first version exposes:
- `GET /health`
- `GET /dashboard`
- `GET /analytics/summary?range=30m|24h|7d|all`
- `GET /v1/models`
- `POST /v1/chat/completions`

It accepts the abstract model `assistant`, routes every request to one configured upstream model, and writes practical request analytics to an append-only JSONL ledger. The dashboard focuses on request volume, estimated input/output tokens, processing time, users, models, and tools; health/latency are present but secondary.

## Environment variables

- `PORT` / `OFFICE_AGENT_GATEWAY_PORT` - default `8082`
- `HOST` - default `0.0.0.0`
- `GATEWAY_TOKEN` - default `officeagent-demo-2026`
- `MOCK_MODE=1` - return mock streamed responses without an upstream call
- `OFFICE_AGENT_GATEWAY_ANALYTICS_DIR` - default `%LOCALAPPDATA%/OfficeAgent/gateway-analytics`
- `OFFICE_AGENT_GATEWAY_AUTH_PATH` - gateway-owned Pi auth store
- `OFFICE_AGENT_GATEWAY_MODELS_PATH` - gateway-owned Pi model registry
- `GATEWAY_UPSTREAM_PROVIDER` - default `openai-codex`
- `GATEWAY_UPSTREAM_MODEL` - default `gpt-5.3-codex-spark`

## Start

```bash
npm run dev --workspace @office-agent/gateway
```

## Analytics smoke

```bash
npm run gateway:smoke:analytics
```

This starts the gateway in mock mode, sends one streamed request, and verifies the analytics summary includes requests, estimated tokens, users, models, tools, buckets, and deltas.

## Pi-auth-backed bootstrap

To copy the local Pi OAuth entry for Codex into the gateway-owned auth store:

```bash
npm run gateway:bootstrap-auth
```

This copies `openai-codex` from your normal Pi auth file into the dedicated gateway auth file.

To verify the gateway auth can resolve the target model:

```bash
npm run gateway:probe-auth
```

By default this probes:
- provider: `openai-codex`
- model: `gpt-5.3-codex-spark`
