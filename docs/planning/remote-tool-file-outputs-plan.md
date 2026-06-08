# Remote and Local Tool File Outputs Plan

## Problem

OfficeAgent needs to support tools that produce files without confusing the agent with unusable paths.

There are two distinct cases:

1. **Local/client-side tools** such as `bash`, `write`, Python scripts, or future local custom tools. These run inside the managed desktop workspace/sandbox and may create files directly on the client machine.
2. **Remote/server-side tools**, especially the gateway-hosted `castrosua_sql_read_only` tool. The updated SQL CLI can auto-dump large results to files on the server, but server-local paths are not readable by the desktop agent.

The key rule: the model must see a usable path before the tool result is returned to Pi. UI/session rewrites after the fact are too late and risk divergence.

## Current Findings

### Local managed workspace

Managed OfficeAgent paths are rooted under:

- `%LOCALAPPDATA%\OfficeAgent\AgentData`
- Projects: `%LOCALAPPDATA%\OfficeAgent\AgentData\projects`
- Internal state: `%LOCALAPPDATA%\OfficeAgent\AgentData\.officeagent`
- Per-session dirs: `.officeagent\sessions\<sessionId>\`
- Per-project state: `.officeagent\project-state\ws-<hash>\`

Managed sessions receive useful env vars including:

- `OFFICE_AGENT_WORKSPACE`
- `OFFICE_AGENT_SCRATCH`
- `OFFICE_AGENT_SESSION_DIR`
- `OFFICE_AGENT_PROJECT_STATE`

Local tools are already mostly fine if they create files under the active workspace or managed scratch/project-state directories. The agent can then reference those paths with `read`, `bash`, Python, etc.

### SQL gateway today

Current call chain:

1. Generated extension in `packages/office-agent-runtime/src/index.ts`
2. `POST /v1/tools/castrosua_sql_read_only`
3. `apps/gateway/src/server.mjs`
4. SQL CLI under `apps/gateway/resources/sqlserver-readonly/`

Current gateway response shape is roughly:

```js
{
  content: [{ type: "text", text: summarizeSqlToolResult(...) }],
  details: {
    action,
    database,
    result: payload,
    stderr?
  }
}
```

The updated external CLI in `C:\Projects\cs-sqlserver-mcp` supports:

- `--output auto|inline|file`
- `--format auto|json|csv|jsonl`
- `--out FILE`
- `--out-dir DIR`
- `--auto-threshold N`

Large results can return:

```json
{
  "ok": true,
  "command": "query",
  "result": {
    "columns": ["..."],
    "rowCount": 123,
    "truncated": false
  },
  "output": {
    "mode": "file",
    "format": "json",
    "path": "SERVER_LOCAL_PATH",
    "bytes": 123456
  }
}
```

The bundled gateway SQL executable is currently older than the external published one.

Important rollout warning: the newer external CLI defaults to `--output auto`. Do not update bundled binaries by themselves. Until the gateway bridge is ready, the gateway must force `--output inline`; once the bridge is implemented, the binary update and gateway file handling must land atomically.

Capability requirement: the gateway must detect whether the configured SQL CLI supports output flags (`--output`, `--out-dir`, `--auto-threshold`) before passing them. Old bundled binaries may reject those flags. Never run a newer auto-output-capable CLI without an explicit output policy.

## Design Principles

1. **Do not rewrite paths after tool completion.** The tool implementation must return model-ready content.
2. **Local file paths stay local.** If a local tool writes inside the workspace, do not move it.
3. **Remote file paths are never model-facing.** Server paths should not appear in tool `content` or client-facing `details`.
4. **Remote files are materialized client-side before returning to Pi.** The final tool result should mention the client-accessible path.
5. **Gateway `remoteFiles` alone is not production-ready.** It must be hidden behind forced-inline mode or a disabled feature flag until client materialization is wired into the actual runtime path.
6. **Keep v1 text-first.** A local path in tool result text is sufficient; UI file chips can be a later enhancement.
7. **Make the remote-file contract generic enough for future remote tools, but implement SQL first.**

## Proposed Architecture

### A. Local/client-side file outputs

No bridge is needed for files created by local tools.

Recommended convention:

- User-facing outputs: write into `OFFICE_AGENT_WORKSPACE`.
- Temporary/intermediate outputs: write into `OFFICE_AGENT_SCRATCH`.
- Tool prompts should tell agents that files in the active workspace are directly readable in follow-up tool calls.

Chosen v1 landing convention:

- Materialized remote/user-facing tool outputs go under `%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files\`.
- SQL result files specifically go under `%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files\sql\`.

Use a visible, namespaced folder rather than a dot-folder because SQL exports are often useful deliverables, and both the user and agent should be able to find them easily. Temporary/internal files should still use `OFFICE_AGENT_SCRATCH`.

### B. Remote SQL file output bridge

#### Gateway side

The gateway should own server-side temporary output handling.

When invoking the SQL CLI, pass controlled output options for row-producing actions, especially `query` and possibly `sample`:

```text
--output auto
--out-dir <gateway-controlled-sql-output-dir>
--auto-threshold <configured-threshold>
```

The output dir should be under a gateway-managed data/temp directory, not next to the executable. The gateway should never rely on CLI output defaults; every SQL CLI invocation should explicitly pass either `--output inline` or `--output auto --out-dir ...`.

V1 command policy:

- `query` and `sample`: allow `--output auto` with the remote-file bridge.
- `info`, `list_tables`, and `describe`: force `--output inline` unless/until there is a reason to bridge files for them.
- If the bridge is incomplete or disabled, force `--output inline` for all commands.

After parsing CLI stdout:

- If output is inline: keep current behavior.
- If `payload.output.mode === "file"`:
  - verify the path is inside the controlled output dir
  - compute size/hash/mime
  - register it with an opaque id
  - return a client-facing file descriptor
  - remove or sanitize the server-local path from response content/details

Suggested response shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "SQL result was too large for inline output and is available as a file payload."
    }
  ],
  "details": {
    "action": "query",
    "database": "CastrosuaIA",
    "result": {
      "columns": ["..."],
      "rowCount": 123,
      "truncated": false
    },
    "remoteFiles": [
      {
        "id": "opaque-id",
        "downloadUrl": "files/opaque-id",
        "fileName": "sqlserver-query-20260605-abc123.json",
        "format": "json",
        "mimeType": "application/json",
        "bytes": 123456,
        "sha256": "..."
      }
    ]
  }
}
```

