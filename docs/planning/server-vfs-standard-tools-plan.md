# Server Virtual Filesystem via Standard Pi Tools

## Status

Planning document. No implementation yet.

## Goal

Give the OfficeAgent/Pi agent read-only, on-demand access to server-hosted document roots while preserving normal local project behavior and the standard Pi tool names.

The agent should keep using familiar tools:

- `read`
- `ls`
- `find`
- `grep`
- `edit`
- `write`
- `bash`

Local paths continue to operate on the managed OfficeAgent workspace as they do today. Reserved URI-like virtual path prefixes route selected read-only operations to a backend API instead of the local filesystem.

Example virtual root:

```txt
virtual://castrosua_iso/
```

Example agent calls:

```txt
read path="virtual://castrosua_iso/policies/quality.md"
ls path="virtual://castrosua_iso"
find pattern="**/*.md" path="virtual://castrosua_iso"
grep pattern="risk assessment" path="virtual://castrosua_iso" ignoreCase=true
```

The client maps `virtual://castrosua_iso` to backend `rootId: "castrosua_iso"`; the backend maps that root ID to a configured Linux directory, for example:

```txt
virtual://castrosua_iso -> castrosua_iso -> /srv/officeagent/vfs/castrosua_iso
```

No local mount, mirror, or cache is required for the MVP. Every virtual access is a backend request.

## Non-goals for MVP

- No OS-level mount, FUSE, WebDAV, ProjectedFS, or shell filesystem virtualization.
- No local mirror/cache of server content.
- No writes to virtual roots.
- No automatic remote searching when the agent searches `.`.
- No true `bash` access to virtual roots.

This means these should not be expected to work as remote operations:

```bash
rg foo virtual://castrosua_iso
type virtual://castrosua_iso\file.txt
cat virtual://castrosua_iso/file.txt
```

The prompt/tool guidelines must tell the agent to use `read`, `ls`, `find`, and `grep` for virtual roots.

## Current repository facts

### Primary managed runtime path

The main SDK-managed OfficeAgent runtime is:

```txt
packages/pi-sdk-driver/src/office-agent-managed-runtime.ts
```

It already disables Pi built-ins and supplies OfficeAgent-controlled same-named tools:

```ts
noTools: "builtin"
customTools: [readTool, copy_file_into_workspace, bashTool, editTool, writeTool]
```

This is the primary integration point.

### Desktop/runtime-host path

There is a second managed-tool setup path in:

```txt
apps/gui/desktop/office-agent-runtime.cts
```

It is used by:

```txt
apps/gui/desktop/runtime-host/live-runtime-registry.cts
```

That path currently accepts only:

```ts
createBashToolDefinition
createEditToolDefinition
createReadToolDefinition
createWriteToolDefinition
```

and returns the same limited custom tool set:

```txt
read
copy_file_into_workspace
bash
edit
write
```

If the feature is implemented, both managed runtime paths must be updated or consolidated so behavior does not differ between runtime modes.

There is also a separate session creation path in:

```txt
apps/gui/desktop/runtime/runtime-registry.cts
```

It appears to be a different/older desktop runtime path. Before implementation, classify it as unused/legacy or include it in scope. Do not leave an active GUI session path without the same virtual-tool behavior.

The TUI entry point should also be scoped explicitly. `apps/tui/scripts/run-tui.mjs` launches pinned Pi directly, so if it does not use the OfficeAgent managed SDK runtime, the MVP can be GUI-only. The plan/README should state that server VFS is not available in TUI until that path is wired through the same managed tool factory.

### Missing read-only tools today

Pi 0.75.3 supports optional built-ins:

```txt
ls
find
grep
```

However OfficeAgent uses `noTools: "builtin"`, so these tools are absent unless OfficeAgent re-adds them as custom tools. This feature should explicitly add controlled `ls`, `find`, and `grep` tools.

### Gateway URL/versioning detail

The current client/gateway environment uses:

- `OFFICE_AGENT_GATEWAY_URL`, defaulting to a `/v1` base URL such as `http://172.16.1.124:8082/v1`
- `OFFICE_AGENT_GATEWAY_TOKEN`

The current gateway routes include:

```txt
/health
/analytics/summary
/v1/models
/v1/chat/completions
```

VFS endpoint placement must be explicit. Do not naively append `/vfs/read` to a value that may already end in `/v1` unless that is the intended route.

