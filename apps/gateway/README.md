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
- `GET /v1/tools/castrosua_sql_read_only/files/:id` (authenticated SQL file-payload download for materialized large SQL results)

It accepts abstract models and routes them to configured upstream Pi models. `/v1/chat/completions` raw-proxies only OpenAI Chat-compatible (`openai-completions`) routes such as Requesty; Responses/Codex routes such as `gpt-5.5` should use `/v1/responses` or `/v1/codex/responses`. The gateway exposes read-only server resources and writes practical request analytics to append-only JSONL ledgers. Analytics observes streamed chunks but does not reconstruct provider streams. The dashboard focuses on request volume, estimated input/output tokens, processing time, users, models, and tools; health/latency are present but secondary.

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
- `GATEWAY_REQUESTY_ABSTRACT_MODEL` - default `azure/gpt-5.4@swedencentral`; the OpenAI Chat-compatible model id exposed by `/v1/chat/completions`.
- `GATEWAY_REQUESTY_UPSTREAM_PROVIDER` / `GATEWAY_GPT54_REQUESTY_UPSTREAM_PROVIDER` - default `requesty`; upstream provider for the Requesty chat route.
- `GATEWAY_REQUESTY_UPSTREAM_MODEL` / `GATEWAY_GPT54_REQUESTY_UPSTREAM_MODEL` - default `azure/gpt-5.4@swedencentral`; upstream model for the Requesty chat route.
- `OFFICE_AGENT_VFS_BASE_DIR` - optional parent directory for configured virtual root folders; default `/srv/officeagent/vfs`.

Virtual root registry details live in `packages/office-agent-runtime/src/office-agent-vfs-roots.ts` so gateway and client use the same source of truth.
- `OFFICE_AGENT_VFS_TIMEOUT_MS` - default `30000`
- `OFFICE_AGENT_SQLSERVER_TOOL_EXE` - optional explicit path to the server-side SQL tool. If unset, the gateway auto-detects `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver` on Linux/macOS and `castrosua-readonly-sqlserver.exe` on Windows.
- `OFFICE_AGENT_SQLSERVER_TIMEOUT_MS` - SQL tool process timeout; default `120000`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDOUT_BYTES` - SQL tool stdout limit; default `2097152`.
- `OFFICE_AGENT_SQLSERVER_MAX_STDERR_BYTES` - SQL tool stderr limit; default `262144`.
- `OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT` - SQL tool concurrency limit; default `70`.
- `OFFICE_AGENT_SQLSERVER_MAX_SAMPLE_LIMIT` - maximum `sample` limit; default `200`.
- `OFFICE_AGENT_SQLSERVER_MAX_SQL_CHARS` - maximum query length; default `20000`.
- `OFFICE_AGENT_SQLSERVER_REMOTE_FILE_OUTPUTS` - enable/disable the SQL remote-file bridge for `query`/`sample`; default enabled. Set `0`/`false` only for troubleshooting.
- `OFFICE_AGENT_SQLSERVER_OUTPUT_DIR` - gateway-controlled temporary SQL output directory; default `%LOCALAPPDATA%/OfficeAgent/gateway-sql-output`.
- `OFFICE_AGENT_SQLSERVER_AUTO_THRESHOLD` - auto-file threshold passed to newer SQL CLIs; default `12000`.
- `OFFICE_AGENT_SQLSERVER_DEFAULT_QUERY_ROW_LIMIT` - default row cap passed to SQL CLI `query` when the remote-file bridge is active; default `10000`.
- `OFFICE_AGENT_SQLSERVER_MAX_QUERY_ROW_LIMIT` - SQL CLI max row cap when the remote-file bridge is active; default at least `10000`.
- `OFFICE_AGENT_SQLSERVER_FILE_TTL_MS` - registered file TTL before cleanup; default `3600000` (60 minutes).
- `OFFICE_AGENT_SQLSERVER_MAX_FILE_BYTES` - maximum single registered SQL output file; default `104857600` (100 MB).
- `OFFICE_AGENT_SQLSERVER_MAX_OUTPUT_DIR_BYTES` - best-effort total temp-dir cap; default `1073741824` (1 GB).

SQL tool database policy: the gateway always uses the default SQL Server database `CastrosuaIA` and only accepts that database if a raw request includes `database`. The client-side Pi tool does not expose a database parameter. Agents have read-only access to the available contents of `CastrosuaIA`.

When the configured SQL CLI advertises `--output`, `--out-dir`, and `--auto-threshold`, the gateway passes `--output auto --format json --out-dir <controlled-dir>` for `query` and `sample`, registers file-mode results with opaque ids, and exposes only authenticated `files/:id` descriptors. GUI-managed sessions materialize those descriptors into `%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files\sql\` before returning the tool result to the agent. For `query`, the gateway also raises the SQL CLI row cap to the configured default query row limit so large-but-safe results can be materialized instead of silently truncating at the CLI default.

## Start

```bash
npm run dev --workspace @office-agent/gateway
```

## Analytics smoke

```bash
npm run gateway:smoke:analytics
```

This starts the gateway in mock mode, sends one streamed request, and verifies the analytics summary includes requests, estimated tokens, users, models, tools, buckets, and deltas.

## Chat proxy smoke

```bash
npm run gateway:smoke:chat-proxy
```

This starts a temporary OpenAI Chat-compatible upstream, verifies `/v1/chat/completions` rewrites only routing/auth and preserves upstream CRLF-delimited SSE bytes unchanged, then checks analytics counted the request.

## VFS smoke

```bash
npm run gateway:smoke:vfs
```

This starts the gateway in mock mode with a temporary `OFFICE_AGENT_VFS_BASE_DIR`, then verifies `roots`, `list`, `read`, `find`, and `grep` VFS endpoints.

## SQL tool smoke

```bash
npm run gateway:smoke:sql
```

This starts the gateway in mock mode with a test fake SQL CLI, verifies auth plus SQL-tool validation behavior, verifies the remote-file descriptor/download contract, and checks that server output paths are not leaked. The repository includes default Windows and Linux x64 builds under `apps/gateway/resources/sqlserver-readonly/`, so no `OFFICE_AGENT_SQLSERVER_TOOL_EXE` override is normally required for real gateway runs.

Default deployed resource paths:

- Linux: `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver`
- Windows: `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver.exe` plus `Microsoft.Data.SqlClient.SNI.dll` and app-local ICU DLLs.

The Windows and Linux builds carry app-local ICU libraries beside the executable, so hosts do not need a separate ICU install. On Linux deployments, the binary must be executable. The checked-in file mode should handle this after `git pull`; if needed, run `chmod +x apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver` once on the server.

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
