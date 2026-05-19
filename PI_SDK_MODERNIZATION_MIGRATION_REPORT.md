# Pi SDK Modernization Migration Report

Date: 2026-05-18  
Target Pi SDK: `@earendil-works/*@0.75.3`  
Current repo: `C:/Projects/office-gui-for-agentic-ai`

## Implementation status

Implemented in the current working tree. Active source/manifests now target `@earendil-works/*@0.75.3`; old `@mariozechner/pi-*` packages have been removed from npm/Bun locks. Remaining `@mariozechner/*` lock entries are Pi's optional clipboard package. The notes below are retained as migration rationale and review checklist.

Post-implementation fixes applied after review:

- Managed runtime now rebuilds per-session sandbox env/tools/prompt/resource options for each runtime replacement while preserving caller-provided settings managers for same-cwd sessions.
- Skill creator applies extension provider registrations before creating its session.
- `PI_PACKAGE_DIR` resolution no longer relies on non-exported `package.json` subpaths.
- Driver thinking-level clamp includes `minimal`.
- Runtime provider-registration failures are surfaced as extension diagnostics instead of crashing snapshots.
- Gateway default `gpt-5.5` route now targets upstream `gpt-5.5`.
- Node `>=22.19.0` engines were added for gateway, TUI, and driver workspaces.
- Headless GUI theme setup preserves custom/project/package theme registration via Pi's internal theme module until upstream exposes `setRegisteredThemes` publicly.
- Direct GUI/headless runtime session disposal now emits `session_shutdown` before invalidating the session.
- GUI helpers that flush extension provider registrations are centralized and append failures to extension load errors/diagnostics.

## Executive summary

This migration is more than a package rename. The pre-migration repository embedded several generations of Pi at once (`0.67.2` and `0.72.0`) under the deprecated `@mariozechner/*` scope. The modern published packages live under `@earendil-works/*`, with latest `0.75.3` and Node.js `>=22.19.0`.

The highest-risk areas were:

1. **SDK runtime/session embedding**: `packages/pi-sdk-driver/src/npm-package-fallback.ts` manually constructs `AgentSessionRuntime`; modern docs prefer `createAgentSessionRuntime()` with a factory, `createAgentSessionServices()`, and `createAgentSessionFromServices()`.
2. **Extension binding and session replacement**: modern `withSession` replacement callbacks require the host to rebind the replacement session before extension post-switch work runs. Current driver code syncs the host record only after `runtime.newSession()/fork()/switchSession()` resolves, which is too late for `withSession` unless `runtime.setRebindSession(...)` is used.
3. **Custom-tool activation**: modern Pi explicitly supports `noTools: "builtin"` to disable built-ins while keeping extension/custom tools active. Some managed runtime code still uses `tools: []` together with `customTools`, which disables the custom tools under modern semantics.
4. **Extension UI context shape**: the host `ExtensionUIContext` implementation is missing modern methods such as `setWorkingVisible`, `setWorkingIndicator`, `addAutocompleteProvider`, and `getEditorComponent`.
5. **Provider registration timing**: extension-registered providers are queued during extension loading and should be applied before model selection. `createAgentSessionServices()` handles this. Bare `createAgentSession()` with an already-loaded `ResourceLoader` can select a model before pending provider registrations are flushed.
6. **Dual package managers/locks**: root npm workspaces and `apps/gui` Bun lock both contain Pi packages and both must be updated coherently.

The implementation was done as a full-tree migration: `packages/pi-sdk-driver`, GUI runtime host/headless runtime, gateway/TUI, and lockfiles.

## Sources reviewed

Fetched upstream:

- Changelog: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md>
- SDK docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md>
- Extension docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- Settings docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md>
- Packages docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>
- Session format docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md>
- Models/custom provider docs: `docs/models.md`, `docs/custom-provider.md`, `docs/providers.md`

Local cache paths used:

- `C:\Users\Dario Costa\AppData\Local\pi-web-smart-fetch\github-cache\earendil-works\pi\packages\coding-agent\CHANGELOG.md`
- `C:\Users\Dario Costa\AppData\Local\pi-web-smart-fetch\github-cache\earendil-works\pi\packages\coding-agent\docs\sdk.md`
- `C:\Users\Dario Costa\AppData\Local\pi-web-smart-fetch\github-cache\earendil-works\pi\packages\coding-agent\docs\extensions.md`