Recommended MVP choice:

```txt
POST /v1/vfs/read
POST /v1/vfs/list
POST /v1/vfs/find
POST /v1/vfs/grep
```

Then `OFFICE_AGENT_GATEWAY_URL=http://host:8082/v1` can be reused safely by appending path segments such as `vfs/read` to the configured base path. Do not use root-relative URL construction like `new URL("/vfs/read", base)`, because that drops `/v1`.

Alternative acceptable choice:

```txt
OFFICE_AGENT_VFS_URL=http://host:8082/v1/vfs
```

If a separate VFS service is deployed. Pick one before implementation; do not leave this implicit.

## User-facing model

To the agent, virtual roots should feel like read-only folders at the project root:

```txt
virtual://castrosua_iso/
```

Rules:

1. Use normal `read`, `ls`, `find`, and `grep` for `virtual://castrosua_iso`.
2. Use normal tools for local workspace paths.
3. `virtual://castrosua_iso` is read-only.
4. `edit` and `write` to `virtual://castrosua_iso` are blocked.
5. `bash` cannot access `virtual://castrosua_iso` as a remote folder because it is not mounted or mirrored.
6. Remote `find` and `grep` results include the virtual prefix so follow-up reads work.

Example remote grep output should include the prefix:

```txt
virtual://castrosua_iso/policies/quality.md:42: risk assessment must be reviewed annually
virtual://castrosua_iso/procedures/audit.md:18: internal risk assessment evidence
```

not:

```txt
policies/quality.md:42: risk assessment must be reviewed annually
```

## Virtual path format

### Recommended canonical format

Use a URI-like format:

```txt
virtual://castrosua_iso/path/to/file.md
```

Rationale:

- It is clearly not a normal workspace path.
- It resembles familiar remote/URI path conventions.
- It carries the product concept (`virtual`) directly in the path string.
- It avoids collisions with real workspace folders such as `castrosua_iso/`.
- If it accidentally appears in `bash`, it is easy to detect and warn about.

Other considered formats:

```txt
virtual:castrosua_iso/path/to/file.md
vfs://castrosua_iso/path/to/file.md
officeagent-vfs://castrosua_iso/path/to/file.md
```

`virtual://castrosua_iso/...` is the preferred MVP format because it is self-explanatory while still URI-like. `vfs://...` is shorter but more jargon-heavy; `officeagent-vfs://...` is explicit but too long for frequent agent use.

### Hardcoded root registry

The gateway exposes hardcoded virtual roots under a fixed VFS base directory.

Default base directory:

```txt
/srv/officeagent/vfs
```

Optional override:

```txt
OFFICE_AGENT_VFS_BASE_DIR=/srv/officeagent/vfs
```

Root definitions include the root ID, folder name, display name, and system-prompt description in shared code (`packages/office-agent-runtime/src/office-agent-vfs-roots.ts`). For the Castrosua ISO docs:

```txt
rootId castrosua_iso -> /srv/officeagent/vfs/castrosua_iso -> virtual://castrosua_iso
```

The client parser accepts valid `virtual://<root_name>/...` URIs and lets the gateway decide whether that hardcoded root exists. `GET /v1/vfs/roots` returns the hardcoded roots and their prompt metadata from the server. OfficeAgent injects this metadata into the system prompt for every session so agents know when and why to probe each virtual folder.

### Accepted path spellings

The dispatcher should recognize only canonical virtual URI spellings for MVP:

```txt
virtual://castrosua_iso
virtual://castrosua_iso/
virtual://castrosua_iso/foo.md
virtual://castrosua_iso/folder/file.md
```

Do not support these as virtual paths for MVP:

```txt
./virtual://castrosua_iso/foo.md
%OFFICE_AGENT_WORKSPACE%\virtual://castrosua_iso\foo.md
../virtual://castrosua_iso/foo.md
```

`virtual://...` is not workspace-root-relative. It is a tool-level virtual URI namespace. The parser should inspect raw tool args before local path normalization and before placeholder expansion can reinterpret the string as a local path.

For MVP, virtual URI components are exact lowercase identifiers. Treat `virtual://castrosua_iso` as virtual; do not silently accept case variants such as `Virtual://castrosua_iso` or `virtual://Server_Iso_Docs`, even on Windows. This avoids surprising aliases and keeps server root IDs stable.