Add an authenticated download route:

```text
GET /v1/tools/castrosua_sql_read_only/files/:id
```

Requirements:

- bearer token required
- opaque ids only; never accept raw paths
- stream bytes
- set content type and content disposition
- log/audit file metadata, not raw server paths
- cleanup expired files
- return descriptor `downloadUrl` values relative to the SQL endpoint, such as `files/<id>`, or carefully constructed full URLs; avoid hard-coded `/v1/...` URLs because `OFFICE_AGENT_GATEWAY_URL` may already include `/v1` or sit behind a reverse proxy/base path

#### Client/runtime materialization side

V1 scope: **GUI-managed sessions first**. The initial implementation should target the Electron GUI/runtime-host managed session path unless we explicitly decide to support SDK/headless paths in the same change.

V1 preference: implement SQL as a **per-session managed custom tool** rather than relying on the current global generated SQL extension. The per-session tool can close over `cwd`, `sessionEnv`, `OFFICE_AGENT_WORKSPACE`, and `OFFICE_AGENT_TOOL_FILES`, which avoids ambiguous global extension env behavior.

Hard requirement: avoid duplicate registration of `castrosua_sql_read_only`. If the per-session custom tool owns this name, the current generated global extension must be disabled, gated, removed, or changed so it no longer registers the same tool in managed GUI sessions. Do not leave both active.

Prompt-context requirement: the current generated SQL extension also injects SQL/ERP guidance. If that extension is gated or retired for managed GUI sessions, equivalent SQL prompt context/tool guidance must be added through the managed runtime prompt/custom-tool path so agents do not lose the database usage instructions.

If keeping the generated extension, first prove that it receives the correct per-session workspace/tool-files paths in GUI runtime-host sessions. Do not rely on ambient process env without verification.

Flow:

1. Per-session SQL tool or verified session-aware extension calls the gateway SQL endpoint.
2. If no `details.remoteFiles`, return payload as today.
3. If remote files exist:
   - download each with the same bearer token
   - stream to disk while hashing and counting bytes; do not use `arrayBuffer()` for large files
   - write into a controlled local workspace directory
   - verify size/hash if provided
   - augment/replace returned `content` so the model sees the local path
   - add `details.materializedFiles`