Registry checks:

- `@earendil-works/pi-coding-agent@0.75.3` is current `latest`.
- `@mariozechner/pi-*` packages are deprecated and point users to `@earendil-works/*`.

Project files reviewed include package manifests, `packages/pi-sdk-driver/src/**`, `packages/office-agent-runtime/src/index.ts`, `apps/gui/desktop/runtime-host/**`, `apps/gui/desktop/runtime/**`, `apps/gateway/src/server.mjs`, and `apps/tui/scripts/run-tui.mjs`.

## Target package set

Use one pinned Pi version first:

```json
{
  "@earendil-works/pi-coding-agent": "0.75.3",
  "@earendil-works/pi-agent-core": "0.75.3",
  "@earendil-works/pi-ai": "0.75.3",
  "@earendil-works/pi-tui": "0.75.3"
}
```

Package details observed:

- `@earendil-works/pi-coding-agent@0.75.3`
  - engine: `node >=22.19.0`
  - depends on `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`, `jiti`, `undici@8`, etc.
- `@earendil-works/pi-agent-core@0.75.3`
  - engine: `node >=22.19.0`
  - depends on `@earendil-works/pi-ai`, `typebox`
- `@earendil-works/pi-ai@0.75.3`
  - engine: `node >=22.19.0`
  - dependencies changed versus older versions; notably uses `http-proxy-agent`/`https-proxy-agent`, not the previous `proxy-agent`/`undici@7` stack
- `@earendil-works/pi-tui@0.75.3`
  - engine: `node >=22.19.0`

`@mariozechner/clipboard` can remain as Pi's optional transitive dependency; it has not moved to `@earendil-works` in the target package metadata.

## Current dependency inventory

| Workspace / file | Current Pi dependencies | Notes |
|---|---:|---|
| `apps/gui/package.json` | `@mariozechner/pi-agent-core@0.72.0`, `@mariozechner/pi-ai@0.72.0`, `@mariozechner/pi-coding-agent@0.72.0`, `@mariozechner/pi-tui@0.72.0` | Main Electron GUI; also has `apps/gui/bun.lock`. |
| `packages/pi-sdk-driver/package.json` | `@mariozechner/pi-coding-agent@^0.67.2` | Driver boundary; highest SDK-risk area. |
| `apps/gateway/package.json` | `@mariozechner/pi-ai@0.67.2`, `@mariozechner/pi-coding-agent@0.67.2` | OpenAI-compatible gateway using `streamSimple`. |
| `apps/tui/package.json` | `@mariozechner/pi-coding-agent@0.67.2` | TUI wrapper script points directly at old package path. |
| `package-lock.json` | both `0.67.2` and `0.72.0` trees | Must be regenerated after manifests change. |
| `apps/gui/bun.lock` | `0.72.0` Pi tree | Must be regenerated with Bun under `apps/gui`. |

## Static old-scope references found

These files contain direct `@mariozechner/*` or old package-path references and need migration. Planning docs are historical and should not drive requirements, but they may be updated for clarity if desired.

### Manifests and lockfiles

- `package-lock.json`
- `apps/gui/bun.lock`
- `apps/gui/package.json`
- `apps/gateway/package.json`
- `apps/tui/package.json`
- `packages/pi-sdk-driver/package.json`

### Runtime/source files