Client-side parser must reject malformed virtual paths before making backend requests, even though the backend must repeat all safety checks. Reject NUL bytes, unsupported schemes, empty authorities, invalid authority names, drive-letter fragments inside virtual paths, UNC-looking paths, backslash path separators, and traversal that would escape the virtual root. The server returns `unknown_root` if a syntactically valid `virtual://<root_name>` is not present under the VFS base directory. Use explicit `path.win32`-style checks for drive letters/UNC/backslashes in tests so behavior is stable even when tests run cross-platform.

The parser should be callable on both raw tool arguments and placeholder-expanded arguments. Render-time paths, especially edit previews, may see raw args depending Pi internals; execution paths may see `prepareArguments` output. Because canonical virtual paths are URI strings, raw-arg detection should happen before any local filesystem resolution.

### Bash advisory for virtual URIs

Because `bash` is not virtualized, commands that mention `virtual://castrosua_iso` will not access remote content. For MVP, do not try to parse and rewrite shell commands. Instead, wrap the OfficeAgent `bash` tool so that if the command string contains a configured virtual URI prefix, the tool result includes an appended advisory note, for example:

```txt
NOTE: virtual://castrosua_iso is an OfficeAgent virtual filesystem URI, not a local folder. Bash cannot access it. Use read, ls, find, or grep with that virtual path instead.
```

This note should be appended whether the command succeeds or fails, so the model sees the correction immediately. It should not block the command unless a later hardening phase adds explicit preflight blocking.

### Virtual path mapping

Input:

```txt
virtual://castrosua_iso/policies/quality.md
```

Dispatcher parses:

```json
{
  "scheme": "virtual",
  "authority": "castrosua_iso",
  "uriPrefix": "virtual://castrosua_iso",
  "rootId": "castrosua_iso",
  "virtualPath": "/policies/quality.md"
}
```

Backend resolves:

```txt
/srv/officeagent/vfs/castrosua_iso/policies/quality.md
```

The real backend filesystem path must never be exposed to the model.

## Tool behavior

### Dispatcher pattern

Use same-named dispatcher tools. Each wrapper keeps Pi's normal local behavior but intercepts virtual-root paths.

Pseudocode:

```ts
const localRead = pi.createReadToolDefinition(cwd, localOptions);

const readTool = {
  ...localRead,
  async execute(toolCallId, args, signal, onUpdate, ctx) {
    const virtual = parseOfficeAgentVirtualUri(args.path, {
      env,
      roots,
    });
    if (!virtual) {
      return localRead.execute(toolCallId, args, signal, onUpdate, ctx);
    }
    return serverVfs.read({
      rootId: virtual.rootId,
      uriPrefix: virtual.uriPrefix,
      virtualPath: virtual.virtualPath,
      offset: args.offset,
      limit: args.limit,
      signal,
    });
  },
};
```

Use this pattern for:

- `read`
- `ls`
- `find`
- `grep`

Use explicit guards for:

- `edit`
- `write`

Reserved OfficeAgent tool names must not be shadowable by `baseCustomTools` / user-provided custom tools. In Pi, duplicate tool names may be collapsed through a `Map`, where later registrations can win. Therefore do not rely on ordering alone unless tests prove the exact active-tool behavior. Safer MVP options:

- reject/filter `baseCustomTools` whose names are reserved: `read`, `ls`, `find`, `grep`, `edit`, `write`, `bash`, `copy_file_into_workspace`; or
- append OfficeAgent-controlled wrappers after base/user tools so they override duplicate names, and test that active tools resolve to the OfficeAgent wrappers.

Recommended MVP: reject duplicate reserved names with a clear managed-runtime error. This is simpler and security-explicit.

### Shared factory dependency injection

The shared OfficeAgent tool construction should accept Pi tool factories as dependencies instead of statically importing Pi everywhere. This avoids ESM/CJS friction in the desktop `.cts` runtime path, which currently obtains Pi exports through `getPiModule()`.

Preferred shape:

```ts
createOfficeAgentManagedTools({
  pi: {
    createReadToolDefinition,
    createLsToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createEditToolDefinition,
    createWriteToolDefinition,
    createBashToolDefinition,
  },
  cwd,
  sessionEnv,
  managedRootDir,
  sessionPaths,
  projectStatePaths,
  virtualRoots,
  serverVfsClient,
})
```

