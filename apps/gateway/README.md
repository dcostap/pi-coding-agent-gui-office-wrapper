# Gateway

Minimal A-side development gateway.

## Current scope

This first version exposes:
- `GET /health`
- `GET /dashboard`
- `GET /analytics/summary?range=30m|24h|7d|all`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/vfs/roots`
- `POST /v1/vfs/read`
- `POST /v1/vfs/list`
- `POST /v1/vfs/find`
- `POST /v1/vfs/grep`

It accepts abstract models such as `assistant` and `gpt-5.5`, routes them to configured upstream Pi models, and writes practical request analytics to an append-only JSONL ledger. The dashboard focuses on request volume, estimated input/output tokens, processing time, users, models, and tools; health/latency are present but secondary.

## Environment variables

- `PORT` / `OFFICE_AGENT_GATEWAY_PORT` - default `8082`
- `HOST` - default `0.0.0.0`
- `GATEWAY_TOKEN` - default `officeagent-demo-2026`
- `MOCK_MODE=1` - return mock streamed responses without an upstream call
- `OFFICE_AGENT_GATEWAY_ANALYTICS_DIR` - default `%LOCALAPPDATA%/OfficeAgent/gateway-analytics`
- `OFFICE_AGENT_GATEWAY_AUTH_PATH` - gateway-owned Pi auth store
- `OFFICE_AGENT_GATEWAY_MODELS_PATH` - gateway-owned Pi model registry
- `GATEWAY_UPSTREAM_PROVIDER` - default `openai-codex`
- `GATEWAY_UPSTREAM_MODEL` - default `gpt-5.3-codex-spark` for `assistant`
- `GATEWAY_GPT55_UPSTREAM_MODEL` / `GATEWAY_GPT_5_5_UPSTREAM_MODEL` - default `gpt-5.4` for abstract `gpt-5.5`
- `OFFICE_AGENT_VFS_BASE_DIR` - optional parent directory for virtual roots; default `/srv/officeagent/vfs`. Each direct child folder is exposed as `virtual://<folder_name>`.
- `OFFICE_AGENT_VFS_TIMEOUT_MS` - default `30000`

## Start

```bash
npm run dev --workspace @office-agent/gateway
```

## Analytics smoke

```bash
npm run gateway:smoke:analytics
```

This starts the gateway in mock mode, sends one streamed request, and verifies the analytics summary includes requests, estimated tokens, users, models, tools, buckets, and deltas.

## VFS smoke

```bash
npm run gateway:smoke:vfs
```

This starts the gateway in mock mode with a temporary `OFFICE_AGENT_VFS_BASE_DIR`, then verifies `roots`, `list`, `read`, `find`, and `grep` VFS endpoints.

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
