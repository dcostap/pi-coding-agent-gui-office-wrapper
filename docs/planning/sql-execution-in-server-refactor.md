# SQL execution on server refactor plan

Goal: move the actual SQL Server communication and `castrosua-readonly-sqlserver.exe` execution to the OfficeAgent gateway/server. The client-facing Pi tool should remain seamless: same tool name, same parameters, same prompt behavior, and no renderer/UI changes.

## Current state

SQL execution is client-side today:

- `packages/office-agent-runtime/src/index.ts`
  - generates the Pi extension `castrosua-sqlserver-readonly.ts`
  - registers `castrosua_sql_read_only`
  - resolves `castrosua-readonly-sqlserver.exe` locally
  - runs it with `pi.exec(...)`

- `apps/gui/desktop/office-agent-runtime.cts`
  - calls `setSqlServerReadonlyToolEnvIfPresent()`
  - sets `OFFICE_AGENT_SQLSERVER_TOOL_EXE` to a bundled client exe when present

- `apps/gui/desktop/resources/sqlserver-readonly/`
  - currently contains the Windows SQL tool exe and `Microsoft.Data.SqlClient.SNI.dll`

- `apps/gui/electron-builder.yml`
  - packages all `desktop/resources`, so the SQL exe ships to clients

- `apps/gateway/src/server.mjs`
  - currently handles chat/model/VFS/analytics routes
  - does not execute SQL tools yet

## Target architecture

Keep the model/tool contract stable:

- tool name: `castrosua_sql_read_only`
- same actions and params: `info`, `list_tables`, `describe`, `sample`, `query`
- same visible prompt guidance
- same top-level success/error behavior from the agent's point of view

Change only the implementation:

1. The client Pi extension becomes a thin HTTP wrapper.
2. It POSTs logical tool params to the gateway.
3. The gateway validates the request and builds CLI args server-side.
4. The gateway runs `castrosua-readonly-sqlserver.exe` on the server host.
5. The gateway returns a sanitized Pi-tool-result-shaped JSON response.
6. The extension returns that result to Pi.

The client must never send raw CLI args, resolve a local SQL exe, or connect to SQL Server directly.

## Implementation plan

### 1. Add a gateway SQL tool endpoint

Add to `apps/gateway/src/server.mjs`:

- `POST /v1/tools/castrosua_sql_read_only`

Important URL detail: `OFFICE_AGENT_GATEWAY_URL` already points at a `/v1` base by default, so the client should append `tools/castrosua_sql_read_only` without stripping `/v1` or any reverse-proxy prefix. Avoid `new URL("/tools/...", base)` because it drops the `/v1` path.

Gateway responsibilities:

- authenticate with the same bearer token as the existing gateway routes
- read client identity headers for audit only; do not treat them as strong authorization
- validate the logical tool params, not raw CLI args
- build CLI args on the server
- spawn the configured SQL tool with:
  - `shell: false`
  - `cwd: path.dirname(exe)` so `Microsoft.Data.SqlClient.SNI.dll` is found
  - `windowsHide: true`
- enforce timeout, stdout limit, and stderr limit
- kill the child on timeout or HTTP client disconnect/cancel
- parse stdout JSON when possible
- return controlled tool errors for timeout/output-limit/validation failures

Recommended env vars:

- `OFFICE_AGENT_SQLSERVER_TOOL_EXE` - explicit server-side exe path
- `OFFICE_AGENT_SQLSERVER_TIMEOUT_MS` - default around `120000`
- `OFFICE_AGENT_SQLSERVER_MAX_STDOUT_BYTES` - bounded JSON result size
- `OFFICE_AGENT_SQLSERVER_MAX_STDERR_BYTES` - bounded error output size
- `OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT` - small concurrency guard, default `2` or `4`

Server-side exe resolution should support:

1. `OFFICE_AGENT_SQLSERVER_TOOL_EXE`
2. `apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver.exe` in development/deployment layouts

### 2. Define the gateway response contract

The gateway should return Pi tool-result-shaped JSON for all normal tool outcomes.

HTTP status split:

- HTTP `401`: bad/missing gateway token.
- HTTP `400`: malformed JSON or structurally broken request body.
- HTTP `413`: request body too large, if implemented separately from `400`.
- HTTP `200` with `{ isError: true, ... }`: semantic/tool failures, including validation failure, invalid database/action, missing SQL exe, SQL CLI nonzero exit, timeout, output-limit failure, or concurrency busy.
- HTTP `200` without `isError`: successful SQL tool action.

This keeps model-caused/tool-caused failures visible as normal tool results instead of transport exceptions.

Success shape should preserve the current “full JSON is in details” behavior:

```js
{
  content: [{ type: "text", text: summarize(action, payload) }],
  details: {
    action,
    database,
    result: payload,
    stderr: stderr || undefined
  }
}
```