Both runtime paths should call this same function.

### `read`

Local paths delegate to Pi's current `createReadToolDefinition` behavior.

Virtual paths call backend `read` and return a Pi-compatible tool result:

```ts
{
  content: [{ type: "text", text: "..." }],
  details: { truncation?: ... }
}
```

Support Pi-style `offset` and `limit` line pagination. For MVP, text-only support is sufficient. Image handling can be added later if needed.

Binary or non-UTF-8 server files should fail clearly for MVP, for example `virtual://castrosua_iso/path is not a UTF-8 text file`, rather than returning mojibake.

Remote `read` continuation hints must point back to the `read` tool with `offset`/`limit`; they must not include Pi's local fallback hints such as `Use bash: sed ...`, because bash cannot access virtual roots.

### `ls`

Local paths delegate to Pi's `createLsToolDefinition`.

Virtual paths call backend `list`.

Special discovery behavior:

- `ls path="virtual://castrosua_iso"` lists backend root.
- `ls path="."` includes configured virtual root entries appended to the local listing, for example:

```txt
virtual://castrosua_iso/
```

Do not make local root listing fail if the backend is unavailable. Recommended MVP behavior: always display configured virtual roots; backend failures appear only when the root is accessed.

Avoid implementing `ls .` by parsing Pi's rendered text output, because local output may include truncation notices or `(empty directory)`. Use an OfficeAgent-owned local listing helper for the workspace-root listing branch, then append configured virtual URI roots before formatting in Pi `ls` style.

### `find`

Local paths delegate to Pi's `createFindToolDefinition`.

Virtual paths call backend `find`.

Remote results must include the virtual prefix and preserve the searched subpath. Searching `virtual://castrosua_iso/procedures` should return:

```txt
virtual://castrosua_iso/procedures/audit.md
virtual://castrosua_iso/procedures/internal/review.md
```

not:

```txt
audit.md
internal/review.md
```

Do not automatically include remote roots when `path` is omitted or `path="."`. Require explicit `path="virtual://castrosua_iso"` to avoid surprising/expensive remote searches.

Backend `find` should document and mimic Pi's local behavior where practical:

- include hidden files unless ignored
- respect `.gitignore`-style ignore rules when applicable
- apply default ignores for heavy folders such as `.git` and `node_modules`
- enforce result limits

### `grep`

Local paths delegate to Pi's local grep implementation.

Virtual paths call backend `grep`.

Do not rely on Pi's `createGrepToolDefinition(..., { operations })` for remote grep. In Pi 0.75.3, grep still launches local `rg` against a local path; operations only help with directory checks/context reads. True remote grep must be a dispatcher branch that calls the server.

Backend must use Linux `rg` for grep.

Remote grep output must include the virtual prefix and use Pi-like line formatting:

```txt
virtual://castrosua_iso/path/file.md:123: matched text
virtual://castrosua_iso/path/file.md-124- context text
```

Match lines use `path:line: text`. Context lines use `path-line- text`.

### `edit` and `write`

Local paths keep current OfficeAgent managed-root behavior.

Virtual paths are rejected before any local file operation:

```txt
virtual://castrosua_iso is read-only remote content. Use read, ls, find, or grep for virtual://castrosua_iso paths.
```

This prevents the model from treating remote read-only content as locally writable.

Important `edit` caveat: Pi's edit tool may do local diff/preview work during render-time paths such as `renderCall()`, not only during `execute()`. The guard must therefore happen before delegating any edit execution or preview/render path that can touch the filesystem. Acceptable approaches:

- wrap/override `edit.renderCall` for virtual paths and render a simple blocked/read-only preview without computing a local diff
- disable edit preview for virtual paths
- implement the guard at a lower layer used by both preview and execution

A wrapper that only guards `execute()` is not sufficient.

`write` does not have the same local-read diff preview issue, but it should still be guarded before local mkdir/write operations.

### `bash`

Keep current OfficeAgent sandboxed bash behavior.

Do not virtualize `bash` for MVP. Add prompt guidance:

```txt
Virtual roots such as virtual://castrosua_iso are not real local folders. Bash commands cannot access them as remote content. Use read, ls, find, and grep for virtual roots.
```