The materializer must be symlink/junction-safe because generated extension filesystem writes bypass the Windows sandbox helper. It must create the destination directory itself, reject symlink/junction components, compare real paths for containment under the real workspace/tool-files root, write to a random temp file in the destination directory, atomically rename to the final file name, and clean up partial files on failure.

Recommended local destination for v1:

```text
%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files\sql\
```

Returned model-visible text should look like:

```text
SQL Server read-only tool completed action: query.

The full result was saved locally in the active workspace:
.\officeagent-tool-files\sql\sqlserver-query-20260605-abc123.json

Use this path with read/bash from the active workspace.
```

Structured details should retain useful metadata:

```json
{
  "materializedFiles": [
    {
      "localPath": "C:\\...\\officeagent-tool-files\\sql\\sqlserver-query-...json",
      "workspaceRelativePath": ".\\officeagent-tool-files\\sql\\sqlserver-query-...json",
      "format": "json",
      "mimeType": "application/json",
      "bytes": 123456,
      "sha256": "...",
      "source": { "gatewayFileId": "opaque-id" }
    }
  ]
}
```

## Files Likely to Change

### Gateway

`apps/gateway/src/server.mjs`

Likely functions/areas:

- SQL constants near top
- `handleSqlReadonlyRequest()`
- `buildSqlToolArgs()`
- `runSqlTool()` if cwd/output-dir handling needs adjustment
- `summarizeSqlToolResult()`
- router near bottom
- new helpers:
  - `getSqlOutputDir()`
  - `registerSqlOutputFile()`
  - `sanitizeSqlCliPayloadForClient()`
  - `sendRegisteredSqlOutputFile()`
  - cleanup/expiry helpers

Resources:

- `apps/gateway/resources/sqlserver-readonly/`
  - update bundled Windows/Linux SQL CLI binaries from `C:\Projects\cs-sqlserver-mcp\publish*`

### Runtime SQL tool / generated extension

Preferred v1 target:

- `apps/gui/desktop/office-agent-runtime.cts`
  - register `castrosua_sql_read_only` as a per-session managed custom tool, or include it in the managed runtime context when appropriate
  - use `cwd`/`sessionEnv` directly for local materialization

Still relevant for current/generated implementation:

- `packages/office-agent-runtime/src/index.ts`
  - `OFFICE_AGENT_SQLSERVER_READONLY_EXTENSION_SOURCE`
  - may remain as inline-only fallback or be refactored/retired for GUI managed sessions

Do not embed the security-sensitive materialization implementation directly in generated string source unless there is no alternative. Prefer normal, testable TypeScript/CommonJS modules for:

- remote file descriptor validation
- download URL resolution
- streaming download
- hash/size verification
- symlink/junction-safe local writes
- filename sanitization and collision handling
- final model-visible result formatting

If continuing with generated extension source, keep it as a thin wrapper around tested helper modules where possible, then update `OFFICE_AGENT_SQLSERVER_READONLY_EXTENSION_SOURCE` to call those helpers and materialize before returning.

Helper/env changes:

- add `OFFICE_AGENT_TOOL_FILES` env var in managed session setup, pointing to `%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files`
- ensure it is under workspace/managed root
- extension materialization must assert all destinations remain inside `OFFICE_AGENT_WORKSPACE` / `OFFICE_AGENT_TOOL_FILES` because extension filesystem writes bypass the Windows sandbox helper
- explicitly solve how the SQL tool obtains per-session workspace/tool-files paths in GUI sessions. Do not assume global Pi extensions automatically see per-session env vars.

### Workspace/env plumbing

The plan must verify or change how the SQL tool gets per-session workspace paths.

Full `OFFICE_AGENT_TOOL_FILES` plumbing list:

- add a constant/name wherever OfficeAgent env vars are defined
- set it in managed session env creation to `%OFFICE_AGENT_WORKSPACE%\officeagent-tool-files`
- create the directory lazily during materialization, or pre-create it during session setup
- pass/allow-list it through sandbox env plumbing so shell/local tools can see it
- include it in managed runtime prompt context/tool guidance
- use it in SQL materialization as the canonical root
- include it in tests/smokes that inspect managed env

Likely affected files:

- `apps/gui/desktop/office-agent-runtime.cts`
- `packages/office-agent-runtime/src/index.ts` to gate/retire the generated SQL tool registration, or keep it inline-only where appropriate
- `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`
- `packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts` if env propagation/allow-listing needs `OFFICE_AGENT_TOOL_FILES`