Error shape should be sanitized and should not include server paths, raw CLI args, or raw SQL:

```js
{
  isError: true,
  content: [{ type: "text", text: "..." }],
  details: {
    action,
    database,
    errorCode,
    stderr: sanitizedStderr
  }
}
```

Avoid returning:

```js
details: { exe, args }
```

`args` can include raw SQL, and `exe` leaks server paths.

### 3. Make validation concrete and action-specific

The gateway endpoint should enforce at least:

- `action` allowlist:
  - `info`
  - `list_tables`
  - `describe`
  - `sample`
  - `query`

- `database`:
  - default to `LOGIC`
  - normalize to uppercase before checking
  - allow only `LOGIC` and `GLP4`

- `includeViews`:
  - if present, must be boolean

- `limit`:
  - integer only; reject decimals rather than flooring them
  - default `20` for `sample`
  - clamp/reject above a safe maximum

- `schema` / `table`:
  - strings only
  - `describe` requires `table`
  - `sample` requires `table`
  - reject null bytes, semicolons, path-like values, and suspicious control characters
  - prefer a conservative SQL Server identifier regex; no dotted names because `schema` and `table` are separate fields

- `sql` for `query`:
  - required and non-empty
  - max length
  - read-oriented statements only, while recognizing checks here are guardrails, not the security boundary

Action-irrelevant fields should never be passed to the CLI. Choose and test one consistent behavior: either reject irrelevant/unknown fields as tool validation errors, or ignore known irrelevant fields and reject unknown keys. Recommended: reject unknown keys; ignore known irrelevant fields after validation.

### 4. Add query safety guardrails

Read-only DB credentials are the real safety boundary and must be scoped to the intended databases. Server-side SQL text checks are only defense-in-depth.

Minimum guardrails for `action: "query"`:

- strip leading comments/whitespace before checking the first keyword
- allow only first keyword `SELECT` or `WITH`
- reject multiple statements; allow at most a trailing semicolon if needed
- reject obvious write/admin tokens as standalone keywords:
  - `INSERT`
  - `UPDATE`
  - `DELETE`
  - `MERGE`
  - `DROP`
  - `ALTER`
  - `CREATE`
  - `TRUNCATE`
  - `EXEC`
  - `EXECUTE`
  - `GRANT`
  - `REVOKE`
  - `BACKUP`
  - `RESTORE`
  - `DBCC`
  - `USE`
- enforce max SQL length

Do not rely on regex alone for safety. The SQL login used by the exe must be read-only and should not have access outside the intended databases.

### 5. Sanitize returned details and logs

Preserve the tool's top-level shape, but sanitize all details/errors before returning to the client or writing audit logs.

Redact at least:

- Windows/Linux paths
- connection strings
- `Password=...`
- `User Id=...` / `UserID=...` / `UID=...`
- server hostnames if considered sensitive
- raw CLI args
- raw SQL, if the CLI echoes it in errors

For `query`, prefer SQL hash + SQL length in audit logs instead of raw SQL.

### 6. Add concurrency/rate protection

Because this exposes SQL execution through the gateway, add a small concurrency guard:

- env: `OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT`
- default: `2` or `4`
- when exceeded, return HTTP `200` with `{ isError: true, details: { errorCode: "busy" } }`

Optional later hardening: per-identity or per-remote-address rate limits. This is not a replacement for DB-side read-only permissions and query limits, but it protects the gateway/DB from many simultaneous LLM-generated heavy queries.

### 7. Replace local Pi extension execution with HTTP

Update the generated SQL extension in `packages/office-agent-runtime/src/index.ts`:

- remove local exe resolution
- remove `pi.exec(exe, args, ...)`
- POST params to `${OFFICE_AGENT_GATEWAY_URL}/tools/castrosua_sql_read_only` using safe path joining that preserves `/v1`
- authenticate with `OFFICE_AGENT_GATEWAY_TOKEN`
- forward existing OfficeAgent identity headers
- preserve `onUpdate`
- forward abort/cancellation via `AbortSignal`
- for HTTP `200`, return the gateway tool result directly
- for non-`200`, throw or return a controlled infrastructure error with sanitized text

The generated Pi extension should be self-contained because it is written into the runtime agent dir and should not import repo-local helpers. Include small local helpers in the generated source, such as:

- `appendUrlPath(base, segment)`
- `createIdentityHeaders()`
- `postJsonWithAbort()`
- `extractErrorMessage()`

Also update wording that currently says access is through a “bundled CLI executable”; after the refactor it should say server/gateway-backed SQL access.

If practical, tighten the generated TypeBox schema:

- use an integer type for `limit`
- consider a `LOGIC | GLP4` enum for `database`, while still normalizing/validating server-side

### 8. Stop packaging SQL binaries in the client

Update `apps/gui/electron-builder.yml` so the GUI no longer copies all of `desktop/resources`.