Additionally, wrap the OfficeAgent `bash` tool so that when `command` contains a configured virtual URI prefix such as `virtual://castrosua_iso`, the final tool result includes an advisory note:

```txt
NOTE: virtual://castrosua_iso is an OfficeAgent virtual filesystem URI, not a local folder. Bash cannot access it. Use read, ls, find, or grep with that virtual path instead.
```

The advisory should be appended to bash output on both success and failure. It should not block the command in MVP. If the command produces no other output, the note alone is still useful. Optional future hardening can add a preflight warning/block for commands mentioning virtual URI prefixes.

## Backend API

### Endpoint placement

Recommended MVP endpoint placement is under the existing `/v1` gateway namespace:

```http
GET  /v1/vfs/roots
POST /v1/vfs/list
POST /v1/vfs/read
POST /v1/vfs/find
POST /v1/vfs/grep
```

With `OFFICE_AGENT_GATEWAY_URL=http://host:8082/v1`, the client appends path segments `vfs/read`, `vfs/list`, etc. Preserve the configured base path. Do not use `new URL("/vfs/read", base)` or any other root-relative join that would turn `/v1/vfs/read` into `/vfs/read`.

If VFS is deployed as a separate service, introduce an explicit `OFFICE_AGENT_VFS_URL` and do not infer it by stripping or rewriting `/v1` from `OFFICE_AGENT_GATEWAY_URL`.

`GET /v1/vfs/roots` returns the hardcoded virtual root registry, with real paths resolved under `OFFICE_AGENT_VFS_BASE_DIR`.

For the current gateway implementation, add routes in `apps/gateway/src/server.mjs`. Use bounded JSON body reads for VFS requests so a malformed client cannot submit unbounded request bodies.

### Common request fields

```json
{
  "rootId": "castrosua_iso",
  "path": "/policies/quality.md"
}
```

### `read` request

```json
{
  "rootId": "castrosua_iso",
  "path": "/policies/quality.md",
  "offset": 1,
  "limit": 200
}
```

### `list` request

```json
{
  "rootId": "castrosua_iso",
  "path": "/procedures",
  "limit": 500
}
```

### `find` request

```json
{
  "rootId": "castrosua_iso",
  "path": "/",
  "pattern": "**/*.md",
  "limit": 1000
}
```

### `grep` request

```json
{
  "rootId": "castrosua_iso",
  "path": "/",
  "pattern": "risk assessment",
  "glob": "*.md",
  "ignoreCase": true,
  "literal": false,
  "context": 0,
  "limit": 100
}
```

### Response shape and text conventions

The backend needs enough context to produce virtual-prefixed `find`/`grep` paths. There are two valid designs:

1. Backend owns `rootId -> uriPrefix` and returns fully Pi-like payloads with paths such as `virtual://castrosua_iso/...`.
2. Backend returns structured relative paths/matches, and the client formats Pi-like text by prepending the client virtual prefix.

Recommended MVP: backend returns structured results, and the OfficeAgent client formats final Pi-compatible tool text. This keeps the backend independent from Pi rendering conventions and avoids coupling it to client-side virtual prefix names. The client already knows `virtual://castrosua_iso -> castrosua_iso`.

Example structured grep response:

```json
{
  "matches": [
    { "path": "/policies/quality.md", "line": 42, "text": "risk assessment..." }
  ],
  "limitReached": false
}
```

The client formats that as:

```txt
virtual://castrosua_iso/policies/quality.md:42: risk assessment...
```

MVP text conventions for client-formatted tool results:

- `read`: return file text with continuation hints that say to use `read` with `offset`/`limit`; never suggest `bash`, `sed`, `cat`, or `rg` fallbacks for virtual paths.
- `list`: return sorted entry names, directories suffixed with `/`, matching Pi's local `ls` style.
- `find`: return one virtual-prefixed path per line, including searched subpath context.
- `grep`: return `path:line: text` for matches and `path-line- text` for context lines.
- All returned paths must be virtual paths such as `virtual://castrosua_iso/...`, never real server paths.