Robust implementation options:

1. **Preferred for v1:** move the SQL tool from a global generated extension to a per-session custom tool closure that already has `cwd` and `sessionEnv`.
2. Keep the extension, but explicitly pass per-session workspace/tool-files paths through a supported runtime mechanism before tool execution.
3. Disable remote file materialization when no managed workspace/tool-files path is available.

V1 should not rely on ambient process env unless verified in GUI runtime-host sessions. Gateway file output must remain disabled/inline until this workspace plumbing is solved.

Also add `OFFICE_AGENT_TOOL_FILES` wherever managed env is defined, propagated, sandbox-allowed, and documented in prompt/tool guidance.

### Optional UI follow-up

Not required for v1, but later:

- `apps/gui/shared/pi-message-mapper.ts`
- `apps/gui/src/app/components/workspace/thread/ToolCallsCard.tsx`

for clickable file chips based on `details.materializedFiles`.

### Docs/build outputs

- `apps/gateway/README.md` for SQL output env vars/routes
- built `dist` files for touched packages, if this repo expects them to be committed

## Edge Cases

- Server path leakage in `content`, `details.result.output.path`, stderr, errors, summaries, or audit/debug payloads. Gateway must sanitize the parsed payload before calling `summarizeSqlToolResult()` and before assigning `details.result`.
- File path traversal via filename from server.
- Filename collisions in local materialization dir.
- Unsafe Windows filenames: reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1` etc.), trailing spaces/dots, control characters, mixed path separators, overly long names, and extension/format mismatches.
- Multiple files in one tool result.
- Large files causing memory spikes if downloaded via `arrayBuffer()`.
- Download expires before client materializes.
- Client aborts during download.
- Hash mismatch.
- Gateway restart loses in-memory file registry.
- Sensitive SQL data retained too long on server or client.
- New SQL binary deployed before bridge support, causing auto-file output and server path leakage.
- Reverse proxy/base-path mismatch if descriptors use hard-coded absolute `/v1/...` download URLs.
- Artifact/chat sessions without normal workspace tools. V1 should either disable remote file materialization there with a clear error, or ensure those sessions have a real managed landing workspace before enabling SQL file outputs.
- Model compaction preserving old unusable paths if server paths leak.
- Windows/Linux path normalization.
- SQL CLI output formats not valid for all commands.
- Duplicate `castrosua_sql_read_only` registration if both global generated extension and per-session custom tool are active.
- Incorrect relative download URL resolution. Resolve `files/<id>` by appending to the SQL endpoint as a directory path, not with naive `new URL()` against a no-trailing-slash endpoint.

## Tests and Smokes

### Gateway

Add or update gateway SQL smokes/tests:

- Mock/fake CLI returns file-mode payload.
- Gateway returns `details.remoteFiles`.
- Response content/details do not include raw server path.
- Descriptor uses reverse-proxy-safe relative download URLs.
- Download endpoint requires bearer token.
- Downloaded bytes/hash match.
- Expired/missing ids fail safely.
- Audit logs include file count/bytes but not raw paths.

Testing strategy note: current gateway spawning uses `shell: false`, so fake executables are awkward cross-platform. Before adding file-mode smokes, either extract SQL file-registration/sanitization helpers into a testable module, add a test-only fake SQL CLI mode/env, or provide a reliable platform-specific fake executable strategy.

### Extension/materialization

Add focused tests for helper logic, ideally by extracting materialization code out of the generated string if practical:

- downloads remote file by streaming
- writes under workspace tool-files dir
- rejects symlink/junction traversal
- sanitizes unsafe names
- handles collisions
- verifies sha256 and byte count
- returns content containing local relative path
- does not return server path
- fails clearly when no managed workspace/tool-files root is available

### End-to-end smoke

1. Start gateway with SQL CLI/fake CLI configured to force file output.
2. Call `castrosua_sql_read_only` from a managed session.
3. Assert tool result contains local workspace path.
4. Assert file exists locally.
5. Assert follow-up `read`/`bash` can access it.
6. Assert no server path appears in model-visible content.

## Phased Implementation

### Phase 1: Safety baseline

- Keep the current bundled SQL binary, or if updating to the newer binary before the bridge is complete, force `--output inline` for every SQL CLI call.
- Because old binaries may not support `--output inline`, coordinate/capability-gate binary and argument changes.
- Do not expose gateway `remoteFiles` to production Pi/model-facing results yet.

### Phase 2: Gateway file contract behind a disabled flag

- Add controlled SQL output dir.
- Add feature flag/env to enable SQL remote file mode; default off.
- When disabled, force inline behavior.
- When enabled internally, invoke row-producing commands with `--output auto --out-dir ... --auto-threshold ...`.
- Detect file-mode output.
- Register remote files.
- Add authenticated download route.
- Sanitize server paths from client-facing response.
- Add gateway tests/smoke using fake CLI strategy.

### Phase 3: Session-aware client materialization

- Resolve per-session workspace/tool-files plumbing for GUI runtime-host sessions.
- Prefer implementing SQL as a per-session custom tool rather than a global extension.
- Gate/retire the existing generated SQL extension tool registration so there is only one `castrosua_sql_read_only` tool in managed GUI sessions.
- Extract materialization helpers into testable modules rather than generated string code.
- Detect `remoteFiles`.
- Resolve relative download URLs safely by appending to the SQL endpoint path.
- Stream-download and materialize into workspace.
- Return model-visible local path.
- Add materialization tests/smoke.

### Phase 4: Enable SQL auto-file output end-to-end

- Enable gateway SQL remote file mode only after Phase 2 and Phase 3 are both wired together.
- Allow `--output auto` for `query` and `sample`.
- Keep `info`, `list_tables`, and `describe` inline.
- Verify end-to-end follow-up `read`/`bash` can access materialized file paths.

### Phase 5: Prompt and UX polish

- Update SQL tool prompt guidelines to explain large outputs.
- Add local tool convention text if needed.
- Introduce `OFFICE_AGENT_TOOL_FILES` as the canonical local landing root for materialized remote files.
- Update managed env constants, session env creation, sandbox env allow-listing if needed, and prompt context so agents know where tool files land.

### Phase 6: Optional generic file attachments

- Generalize `remoteFiles` beyond SQL.
- Add UI file chips/download/open buttons.
- Add transcript/export support if required.

## Open Decisions / Defaults To Set Before Coding

These should be resolved before implementation rather than deferred indefinitely.

Concrete v1 defaults:

- Gateway registry: in-memory is acceptable for v1 because client materialization should happen immediately before returning the tool result to Pi.
- Gateway file TTL: 60 minutes.
- Default large SQL file format: JSON for v1.
- Gateway max single registered SQL file size: 100 MB unless a lower product limit is chosen before coding.
- Gateway max total SQL temp dir size: 1 GB unless a lower product limit is chosen before coding.
- Cleanup runs on gateway start and periodically, e.g. every 10 minutes.
- Server files remain until TTL cleanup for retry/debug within the short window; do not expose server paths.

Remaining open decisions:

1. Should the v1 size caps above be lowered for deployment constraints?
2. Should server files delete immediately after successful client download in addition to TTL cleanup?
3. Should this be SQL-specific first or generic from the start? Current preference: SQL-specific implementation with generic `remoteFiles` shape.
4. How exactly should artifact/chat sessions without managed workspace file tools handle large SQL outputs?

## Follow-up: Managed Runtime Duplication Cleanup

The SQL file-output work should not permanently deepen the existing split between managed runtime implementations.

There are currently two relevant managed runtime paths:

- GUI/runtime-host path:
  - `apps/gui/desktop/office-agent-runtime.cts`
  - `apps/gui/desktop/runtime-host/live-runtime-registry.cts`
- Package/SDK-driver path:
  - `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`

For product behavior, the GUI/runtime-host path is the v1 canonical target because it is what real Electron GUI sessions use. It is acceptable for the initial SQL file-output implementation to be scoped to GUI-managed sessions, but that scope should be explicit.

After the SQL file-output bridge is working, investigate actual usages of `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts` and decide whether to:

1. Delete it if it is no longer used.
2. Deprecate it if only legacy/test paths reference it.
3. Refactor shared managed runtime/tool/context logic into reusable helpers consumed by both GUI and SDK/headless paths.

Do not let SQL materialization become another long-lived divergent implementation. The preferred long-term outcome is one canonical managed runtime/tool implementation, or a clearly documented GUI-only runtime with dead duplicate code removed.