Current broad copy:

```yml
extraResources:
  - from: desktop/resources
    to: resources
```

Use a narrower copy so packaged skills still work:

```yml
extraResources:
  - from: desktop/resources/skills
    to: resources/skills
```

This preserves the packaged skill path expected by runtime code:

```txt
process.resourcesPath/resources/skills
```

Remove the client SQL env setup from `apps/gui/desktop/office-agent-runtime.cts`:

- imports for SQL exe/resource constants
- `setSqlServerReadonlyToolEnvIfPresent()` call
- `setSqlServerReadonlyToolEnvIfPresent()` implementation

Move/deploy the SQL resources to the gateway/server side instead:

```txt
apps/gateway/resources/sqlserver-readonly/castrosua-readonly-sqlserver.exe
apps/gateway/resources/sqlserver-readonly/Microsoft.Data.SqlClient.SNI.dll
```

### 9. Deployment notes

The SQL execution host must be able to run the SQL tool. The current resource is a Windows `.exe` plus `Microsoft.Data.SqlClient.SNI.dll`, so either:

- run the gateway SQL endpoint on Windows, or
- provide a Linux/server-compatible build of the SQL tool and update resolution/deployment accordingly

Production must explicitly align:

- client/runtime `OFFICE_AGENT_GATEWAY_TOKEN`
- gateway `GATEWAY_TOKEN`

The runtime default token and gateway demo default are not a security boundary. Treat the bearer token as deployment configuration, not per-user authorization.

If the previously shipped client exe embedded SQL credentials or server details, rotate those credentials after moving execution server-side.

### 10. Audit logging

Add server-side audit events for SQL tool calls. Log enough to diagnose use without leaking sensitive data:

- timestamp
- identity headers and remote address
- action
- database
- duration
- status/error code
- stdout/stderr byte counts
- concurrency-busy events
- for `query`, SQL hash and SQL length instead of raw SQL

Avoid logging raw SQL by default unless explicitly approved.

### 11. Tests/smokes

Add scripts:

```bash
npm run gateway:smoke:sql
npm run smoke:sql --workspace @office-agent/gateway
```

Minimum coverage:

- unauthenticated request returns `401`
- malformed/protocol-broken request returns `400`/`413`
- invalid action/database returns HTTP `200` with `isError: true`
- action-specific validation failures are caught before exe resolution
- validation failures do not require `OFFICE_AGENT_SQLSERVER_TOOL_EXE`
- `action: info` works when `OFFICE_AGENT_SQLSERVER_TOOL_EXE` is configured
- timeout/output-limit/concurrency-busy behavior returns controlled tool errors, if feasible

If the real exe is environment-dependent, skip the live `info` portion unless `OFFICE_AGENT_SQLSERVER_TOOL_EXE` is set. If fake-exe coverage is added, design it deliberately for Windows and non-Windows with `shell: false`; otherwise keep fake coverage to validation paths that do not spawn.

## Implementation sequence

Recommended order:

1. Add gateway SQL validation/build-args helpers.
2. Add gateway process runner with timeout/output limits/disconnect cancellation.
3. Add `/v1/tools/castrosua_sql_read_only`.
4. Add SQL audit JSONL logging or equivalent gateway-side audit storage.
5. Replace generated extension with the self-contained HTTP wrapper.
6. Remove desktop SQL env setup.
7. Narrow `electron-builder.yml` resources copy.
8. Move/deploy SQL resources to `apps/gateway/resources/sqlserver-readonly`.
9. Add smoke script and package scripts.
10. Run the suggested checks.

## Suggested checks

```bash
npm run build --workspace @office-agent/runtime
npm run gateway:smoke:vfs
npm run gateway:smoke:analytics
npm run gateway:smoke:sql
cd apps/gui && bun run typecheck:desktop
cd apps/gui && bun run typecheck:web
```

For packaged GUI artifacts, verify the client no longer contains the SQL tool, while skills remain packaged:

```txt
win-unpacked/resources/resources/skills
win-unpacked/resources/resources/sqlserver-readonly  # should be absent
```

## Security boundaries

- SQL credentials must live only on the gateway/server host.
- DB credentials should be read-only and limited to the intended databases.
- The gateway must enforce database allowlists and conservative request limits.
- Client identity headers are useful for audit, but not trustworthy authorization by themselves.
- The bearer token should not be treated as a strong per-user auth model if it is distributed with clients.
- The server should never expose internal exe paths, raw CLI args, raw SQL, connection strings, or credentials in returned details or default logs.

## Verdict

The refactor should be achievable without renderer/UI changes. The critical implementation details are URL joining under the existing `/v1` base, a precise gateway response contract, action-specific validation, query guardrails backed by read-only DB credentials, cancellation/timeout/output-limit handling, sanitized result details, concurrency protection, precise client packaging changes, and Windows/server deployment of the SQL executable.