Errors can be returned as:

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "Path not found: virtual://castrosua_iso/foo.md"
  }
}
```

The client wrapper should throw an `Error(message)` so Pi renders it as a normal failed tool call.

### Timeout/error policy

The client should distinguish and phrase common failures clearly:

- auth failure: token missing/invalid
- unavailable backend: server not reachable or timeout
- not found: virtual path does not exist
- forbidden: root/path not authorized
- limit exceeded: output/search too broad

Backend calls should have bounded timeouts and respect the active tool abort signal.

The VFS client should send `Authorization: Bearer ${OFFICE_AGENT_GATEWAY_TOKEN}` or the equivalent configured gateway token. The server currently validates against `GATEWAY_TOKEN`, so deployment must align those values.

For audit/authorization, forward the same kind of OfficeAgent identity headers used by the gateway provider path where available, for example `X-OfficeAgent-Client`, `X-OfficeAgent-User`, `X-OfficeAgent-Domain`, and `X-OfficeAgent-Host` from `sessionEnv`.

## Backend security and path safety

Backend must treat the virtual path as untrusted.

Requirements:

1. Root IDs map only to configured allowlisted directories.
2. Normalize POSIX-style virtual paths.
3. Reject `..` traversal.
4. Reject absolute host paths, drive letters, UNC paths, and NUL bytes.
5. Resolve symlinks safely; reject symlink escapes outside the configured root.
6. Do not follow symlinks during grep/find by default; avoid `rg -L` for MVP.
7. Decide whether symlink entries are listed. Recommended: list symlink entries only if they resolve inside the root; otherwise omit or mark inaccessible without leaking targets.
8. Never return real server paths to the model, including in errors.
9. Apply request authentication/authorization using existing gateway/session identity.
10. Apply size, time, and result limits to prevent expensive scans.
11. Sanitize `rg` stderr and all filesystem errors before returning them; do not leak real paths through tool error messages.

For grep, invoke `rg` safely with argument arrays, not shell string concatenation. Enforce server-side maximums for runtime, output bytes, matches, and maximum file size considered by search.

Recommended `rg` basis:

```bash
rg --json --line-number --color=never --hidden --no-require-git -- <pattern> <resolved-root-or-subpath>
```

Add flags from request only after validation:

- `--ignore-case`
- `--fixed-strings`
- `--glob <glob>`
- context flags if using rg context directly, or compute context after matches

## Prompt/system context additions

Append OfficeAgent prompt context similar to the existing shell prompt context.

Suggested wording:

```txt
OfficeAgent exposes read-only server virtual folders through normal read-only tools.
Available virtual folders:
- virtual://castrosua_iso/: company ISO/legal documentation hosted on the OfficeAgent server.

Use read, ls, find, and grep with paths under virtual://castrosua_iso to inspect this content.
Virtual folders are not real local folders: bash cannot access them as remote content, and edit/write are blocked.
When find or grep returns virtual://castrosua_iso/... paths, use those exact paths in follow-up read calls.
Do not search virtual://castrosua_iso unless the task calls for company documentation or the user asks for it.
```

Runtime-path caveat: `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts` already appends prompt contexts via `resourceLoaderOptions`. The desktop live runtime path creates services differently, so implementation must explicitly ensure the same prompt context reaches that path too. Tool `promptGuidelines` are helpful but are not a complete substitute if the plan depends on a true system-prompt block.

Implementation requirement: add a shared prompt-context factory, for example `getOfficeAgentVirtualFsPromptContext(virtualRoots)`, and wire it into every active managed runtime path, including desktop live runtime sessions.

## Implementation plan

### Phase 1: Shared VFS types, client, and path parsing

Add a small shared module in `packages/pi-sdk-driver/src`, for example:

```txt
packages/pi-sdk-driver/src/office-agent-virtual-fs.ts
```

Responsibilities:

- virtual root/result types
- hardcoded virtual root registry and `virtual://<root_name> -> rootId <root_name>` parsing
- endpoint URL resolution with explicit `/v1/vfs` behavior or `OFFICE_AGENT_VFS_URL`
- virtual URI parser for `virtual://authority/path` strings
- path prefix guard helpers
- VFS client interface
- HTTP-backed VFS client implementation with timeout and abort support

Export what the desktop CJS runtime path needs, or keep it importable from source as current desktop runtime already imports package source files.

### Phase 2: Shared managed tool construction with injectable Pi factories

Add a shared factory module, for example:

```txt
packages/pi-sdk-driver/src/office-agent-managed-tools.ts
```

It should accept Pi factories as dependencies and construct the full managed tool set:

