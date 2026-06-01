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
- `POST /v1/tools/castrosua_sql_read_only`

It accepts abstract models such as `assistant` and `gpt-5.5`, routes them to configured upstream Pi models, exposes read-only server resources, and writes practical request analytics to append-only JSONL ledgers. The dashboard focuses on request volume, estimated input/output tokens, processing time, users, models, and tools; health/latency are present but secondary.

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
- `OFFICE_AGENT_VFS_BASE_DIR` - optional parent directory for configured virtual root folders; default `/srv/officeagent/vfs`.

Virtual root registry details live in `packages/office-agent-runtime/src/office-agent-vfs-roots.ts` so gateway and client use the same source of truth.
- `OFFICE_AGENT_VFS_TIMEOUT_MS` - default `30000`
- `OFFICE_AGENT_SQLSERVER_TOOL_EXE` - optional explicit path to the server-side `castrosua-readonly-sqlserver.exe`.
- `OFFICE_AGENT_SQLSERVER_TIMEOUT_MS` - SQL tool process timeout; default `120000`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDOUT_BYTES` - SQL tool stdout limit; default `2097152`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDERR_BYTES` - SQL tool stderr limit; default `262144`.
- `OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT` - SQL tool concurrency limit; default `2`.
- `OFFICE_AGENT_SQLSERVER_MAX_SAMPLE_LIMIT` - maximum `sample` limit; default `200`.
- `OFFICE_AGENT_SQLSERVER_MAX_SQL_CHARS` - maximum query length; default `20000`.

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

## SQL tool smoke

```bash
npm run gateway:smoke:sql
```

This starts the gateway in mock mode and verifies auth plus SQL-tool validation behavior without spawning the SQL executable. If `OFFICE_AGENT_SQLSERVER_TOOL_EXE` is configured for the smoke environment, it also verifies `action: "info"` against the real server-side tool.

The SQL Server executable and its native dependencies must be deployed on the gateway host, for example under `apps/gateway/resources/sqlserver-readonly/`. The currently bundled SQL tool is a Windows executable, so the gateway SQL endpoint must run on Windows unless a server-compatible non-Windows build is supplied.

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
