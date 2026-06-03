# Gateway

Minimal A-side development gateway.

## Current scope

This first version exposes:
- `GET /health`
- `GET /dashboard`
- `GET /analytics/summary?range=30m|24h|7d|all`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/codex/responses`
- `GET /v1/vfs/roots`
- `POST /v1/vfs/read`
- `POST /v1/vfs/list`
- `POST /v1/vfs/find`
- `POST /v1/vfs/grep`
- `POST /v1/tools/castrosua_sql_read_only`

It accepts abstract models such as `assistant` and `gpt-5.5`, routes them to configured upstream Pi models, proxies Responses/Codex streams for reasoning-capable models, exposes read-only server resources, and writes practical request analytics to append-only JSONL ledgers. The dashboard focuses on request volume, estimated input/output tokens, processing time, users, models, and tools; health/latency are present but secondary.

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
- `OFFICE_AGENT_SQLSERVER_TOOL_EXE` - optional explicit path to the server-side SQL tool. If unset, the gateway auto-detects `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver` on Linux/macOS and `castrosua-readonly-sqlserver.exe` on Windows.
- `OFFICE_AGENT_SQLSERVER_TIMEOUT_MS` - SQL tool process timeout; default `120000`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDOUT_BYTES` - SQL tool stdout limit; default `2097152`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDERR_BYTES` - SQL tool stderr limit; default `262144`.
- `OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT` - SQL tool concurrency limit; default `2`.
- `OFFICE_AGENT_SQLSERVER_MAX_SAMPLE_LIMIT` - maximum `sample` limit; default `200`.
- `OFFICE_AGENT_SQLSERVER_MAX_SQL_CHARS` - maximum query length; default `20000`.

SQL tool database policy: the gateway always uses the default SQL Server database `CastrosuaIA` and only accepts that database if a raw request includes `database`. The client-side Pi tool does not expose a database parameter. Agents have read-only access to the available contents of `CastrosuaIA`.

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

This starts the gateway in mock mode, verifies auth plus SQL-tool validation behavior, and verifies `action: "info"` when a server-side SQL tool is present. The repository includes default Windows and Linux x64 builds under `apps/gateway/resources/sqlserver-readonly/`, so no `OFFICE_AGENT_SQLSERVER_TOOL_EXE` override is normally required.

Default deployed resource paths:

- Linux: `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver`
- Windows: `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver.exe` plus `Microsoft.Data.SqlClient.SNI.dll`

The Linux build carries app-local ICU libraries beside the executable, so minimal Debian hosts do not need a separate `libicu` install. On Linux deployments, the binary must be executable. The checked-in file mode should handle this after `git pull`; if needed, run `chmod +x apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver` once on the server.

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