```ts
createOfficeAgentManagedTools({
  pi,
  cwd,
  managedRootDir,
  sessionEnv,
  sessionPaths,
  projectStatePaths,
  shellConfig,
  baseCustomTools,
  virtualRoots,
  serverVfsClient,
})
```

This module should create:

- dispatcher `read`
- dispatcher `ls`
- dispatcher `find`
- dispatcher `grep`
- `copy_file_into_workspace`
- sandboxed `bash`
- guarded `edit`
- guarded `write`
- reject or filter any `baseCustomTools` with reserved OfficeAgent tool names
- append only non-reserved `baseCustomTools`

The dispatcher/guard helpers can live in the same module or in:

```txt
packages/pi-sdk-driver/src/office-agent-virtual-fs-tools.ts
```

Factories/helpers:

- `createOfficeAgentReadDispatcherTool(...)`
- `createOfficeAgentLsDispatcherTool(...)`
- `createOfficeAgentFindDispatcherTool(...)`
- `createOfficeAgentGrepDispatcherTool(...)`
- `withVirtualFsWriteGuard(tool, ...)`
- `withVirtualFsEditGuard(tool, ...)`

### Phase 3: Update package managed runtime

Update:

```txt
packages/pi-sdk-driver/src/office-agent-managed-runtime.ts
```

Imports should include Pi optional tool definitions:

```ts
createLsToolDefinition
createFindToolDefinition
createGrepToolDefinition
```

Tool list should become approximately:

```txt
read
ls
find
grep
copy_file_into_workspace
bash
edit
write
```

`read`, `ls`, `find`, `grep` are dispatcher tools. `edit` and `write` include reserved-prefix guards, including edit render/preview guard.

Add virtual-folder prompt context to `promptContexts`.

### Phase 4: Update desktop/runtime-host path

Update:

```txt
apps/gui/desktop/office-agent-runtime.cts
apps/gui/desktop/runtime-host/live-runtime-registry.cts
```

Extend the `PiModule` pick passed into `createOfficeAgentManagedCustomTools` to include:

```ts
createLsToolDefinition
createFindToolDefinition
createGrepToolDefinition
```

Return the same custom tool set as the package runtime by calling the shared managed tool factory. Ensure the desktop path also receives the virtual-folder prompt context, not only tool-level guidelines.

Consider deeper consolidation after MVP so the desktop CJS path and package runtime cannot diverge again.

### Phase 5: Backend implementation

Add VFS endpoints to the server/gateway backend. Current gateway scope is documented in:

```txt
apps/gateway/README.md
```

Recommended endpoint namespace:

```txt
/v1/vfs/*
```

Server implementation must:

- map hardcoded roots under `OFFICE_AGENT_VFS_BASE_DIR`, e.g. `castrosua_iso` -> `/srv/officeagent/vfs/castrosua_iso` -> `virtual://castrosua_iso`
- run `rg` for grep
- return structured read/list/find/grep results that the client formats with virtual prefixes
- enforce path containment and limits
- avoid leaking real server paths, including sanitized `rg` stderr
- validate `Authorization: Bearer ...` against the configured gateway token
- capture forwarded OfficeAgent identity headers for audit/authorization

VFS gateway smokes should skip when no VFS root is configured.

### Phase 6: Tests

Recommended tests:

#### Virtual URI parsing

- `virtual://castrosua_iso/foo.md` routes to `{ rootId: "castrosua_iso", path: "/foo.md" }`
- `virtual://castrosua_iso` and `virtual://castrosua_iso/` route to `{ rootId: "castrosua_iso", path: "/" }`
- `./virtual://castrosua_iso/foo.md` is rejected or treated as a normal malformed local path; it must not route remotely
- `%OFFICE_AGENT_WORKSPACE%\virtual://castrosua_iso\foo.md` is rejected; virtual URIs are not workspace paths
- backslash virtual paths such as `virtual://castrosua_iso\foo.md` are rejected; use URI `/` separators
- case variants such as `Virtual://castrosua_iso` and `virtual://Server_Iso_Docs` are rejected
- traversal/malformed virtual inputs are rejected client-side

#### Tool dispatch

- local `read` delegates to local read
- virtual `read` calls server client
- local `ls` delegates locally
- `ls .` includes configured virtual URI roots such as `virtual://castrosua_iso/`
- virtual `find` calls server client and returns prefixed paths
- virtual `grep` calls server client and returns prefixed paths/context lines in Pi style
- `find path="."` and `grep path="."` do not search remote roots