- `apps/gateway/scripts/probe-pi-auth.mjs`
- `apps/gateway/src/server.mjs`
- `apps/tui/scripts/run-tui.mjs`
- `apps/gui/desktop/office-agent-runtime.cts`
- `apps/gui/desktop/pi-module.cts`
- `apps/gui/desktop/runtime/artifact-tools.cts`
- `apps/gui/desktop/runtime/agent-session-extensions.cts`
- `apps/gui/desktop/runtime/composer-state.cts`
- `apps/gui/desktop/runtime/headless-pi-theme.cts`
- `apps/gui/desktop/runtime/isolated-settings-manager.cts`
- `apps/gui/desktop/runtime/thread-publisher.cts`
- `apps/gui/desktop/runtime/types.cts`
- `apps/gui/desktop/runtime-host/git-commit-message-service.cts`
- `apps/gui/desktop/runtime-host/live-thread-publisher.cts`
- `apps/gui/desktop/runtime-host/live-tool-progress.cts`
- `apps/gui/desktop/runtime-host/skill-creator-service.cts`
- `apps/gui/shared/pi-message-mapper.ts`
- `apps/gui/shared/thread-data.ts`
- `apps/gui/shared/thread-history.ts`
- `apps/gui/src/electron/main/runtime/environment.ts`
- `apps/gui/src/test/pi-runtime-boundary.test.ts`
- `packages/office-agent-runtime/src/index.ts`
- `packages/pi-sdk-driver/src/npm-package-fallback.ts`
- `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`
- `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
- `packages/pi-sdk-driver/src/runtime-deps.ts`
- `packages/pi-sdk-driver/src/runtime-supervisor.ts`
- `packages/pi-sdk-driver/src/session-supervisor-utils.ts`
- `packages/pi-sdk-driver/src/session-supervisor.ts`
- `packages/pi-sdk-driver/src/thread-title-generator.ts`
- `packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts`

### Historical docs with old scope

- `docs/planning/broad_initial_ideas.md`
- `docs/planning/sandboxing-notes.md`

## Relevant upstream changes since the repo's current versions

### From `0.72.0` GUI baseline to `0.75.3`

- `0.75.0`: Node.js minimum is now `22.19.0`.
- `0.74.0`: package/repository references moved to `earendil-works/pi` and `@earendil-works/*` package scopes.
- `0.73.1`: extension loading switched to upstream `jiti@2.7`; `models.json` allows comments/trailing commas.
- `0.73.0`: bash output streams incrementally while commands run.
- `0.73.0`: Xiaomi provider behavior changed; likely not relevant unless user auth/models use Xiaomi.

### From `0.67.2` driver/gateway/TUI baseline to `0.75.3`

Everything above, plus:

- `0.72.0`: `compat.reasoningEffortMap` replaced by model-level `thinkingLevelMap`. No direct `reasoningEffortMap` usage was found in repo code.
- `0.71.0`: built-in Google Gemini CLI and Google Antigravity providers were removed. No direct usage found.
- `0.70.0`: `createAgentSession({ noTools: "builtin" })` is the supported way to disable built-in tools while keeping custom/extension tools active.
- `0.70.0`: OSC 9;4 terminal progress is opt-in.
- `0.69.0`: TypeBox migration to `typebox` 1.x. Extension/SDK code should import `Type` from `typebox`, not `@sinclair/typebox`.
- `0.69.0`: session replacement invalidates captured old extension `pi`/`ctx`; post-replacement work must use `withSession`.
- `0.65.0`: major `Agent`/`AgentState` reshaping. The app mostly uses `AgentSession`, not low-level mutator methods, so impact appears limited.

## Detailed observations by subsystem

### 1. Package-scope migration

All source imports should move from:

```ts
@mariozechner/pi-coding-agent
@mariozechner/pi-agent-core
@mariozechner/pi-ai
@mariozechner/pi-tui
```

to:

```ts
@earendil-works/pi-coding-agent
@earendil-works/pi-agent-core
@earendil-works/pi-ai
@earendil-works/pi-tui
```

Important non-obvious spots:

- `packages/office-agent-runtime/src/index.ts` generates a provider extension string that imports `ExtensionAPI` from the old scope. This must change or the generated `castrosua-ia-provider.ts` extension will fail at runtime after old packages are removed.
- `apps/gui/desktop/runtime/headless-pi-theme.cts` hardcodes `node_modules/@mariozechner/pi-coding-agent` and uses `import.meta.resolve("@mariozechner/pi-coding-agent")`.
- `apps/gui/src/electron/main/runtime/environment.ts` sets `PI_PACKAGE_DIR` using `require.resolve("@mariozechner/pi-coding-agent/package.json")`.
- `apps/gui/src/test/pi-runtime-boundary.test.ts` forbids direct Pi runtime imports outside runtime-host files; add the new `@earendil-works/pi-*` prefix while keeping the old `@mariozechner/pi-*` prefix forbidden too.
- `apps/tui/package.json` script points at `./node_modules/@mariozechner/pi-coding-agent/dist/cli.js`; update or prefer the existing `scripts/run-tui.mjs` resolver path after it is migrated.

### 2. Lockfiles and install tooling

This repo uses both npm workspaces and Bun under `apps/gui`.

Migration should update:

1. root/workspace manifests and `package-lock.json`, using npm
2. `apps/gui/package.json` and `apps/gui/bun.lock`, using Bun from `apps/gui`

Do not manually patch lockfiles except as an emergency. Regenerate them with the relevant package manager.

Potential dependency cleanup after lock regeneration:

- old `@mariozechner/pi-*` packages should disappear, except `@mariozechner/clipboard` may remain as Pi's optional dependency
- old `@mariozechner/jiti` should be replaced by upstream `jiti`
- old `@sinclair/typebox` should disappear from Pi dependency chains; `typebox` remains
- `undici@7` Pi entries should be replaced by Pi's current `undici@8` where applicable

### 3. `packages/pi-sdk-driver`: SDK runtime boundary

`packages/pi-sdk-driver` is the best first migration slice because it encapsulates the SDK-facing behavior.

Current risky file: `packages/pi-sdk-driver/src/npm-package-fallback.ts`.

Current behavior:

- calls `createAgentSessionWithNpmFallback(options)` for the initial session
- manually constructs `new AgentSessionRuntime(...)`
- synthesizes `AgentSessionServices` from `session` fields
- creates replacement sessions by calling `createAgentSessionWithNpmFallback(...)`

Modern docs recommend:

```ts
createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager,
});
```

where `createRuntime` calls:

```ts
const services = await createAgentSessionServices({ cwd, agentDir, ... });
return {
  ...(await createAgentSessionFromServices({ services, sessionManager, ... })),
  services,
  diagnostics: services.diagnostics,
};
```

Why this matters:

- `createAgentSessionServices()` applies extension-registered provider registrations before model resolution.
- runtime diagnostics are produced consistently.
- cwd-bound services are recreated using the same path as Pi's own interactive/print/RPC modes.
- future `AgentSessionRuntime` constructor changes are avoided.

Recommendation:

- Refactor `createAgentSessionRuntimeWithNpmFallback()` to wrap the modern factory API.
- Preserve the existing npm-package fallback behavior by applying it inside service creation/resource loading.
- Keep the driver as a thin compatibility layer over Pi behavior per `packages/pi-sdk-driver/AGENTS.md`.

### 4. Provider registration timing

Modern extension factories can call `pi.registerProvider()` during extension load. These registrations are queued in the extension runtime until they are flushed into `ModelRegistry`.

Observed code that already handles this correctly:

- `packages/pi-sdk-driver/src/runtime-supervisor.ts` has `applyPendingProviderRegistrations(...)` after `resourceLoader.reload()`.

Observed code that may select a model before provider registrations are applied:

- `packages/pi-sdk-driver/src/npm-package-fallback.ts` via direct `createAgentSession(...)`
- `apps/gui/desktop/runtime-host/live-runtime-registry.cts` via direct `createAgentSession(...)`
- `apps/gui/desktop/runtime/runtime-registry.cts` via direct `createAgentSession(...)`
- `apps/gui/desktop/runtime/composer-state.cts` snapshot sessions via direct `createAgentSession(...)`
- `apps/gui/desktop/runtime-host/skill-creator-service.cts` via direct `createAgentSession(...)`

For OfficeAgent's built-in provider, this is especially important because the provider is contributed by a generated extension in `agentDir/extensions/castrosua-ia-provider.ts`.

If model selection depends on that provider being present before session creation, prefer `createAgentSessionServices()` + `createAgentSessionFromServices()`, or explicitly apply pending provider registrations after resource loading and before choosing a model.

### 5. Managed runtime custom tools: `tools: []` vs `noTools: "builtin"`

Modern Pi semantics:

- `tools: [...]` is an allowlist. If `tools: []`, no built-in, extension, or SDK custom tools are enabled.
- `noTools: "all"` disables all tools.
- `noTools: "builtin"` disables default built-ins while keeping extension/custom tools active.

Observed risky code:

- `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`
  - builds sandboxed `customTools` for `read`, `bash`, `edit`, `write`
  - then passes `tools: []`
  - under modern behavior this can filter out the custom tools too

Observed better code:

- `apps/gui/desktop/runtime-host/live-runtime-registry.cts` uses `noTools: "builtin"` with `customTools`.

Recommendation:

- In managed runtimes that replace built-in tools with sandboxed custom tool definitions, use:

```ts
noTools: "builtin",
customTools,
```

not `tools: []`.

Keep `tools: []` only for sessions that truly need no tools, such as thread-title generation and git commit message generation.

### 6. Extension UI context gaps

Modern `ExtensionUIContext` includes methods that the driver host implementation does not currently provide.

Missing in `packages/pi-sdk-driver/src/session-supervisor.ts#createExtensionUiContext(...)`:

- `setWorkingVisible(visible: boolean)`
- `setWorkingIndicator(options?: WorkingIndicatorOptions)`
- `addAutocompleteProvider(factory)`
- `getEditorComponent()`

Likely also worth reviewing:

- `setWidget(...)` overload accepts component factories; the current host only handles `undefined` or string arrays. That is acceptable if intentionally unsupported, but should be explicit.
- `custom(...)` throws a typed unsupported-host error, which is a good pattern for unsupported arbitrary TUI components.
- `setEditorComponent(...)` is a no-op; modern docs also expose `getEditorComponent()`, which should return `undefined` if unsupported.

Recommendation:

- Add no-op/unsupported implementations for the missing methods to keep the host compatible.
- Consider surfacing `setWorkingMessage`, `setWorkingVisible`, and `setWorkingIndicator` through the desktop UI later, but no-op is a safe first migration.

### 7. Session replacement and `withSession`

Modern extension session replacement has important semantics:

- `ctx.newSession({ withSession })`
- `ctx.fork(entryId, { withSession })`
- `ctx.switchSession(path, { withSession })`

`withSession` must run against the replacement session after the host has rebound subscriptions/UI/extension bindings. Pi provides `AgentSessionRuntime.setRebindSession(...)` for this.

Observed issues in `packages/pi-sdk-driver/src/session-supervisor.ts`:

- `createCommandContextActions().newSession(options)` passes options through to `runtime.newSession(options)`, but the host rebind currently happens after the runtime method returns via `syncRecordAfterRuntimeTransition(...)`. If an extension provided `withSession`, that callback may run before the desktop driver has rebound the new session unless `runtime.setRebindSession(...)` is configured.
- `fork(entryId)` ignores the modern `options` argument entirely, so `position: "at"` and `withSession` are lost.
- `switchSession(sessionPath)` ignores the modern `options` argument, so `withSession` is lost.

Recommendation:

- After creating/binding a runtime, set:

```ts
runtime.setRebindSession(async (session) => {
  attachSessionSubscription(record, session);
  await bindSessionRuntime(record);
  await syncRecordAfterSessionMutation(record, { emitUpdate: true });
});
```

- Update command actions to forward options:

```ts
fork: async (entryId, options) => runtime.fork(entryId, options)
switchSession: async (sessionPath, options) => runtime.switchSession(sessionPath, options)
```

- Avoid double-rebinding after replacement; if `setRebindSession` does the binding, `syncRecordAfterRuntimeTransition` should not repeat it unnecessarily.

### 8. Extension command monkey-patching in GUI headless runtime

`apps/gui/desktop/runtime/agent-session-extensions.cts` monkey-patches:

- `session.extensionRunner.emitContext`
- `session.extensionRunner.getCommand`

This is intentionally internal/fragile. It should still work with the modern runner shape, but should be validated after the package update. Risks:

- Reload creates a new runner; the code uses WeakSets keyed by runner and refreshes bindings, which is good.
- Session replacement can create a new session/runner; the headless GUI command context cancels new-session/fork/switch, so replacement is mostly avoided in this path.
- Modern stale-context errors after reload/session replacement are stricter; extension command code should not use old `ctx` after `ctx.reload()`.

### 9. Tool execution updates and incremental bash output

Modern Pi streams bash tool output incrementally. Built-in bash now calls `onUpdate({ content: [...], details: ... })` while the command runs.

Observed handling:

- `apps/gui/desktop/runtime-host/live-runtime-registry.cts` and `apps/gui/desktop/runtime/runtime-registry.cts` store object `partialResult` and publish live tool progress. This looks compatible.
- `packages/pi-sdk-driver/src/session-supervisor.ts#mapAgentEvent(...)` only forwards `tool_execution_update.partialResult` when it is a `string` or `number`. Modern built-in updates are object-shaped, so desktop consumers using `SessionSupervisor` may miss incremental tool text.

Recommendation:

- Update driver event mapping to handle `partialResult.content` when object-shaped.
- Keep number progress handling for custom tools that emit numeric progress.

### 10. Custom tool schemas and TypeBox

Modern docs recommend TypeBox v1:

```ts
import { Type } from "typebox";
```

Observed custom tools:

- `apps/gui/desktop/runtime/artifact-tools.cts` uses plain JSON-schema-like objects typed as `ToolDefinition[]`.
- Managed tools use Pi factory functions (`createReadToolDefinition`, `createBashToolDefinition`, etc.), so they are fine.

Plain JSON schemas may continue to be structurally accepted depending on the `typebox` typings, but TypeBox-native schemas are safer for modern validation and eval-restricted runtimes.

Recommendation:

- If typecheck fails or validation behaves oddly, migrate artifact tool schemas to `Type.Object(...)`, `Type.String(...)`, `Type.Array(...)`, etc.
- If importing `Type` directly from app code, add `typebox` as a direct dependency of `apps/gui` rather than relying on Pi's transitive dependency.

### 11. Theme module access

`apps/gui/desktop/runtime/headless-pi-theme.cts` currently locates Pi's internal theme module by package root and imports:

```txt
dist/modes/interactive/theme/theme.js
```

Modern `@earendil-works/pi-coding-agent` re-exports theme utilities from the main entry point, including `initTheme` and `Theme` helpers.

Recommendation:

- First migration: update hardcoded package scope/path to `@earendil-works`.
- Better cleanup: use the main Pi module exports from `getPiModule()` if practical, reducing reliance on internal `dist/...` paths.

### 12. Settings and session dirs

Modern Pi recognizes:

- `PI_CODING_AGENT_DIR` for agent config dir (same as current code expects)
- `PI_CODING_AGENT_SESSION_DIR` for session dir override
- `SettingsManager.flush()` for durability after async writes
- `SettingsManager.reload()` is now asynchronous in the `0.75.3` declarations; await it before rebuilding snapshots or reloading resources

The current OfficeAgent managed paths remain conceptually valid:

- config/auth/settings under `%LOCALAPPDATA%\OfficeAgent\pi-agent`
- managed project/session data under `%LOCALAPPDATA%\OfficeAgent\AgentData`

Potential cleanup:

- Consider using `PI_CODING_AGENT_SESSION_DIR` in managed runtime paths where appropriate instead of only explicit `SessionManager.create(cwd, sessionDir)`.
- Keep explicit session dirs where per-workspace isolation is required.
- Update un-awaited calls in `packages/pi-sdk-driver/src/runtime-supervisor.ts` (`refreshRuntime`, project default model/thinking/pattern setters) to `await context.settingsManager.reload()` so settings changes are visible before snapshots are returned.

### 13. Gateway impact

`apps/gateway/src/server.mjs` uses:

- `AuthStorage`
- `ModelRegistry`
- `streamSimple` from Pi AI

Modern `streamSimple(model, context, options)` still accepts:

- `apiKey`
- `headers`
- `maxTokens`
- `temperature`
- `reasoning`
- `sessionId`

The configured default routes still exist in modern generated metadata:

- `openai-codex/gpt-5.3-codex-spark`
- `openai-codex/gpt-5.4`
- `openai-codex/gpt-5.5`

Observations:

- Scope rename should be the main gateway change.
- Gateway should be smoke-tested with both abstract routes (`assistant`, `gpt-5.5`) after update because provider metadata and Codex transport behavior changed between versions.

### 14. TUI wrapper impact

`apps/tui/scripts/run-tui.mjs` resolves the Pi main module and runs `dist/cli.js`. This should continue to work after scope change.

Update:

- package dependency to `@earendil-works/pi-coding-agent@0.75.3`
- `import.meta.resolve("@earendil-works/pi-coding-agent")`
- package script path if still direct

### 15. Electron packaging impact

`apps/gui/scripts/build-electron-runtime.ts` uses Bun build with `packages: "external"`. Therefore runtime dependencies must exist in packaged `node_modules`.

Check after lock regeneration:

- packaged app includes `@earendil-works/pi-coding-agent` and its dependencies
- `PI_PACKAGE_DIR` points to the new package directory
- no code path expects the old `node_modules/@mariozechner/pi-coding-agent` directory

`electron-builder.yml` includes broad `node_modules` patterns for native binaries, but Pi package inclusion depends on normal dependency installation.

## Proposed migration phases

### Phase 0: preparation

- Keep this report as the migration checklist.
- Avoid treating `docs/planning/**` as active requirements unless cross-checked with code.
- Confirm runtime Node/Electron environment satisfies `node >=22.19.0`; `apps/gui/package.json` already declares `>=24.15.0`.

### Phase 1: package manifests and import scope

- Update package manifests to `@earendil-works/*@0.75.3`.
- Update all source imports and dynamic resolvers.
- Update generated OfficeAgent provider extension import string.
- Update runtime boundary test forbidden prefix.
- Do not replace `@mariozechner/clipboard` if it appears as Pi optional transitive dependency.

### Phase 2: driver SDK modernization

- Refactor `packages/pi-sdk-driver/src/npm-package-fallback.ts` around `createAgentSessionRuntime()` factory style.
- Use `createAgentSessionServices()` / `createAgentSessionFromServices()` to preserve provider-registration timing.
- Preserve npm-package-source fallback behavior.
- Update `SessionSupervisor` command actions for modern replacement options.
- Use `runtime.setRebindSession(...)` so `withSession` callbacks run after host rebinding.
- Add missing `ExtensionUIContext` methods.
- Update `tool_execution_update` mapping for object-shaped partial tool results.
- Replace managed `tools: [] + customTools` with `noTools: "builtin" + customTools`.

### Phase 3: GUI runtime host and headless runtime

- Update dynamic imports and type imports.
- Review all direct `createAgentSession(...)` calls that use a loaded `DefaultResourceLoader` and depend on extension-registered providers.
- Update `headless-pi-theme.cts` package resolution, ideally to use main exports instead of internal `dist` paths.
- Validate extension command discovery and slash-command mapping with modern `pi.getCommands()` shape if refactoring becomes possible.

### Phase 4: gateway and TUI

- Update gateway imports/package deps.
- Smoke test routed model lookup and streaming chunks.
- Update TUI resolver/package script.

### Phase 5: lockfiles

- Regenerate root `package-lock.json` using npm after workspace manifest updates.
- Regenerate `apps/gui/bun.lock` using Bun from `apps/gui`.
- Verify old Pi packages are gone from direct dependencies and lockfiles, except optional `@mariozechner/clipboard` if pulled by Pi.

### Phase 6: validation/smoke plan

Recommended checks after migration (respecting `apps/gui/AGENTS.md`: GUI typechecks/tests should be run by the developer/CI or only when explicitly authorized):

- `npm run build --workspace @pi-gui/pi-sdk-driver`
- GUI web/desktop/electron typechecks
- gateway auth probe and a mock/real streaming request
- TUI launch with managed env
- GUI managed session creation
- prompt send and assistant stream
- read/bash/edit/write sandbox tool execution
- incremental bash output display
- stop/abort while streaming
- queued steering/follow-up messages
- reload settings while idle and while busy
- session close/reopen/resume
- slash command discovery including extension commands, prompts, skills
- extension UI requests: notify/status/widget/dialogs
- model switching and thinking-level changes
- gateway provider registration from generated OfficeAgent extension

## Specific high-priority fix list

1. **Generated provider extension import**
   - File: `packages/office-agent-runtime/src/index.ts`
   - Change old type import in `OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE`.

2. **Runtime factory modernization**
   - File: `packages/pi-sdk-driver/src/npm-package-fallback.ts`
   - Replace manual `new AgentSessionRuntime(...)` flow with modern factory helpers.

3. **Managed tool activation**
   - File: `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`
   - Change `tools: []` to `noTools: "builtin"` when passing sandbox custom tools.

4. **Replacement rebind/options**
   - File: `packages/pi-sdk-driver/src/session-supervisor.ts`
   - Add `runtime.setRebindSession(...)` and forward `fork`/`switchSession` options.

5. **Extension UI context methods**
   - File: `packages/pi-sdk-driver/src/session-supervisor.ts`
   - Add missing modern methods as no-ops or unsupported-host behavior.

6. **Partial tool update mapping**
   - File: `packages/pi-sdk-driver/src/session-supervisor.ts`
   - Map object-shaped `partialResult.content` to driver `toolUpdated` text/content.

7. **Hardcoded package paths/resolvers**
   - Files:
     - `apps/gui/desktop/runtime/headless-pi-theme.cts`
     - `apps/gui/src/electron/main/runtime/environment.ts`
     - `apps/tui/scripts/run-tui.mjs`
     - `apps/tui/package.json`

8. **Boundary test update**
   - File: `apps/gui/src/test/pi-runtime-boundary.test.ts`
   - Add forbidden runtime package prefix `@earendil-works/pi-`; keep `@mariozechner/pi-` forbidden too.

9. **Async settings reloads**
   - File: `packages/pi-sdk-driver/src/runtime-supervisor.ts`
   - Await modern `SettingsManager.reload()` calls before resource reloads/snapshots.

## Open questions / decisions before implementation

1. Should `packages/pi-sdk-driver` continue to provide the npm-package fallback now that modern Pi installs user npm packages under `~/.pi/agent/npm/` instead of global npm roots? It can be kept for safety, but may be less necessary.
2. Should GUI runtime-host direct `createAgentSession(...)` calls be fully migrated to `createAgentSessionServices()` too, or is applying pending provider registrations enough for those paths?
3. Should artifact tool schemas be converted to TypeBox now, or only if modern typecheck/validation requires it?
4. Should `headless-pi-theme.cts` keep importing Pi internals, or move to public main exports?
5. Should duplicate runtime implementations under `apps/gui/desktop/runtime/**` and `apps/gui/desktop/runtime-host/**` both be maintained, or can older local runtime code be retired later?

## Overall risk assessment

| Area | Risk | Reason |
|---|---:|---|
| Package scope/import rename | Medium | Many files and lockfiles; mostly mechanical but dynamic/generated imports are easy to miss. |
| `pi-sdk-driver` runtime factory | High | Session replacement, provider registration timing, diagnostics, and cwd-bound services all depend on this. |
| Managed sandbox tools | High | `tools: []` can accidentally disable all custom sandbox tools under modern semantics. |
| Extension UI host | Medium | Missing methods cause type/runtime incompatibilities with newer extensions. |
| Gateway | Low/Medium | API appears compatible, but provider metadata/auth/transport changed across versions. |
| TUI wrapper | Low | Mainly resolver/package path update. |
| GUI packaging | Medium | Externalized runtime dependencies require correct installed package tree. |
| Historical docs | Low | Do not treat planning docs as requirements. |

## Recommended first implementation slice

Start with `packages/pi-sdk-driver`:

1. Update package scope in `packages/pi-sdk-driver/package.json` and `src/**`.
2. Refactor `npm-package-fallback.ts` to modern runtime factory style.
3. Fix `office-agent-managed-runtime.ts` tool activation.
4. Fix `SessionSupervisor` extension UI context and session replacement option forwarding.
5. Build/check the driver.

Then migrate `apps/gui`, because it has many source imports but the active runtime-host path already uses some modern patterns (`noTools: "builtin"`, object-shaped tool progress). Finally migrate gateway and TUI.