#### Write/edit blocking

- `write virtual://castrosua_iso/foo.md` fails before creating local files
- `edit virtual://castrosua_iso/foo.md` fails before local access/write
- `edit.renderCall` or equivalent preview path does not attempt local filesystem preview for virtual URI paths
- placeholder-expanded workspace paths containing malformed embedded virtual URI strings are blocked/rejected
- `bash` appends the virtual URI advisory note when its command mentions `virtual://castrosua_iso`

#### Runtime coverage

- package runtime exposes active tools `read`, `ls`, `find`, `grep`, `edit`, `write`, `bash`, not merely registered definitions
- desktop runtime-host path exposes the same active read-only tools
- user/base custom tools cannot replace OfficeAgent reserved tool wrappers; duplicate reserved names are rejected or proven overridden by active-tool tests
- both runtime paths include equivalent virtual-folder prompt context
- `apps/gui/desktop/runtime/runtime-registry.cts` is either verified unused/legacy or receives the same managed-tool behavior
- TUI scope is documented: GUI-only MVP or explicitly wired TUI support

#### Backend smokes

- `read` returns expected lines and continuation hints with no bash fallback text
- `grep` invokes rg and respects `limit`, `glob`, `ignoreCase`, `literal`
- `find` respects configured hidden/ignore behavior and result limits
- symlink escape is rejected
- real server path is not leaked in output/errors
- VFS smokes skip cleanly when no VFS root is configured

## Open decisions

1. Endpoint placement.
   - Recommended: `/v1/vfs/*` under `OFFICE_AGENT_GATEWAY_URL` when it already points at `/v1`.
   - Alternative: explicit `OFFICE_AGENT_VFS_URL`.
2. Whether virtual roots are static client config or dynamically discovered from backend.
   - Decision: hardcoded root registry in code. The gateway returns only declared roots under `OFFICE_AGENT_VFS_BASE_DIR`.
3. Whether backend returns fully Pi-formatted text or structured results formatted by client.
   - Recommended MVP: structured backend results formatted by the client, so virtual prefix ownership stays client-side.
4. Whether `ls .` should always display virtual roots or only display them when backend is reachable.
   - Recommended: display configured roots; backend failure appears only when the root is accessed.
5. Whether artifact-only `settingsCwd` runtimes should receive virtual docs tools.
   - Current runtime-host path uses artifact tools instead of managed workspace tools when `settingsCwd` is set. Decide separately; MVP can target managed project sessions only.
6. Whether to add bash preflight blocking for reserved virtual URI prefixes.
   - Advisory notes are part of MVP; blocking is optional post-MVP hardening.
7. Scope of `apps/gui/desktop/runtime/runtime-registry.cts` and `apps/tui`.
   - Classify as legacy/out of scope or wire through the same managed tool factory before release.

## Recommended MVP checklist

- [ ] Choose endpoint placement: `/v1/vfs/*` or `OFFICE_AGENT_VFS_URL`.
- [ ] Add hardcoded virtual root mapping for `virtual://castrosua_iso -> /srv/officeagent/vfs/castrosua_iso`.
- [ ] Add VFS client and strict virtual URI parser.
- [ ] Add same-name dispatcher tools for `read`, `ls`, `find`, and `grep`.
- [ ] Add reserved-prefix guards for `edit` and `write`, including edit render/preview guard.
- [ ] Register `ls`, `find`, and `grep` in OfficeAgent managed custom tools.
- [ ] Refactor toward shared managed tool construction with injectable Pi factories.
- [ ] Reject or otherwise prevent user/base custom tools from shadowing reserved OfficeAgent tool names.
- [ ] Update both runtime paths or consolidate managed tool construction.
- [ ] Add prompt context explaining virtual folders, read-only behavior, and bash limitation in both runtime paths.
- [ ] Add bash advisory note when commands mention configured virtual URI prefixes.
- [ ] Implement backend `read`, `list`, `find`, and `grep` endpoints with bounded request bodies, auth, and sanitized errors.
- [ ] Ensure client-formatted remote `find`/`grep` outputs include `virtual://castrosua_iso/...` paths.
- [ ] Add unit tests and backend smoke tests.
