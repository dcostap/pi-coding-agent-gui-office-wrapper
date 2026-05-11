# Windows sandbox redesign: Codex-aligned implementation plan

Date: 2026-05-08

## Pre-implementation clarifications

These decisions are locked before starting the redesign:

- **Initial implementation slice:** start with Phase 0/1 foundations and setup/reset infrastructure first. Design the module boundaries for Phase 2 command launch, but do not blur the review boundary by mixing setup provisioning with full command execution before setup is testable.
- **UAC handoff boundary:** implementation should reach a clear point where the unelevated code can prepare/validate the setup payload and then asks the user/developer to approve the real elevated setup step. After that UAC step has run, non-elevated readiness, secret loading, and later command-launch work can be tested repeatedly.
- **Rust layout:** keep the work inside `native/windows-sandbox-helper`, with shared modules and multiple binary targets for the helper, setup helper, and command runner unless a later concrete build issue forces a split.
- **Account and group names:** use `OfficeAgentSandbox` and `OfficeAgentSandboxUsers`.
- **Managed-root policy:** v2 must hard-reject managed GUI `projectRoot` values outside `%LOCALAPPDATA%\OfficeAgent\AgentData`. If existing TypeScript/runtime callers violate this, fix the caller instead of weakening native validation.
- **Fallback policy:** no silent product fallback to the legacy backend. Temporary dev-only escape hatches may exist during construction, but product behavior must surface setup-required/error states.
- **Standard-user UAC:** support the case where UAC is approved by a different administrator account for an intended standard OfficeAgent user from the start. Payloads, ACLs, secret ACLs, and marker data must be designed around intended-real-user SID handling.
- **Attribution:** use the existing third-party notice/attribution location for copied or closely adapted Codex Apache-2.0 code.
- **Elevated testing:** do not rely on finicky automated elevated/admin tests. Prefer unit/non-elevated tests plus explicit manual/dev commands for setup/reset verification.
- **Reset entry point:** add an elevated, idempotent reset/remove action for the whole Windows sandbox setup so clean-slate setup can be tested repeatedly.

## Decision

OfficeAgent should pivot the Windows sandbox from the current write-restricted-token-only model to a Codex-aligned sandbox architecture.

The local Codex reference checkout is available at:

```text
C:\Projects\codex\codex-rs\windows-sandbox-rs
```

During implementation, use that codebase as the primary working reference. Read the relevant Codex modules before implementing each OfficeAgent module, adapt the proven Windows patterns, and document any copied/closely adapted code for Apache-2.0 attribution.

This means we keep OfficeAgent-specific runtime layout, project state, GUI integration, and helper protocol, but copy the Windows sandbox design patterns that Codex has already validated:

- one-time elevated setup
- dedicated local sandbox user
- generated passwords, not user-supplied passwords
- DPAPI-encrypted credential storage
- hidden sandbox account
- explicit setup marker/readiness state
- capability SIDs and explicit ACL grants
- a command-runner process launched as the sandbox user
- a restricted token for the actual command
- job-object process tree cleanup

The current `OFFICE_AGENT_SANDBOX_IDENTITY_MODE=logon-user` spike should be treated as a temporary proof-of-concept only. It is useful for validating identity semantics, but the productized implementation should not store passwords in environment variables and should not require the user to manually manage sandbox account credentials.

## Why this refactor is needed

The current helper mostly works as write containment, but its identity model is fragile for package managers and developer tools.

Current model:

```text
real interactive user token
+ Windows WRITE_RESTRICTED token
+ OfficeAgent synthetic restricting SID
+ inheritable ACL grants on writable roots
```

Problem:

- a tool can create a child directory/file with an explicit owner-private DACL
- inherited OfficeAgent restricting-SID ACEs can be omitted
- the restricted token then locks itself out of its own temp/cache/unpack files
- Python/pip exposed this failure mode

Codex's stronger Windows model avoids this by making the sandbox execution identity a real Windows account. Files created by tools are owned by the same sandbox identity that later needs to use them.

Target model:

```text
one-time elevated setup provisions sandbox identities and ACL baseline
runtime logs on dedicated sandbox user
command runner starts under sandbox user
runner creates restricted/capability token
actual command runs with explicit allowed write roots and job cleanup
```

## Codex pieces to adapt

Reference source areas in the local Codex repository (`C:\Projects\codex\codex-rs\windows-sandbox-rs`):

- `src/setup_orchestrator.rs`
- `src/setup_main_win.rs`
- `src/sandbox_users.rs`
- `src/identity.rs`
- `src/dpapi.rs`
- `src/cap.rs`
- `src/hide_users.rs`
- `src/command_runner_win.rs`
- `src/elevated_impl.rs`
- `src/token.rs`
- `src/process.rs`
- `src/path_normalization.rs`
- `src/setup_error.rs`
- `src/acl.rs`
- `src/winutil.rs`
- `src/read_acl_mutex.rs`
- `src/cwd_junction.rs`
- `sandbox_smoketests.py`

If code is copied or closely adapted, add the required Apache-2.0 attribution/notice updates.

## Codex alignment and intentional deviations

Heavy inspiration / likely close adaptation:

- setup orchestration and setup helper split (`setup_orchestrator.rs`, `setup_main_win.rs`)
- generated local sandbox credentials (`sandbox_users.rs`)
- DPAPI machine-scope secret wrapping (`dpapi.rs`)
- readiness/identity loading (`identity.rs`)
- hidden sandbox user behavior (`hide_users.rs`)
- command runner shape (`elevated_impl.rs`, `command_runner_win.rs`)
- named-pipe stdio (`elevated_impl.rs`, `command_runner_win.rs`, `process.rs`)
- restricted/capability token construction (`token.rs`, `cap.rs`)
- ACL helpers and idempotent ACE checks (`acl.rs`)
- structured setup errors (`setup_error.rs`)

OfficeAgent deviations from Codex, and why:

- one sandbox user (`OfficeAgentSandbox`) instead of Codex's online/offline users, because OfficeAgent does not restrict network access
- no Windows Firewall rules, because network access is out of scope for this redesign
- managed AgentData-only initial workspace policy, because OfficeAgent GUI sessions are managed under `%LOCALAPPDATA%\OfficeAgent\AgentData`
- project-scoped package/tool state, because OfficeAgent wants packages/caches shared across sessions in the same project and isolated across projects
- no `.git` protection by default, because OfficeAgent coding workflows may legitimately need Git writes
- stronger path validation than Codex's minimal canonical path helper, because OfficeAgent applies durable ACLs under a strict managed-root invariant
- no product legacy fallback, because this is a refactor rather than a dual-backend rollout


## What OfficeAgent keeps/customizes

We should not blindly transplant Codex's entire product model. OfficeAgent keeps these customizations:

1. **Managed AgentData root**

   OfficeAgent data remains under:

   ```text
   %LOCALAPPDATA%\OfficeAgent\AgentData
   ```

2. **Project-scoped package/tool state**

   Keep the current runtime-state design:

   ```text
   <managed-root>\.officeagent\project-state\<project-key>\...
   <managed-root>\.officeagent\sessions\<session-id>\...
   ```

3. **Per-project package isolation**

   Python/pip/npm/uv cache and install locations remain per project, not global and not per session.

4. **Current Electron/Pi runtime integration, with native-owned sandbox side effects**

   JS/TS continues to build the high-level launch request and OfficeAgent runtime layout. Native Rust remains responsible for the OS boundary. For v2, helper operations that create command scripts, command-side compatibility files, request files, and other sandbox execution artifacts should move behind the v2 helper boundary or become v2-aware `fileWrite`/`mkdir` operations. Stdout/stderr should use Codex-style named pipes, not files. TS should not pre-create files that the sandbox user later needs before setup/readiness/ACL refresh has happened.

5. **Current file-tool path checks**

   Pi `read`/`write`/`edit` constraints are still enforced separately. The sandbox refactor is primarily for command execution.

6. **Relaxed initial read / non-managed-write model**

   The product goal is not full Windows read confinement. The initial v2 promise is: OfficeAgent should not grant or intentionally enable writes outside OfficeAgent-managed/approved roots, especially not to the real user's Desktop/Documents/profile or remote/mapped locations. Reads may follow normal Windows permissions. The dedicated sandbox user may still have its own default Windows profile/temp writes or other machine/share ACL-derived writes; that is acceptable for v2 as long as OfficeAgent does not add broad host or remote write grants and the managed project/tool-state hierarchy is protected.

   Stronger capability-only write confinement remains desirable, but the rollout can be more relaxed: launching as a dedicated sandbox user plus strict OfficeAgent ACL grants is useful before every incidental Windows-writable location is blocked.

7. **Portable app UX with optional one-time UAC**

   A portable Electron app can request elevation on first strong-sandbox setup. Normal launches should not need UAC.

8. **Explicit project-root policy**

   Current managed GUI sessions should keep project working directories under AgentData unless/until we intentionally support arbitrary external workspaces. If future OfficeAgent sessions work directly in `C:\Projects\...` or another user-chosen folder outside AgentData, v2 must treat that as a separate explicit trusted `projectRoot` with its own canonicalization and ACL rules. Do not accidentally broaden the current `managedRoot` invariant while porting Codex concepts.

## User/account naming

Use a clear OfficeAgent sandbox account name:

```text
OfficeAgentSandbox
```

Rationale:

- OfficeAgent does not implement Codex-style network restrictions, so separate online/offline identities are unnecessary
- makes admin-tool visibility understandable
- avoids user-supplied usernames/passwords

The user should be:

- local non-admin account
- random password
- password/account non-expiring, if needed for command launch reliability
- removed from Administrators if present
- members of a dedicated local group such as `OfficeAgentSandboxUsers`
- hidden from normal Winlogon user lists via `HKLM\...\Winlogon\SpecialAccounts\UserList`
- profile directories best-effort marked hidden/system after first creation

Admin tools such as `net user`, Computer Management, or direct registry inspection may still show the account. Normal users should not see it in routine app usage or login UI.

## Target on-disk layout

Under managed root:

```text
<managed-root>\.officeagent\sandbox\
  setup_marker.json
  logs\
  requests\
  cap_sid.json or cap_sid

<managed-root>\.officeagent\sandbox-secrets\
  sandbox_users.json
```

Suggested `sandbox_users.json` shape:

```json
{
  "version": 1,
  "user": {
    "username": "OfficeAgentSandbox",
    "password": "<base64 DPAPI machine-protected blob>"
  }
}
```

Use DPAPI machine scope, as Codex does, so elevated setup and non-elevated runtime can both decrypt. Because machine-scope DPAPI blobs may be decryptable by another local process that can read the blob, protect the secrets directory with ACLs so it is readable only by the intended real user/admin/system as appropriate, and not readable or writable by sandbox commands.

`setup_marker.json` should include at least:

```json
{
  "version": 1,
  "username": "OfficeAgentSandbox",
  "createdAt": "...",
  "helperVersion": "...",
  "readRoots": [],
  "writeRoots": []
}
```

The marker is not a security boundary. It is a readiness/diagnostic record.

## High-level architecture

```text
Electron / OfficeAgent runtime
  |
  | builds SandboxLaunchRequest
  v
office-agent-windows-sandbox-helper.exe
  |
  | if v2 enabled: ensure setup/readiness
  | if setup missing/outdated: run elevated setup helper
  v
office-agent-windows-sandbox-setup.exe  (UAC, setup/repair/reset only)
  |
  | provisions user/group/secrets/ACLs/capability SIDs
  v
helper decrypts sandbox credentials
  |
  | CreateProcessWithLogonW as OfficeAgentSandbox
  v
sandbox command runner process
  |
  | creates restricted/capability token
  | connects to Codex-style named pipes for stdin/stdout/stderr
  | creates/assigns job object
  v
actual shell/tool command
```

## Native components

### 1. Main helper

Current:

```text
native/windows-sandbox-helper
```

Keep this executable as the process invoked by the JS runtime.

Responsibilities:

- parse OfficeAgent JSON launch request
- canonicalize and validate paths under the v2 path policy
- validate paths are under managed root where required
- compute effective writable roots
- select the v2 backend, with any legacy/backend selector limited to temporary development use during the refactor
- ensure v2 setup is present and compatible
- resolve the intended real user SID before elevation
- invoke elevated setup helper when needed with the intended real user SID in the payload
- refresh ACLs for current roots without elevation when possible
- decrypt sandbox credentials
- launch command runner as sandbox user
- create named pipes for stdin/stdout/stderr using Codex-style pipe ACLs
- collect stdout/stderr/exit code/timeout through those pipes
- enforce job-object cleanup

### 2. Elevated setup helper

Add or split a second executable:

```text
office-agent-windows-sandbox-setup.exe
```

Responsibilities:

- run elevated only for setup/repair/reset
- expose an idempotent reset/remove action that can clean the v2 setup for repeated clean-slate testing
- create/update `OfficeAgentSandbox`
- create/update `OfficeAgentSandboxUsers` group
- generate random passwords
- store DPAPI machine-protected password blobs
- hide the sandbox user in Winlogon `SpecialAccounts\UserList`
- create and lock down `.officeagent\sandbox` and `.officeagent\sandbox-secrets`
- create/load capability SIDs
- apply the explicit ACL matrix to managed roots and requested writable roots
- honor the intended real user SID from the unelevated setup payload
- write setup marker and setup diagnostics
- on reset, remove the sandbox user/group, hidden-user registry value, setup marker/error/secrets/capability state, and known setup-owned metadata where safe

### 3. Command runner

Add or split a third executable:

```text
office-agent-command-runner.exe
```

Responsibilities:

- starts as `OfficeAgentSandbox`
- reads a request from a file or pipe under `.officeagent\sandbox\requests`
- creates the final restricted/capability token when that phase is enabled
- launches actual command with `CreateProcessAsUserW`
- connects stdio to Codex-style named pipes supplied by the parent helper
- assigns process tree to job object
- hides current sandbox user's profile dir best-effort
- reports status back to parent helper

This mirrors Codex's separation and avoids putting every operation in one process/token context.

## Runtime request contract changes

Extend the current helper protocol rather than replacing it all at once.

Add fields conceptually like:

```json
{
  "sandboxVersion": 2,
  "sandboxPolicy": "workspace-write",
  "projectKey": "...",
  "projectRoot": "...",
  "projectStateDir": "...",
  "sessionDir": "...",
  "writablePaths": [],
  "protectedPaths": [],
  "readRoots": []
}
```

Policy defaults:

- `sandboxPolicy`: `workspace-write`
- `writablePaths`: explicit only; no accidental host-write paths
- `protectedPaths`: deny writes to OfficeAgent control metadata and future project metadata
- helper/runtime-created command artifacts should either be included as explicit writable/readable roots or be created by the native helper/runner after v2 readiness has completed
- stdout/stderr are not file paths in v2; command output is captured through named pipes

Maintain backwards compatibility while v2 is behind a flag.

## Path validation and workspace root policy

The v2 helper must be stricter than the current `canonicalish()` helper in `native/windows-sandbox-helper/src/platform.rs`. That helper normalizes path components, but it does not fully resolve case, symlinks, junctions, or non-existing child paths. That is not enough once the helper is applying durable ACL grants. Codex's `path_normalization.rs` is a useful reference for canonical path keys, but OfficeAgent should implement the stronger rules below rather than treating `dunce::canonicalize(...).unwrap_or(path)` alone as sufficient.

Required path rules:

- canonicalize existing paths with Windows-aware canonicalization similar to Codex's `path_normalization.rs` (`dunce::canonicalize` style behavior)
- normalize case/separators for path keys and equality checks
- reject `..` traversal after normalization
- reject symlink/junction escapes for managed roots and writable roots unless a future policy explicitly allows a resolved external root
- for paths that do not exist yet, canonicalize the nearest existing parent, then validate the remaining relative suffix component-by-component
- keep all helper-created control paths under the canonical managed root
- log canonical and original paths in diagnostics so setup failures are debuggable

Initial product policy:

```text
managedRoot = %LOCALAPPDATA%\OfficeAgent\AgentData
projectRoot must be inside managedRoot for managed GUI sessions
projectStateDir must be inside managedRoot\.officeagent\project-state
sessionDir must be inside managedRoot\.officeagent\sessions
remote/mapped drive roots such as R:\, U:\, X:\, L:\, P:\ are not writable roots unless a future explicit user-approved external-workspace mode is added
```

If OfficeAgent later supports direct editing in arbitrary external folders, add a first-class `externalProjectRoot`/`workspaceRoot` concept. Do not fake it by weakening `managedRoot` checks.

## ACL model

The implementation needs a concrete ACL matrix before broad rollout. Initial target is pragmatic write containment for OfficeAgent-managed roots, not a claim that every incidental Windows-writable location for the sandbox account is blocked. OfficeAgent must avoid granting write access outside managed/approved roots and must protect real-user folders, remote/mapped locations, and OfficeAgent control/secrets metadata from command writes.

Initial target:

| Path | Real user | Administrators/SYSTEM | Sandbox group | Sandbox user | Capability SID | Notes |
|---|---:|---:|---:|---:|---:|---|
| `<managed-root>` | full | full | traverse/read as needed | traverse/read as needed | no broad write | Parent only; avoid granting blanket write to all control paths. |
| project root | full | full | read/traverse | read/write where policy allows | write/delete for workspace capability | Must be canonical and inside managed root initially. |
| project-state package dirs | full | full | read/traverse | read/write | write/delete | pip/npm/uv/Python state. |
| session `temp`/`profile`/`logs` | full | full | read/traverse | read/write | write/delete | Per-session ephemeral state. |
| stdio named pipes | n/a | n/a | connect as allowed by pipe ACL | connect as allowed by pipe ACL | no filesystem grant | Use Codex-style named pipes for stdin/stdout/stderr; no stdout/stderr files in v2. |
| `.officeagent\sandbox` | full | full | limited runner/request/log access | limited | no write capability by default | Control plane. Do not make it a general writable root. |
| `.officeagent\sandbox-secrets` | full for intended real user only | full | none | none | none | DPAPI blobs live here; sandbox commands must not access it. |
| other OfficeAgent runtime metadata | full | full | none/limited | none/limited | none | Protect command/control metadata from agent commands. |

Implementation notes:

- ACL grants must be idempotent and avoid duplicate ACE growth.
- Prefer allow ACEs on exact canonical roots rather than broad parent grants.
- Use deny/protective ACEs carefully for control/secrets dirs when they are nested under otherwise writable parents.
- Set the token default DACL, as the current helper already partially does, so child-created IPC/default objects remain usable by the sandbox token.
- Dedicated sandbox user identity is the primary fix for package-manager owner/private-DACL behavior. The restricted/capability token layer should be added after identity launch is reliable, but v2 rollout does not need to block every default writable location in the sandbox user's own profile before it is useful.
- Do not grant or refresh ACLs for remote/mapped drive roots or arbitrary host folders unless a future explicit external-workspace feature exists.
- Do not hard-code `.git` protection initially. Codex protects metadata such as `.git`, `.codex`, and `.agents`, but OfficeAgent coding workflows may legitimately need Git writes. Treat `.git` as a future policy option.

## Writable roots for OfficeAgent

For project `P` and session `S`, v2 writable roots should include:

```text
project root P
<managed-root>\.officeagent\project-state\<project-key>\cache
<managed-root>\.officeagent\project-state\<project-key>\config
<managed-root>\.officeagent\project-state\<project-key>\data
<managed-root>\.officeagent\project-state\<project-key>\tools
<managed-root>\.officeagent\project-state\<project-key>\bin
<managed-root>\.officeagent\project-state\<project-key>\python-user-base
<managed-root>\.officeagent\project-state\<project-key>\pip-cache
<managed-root>\.officeagent\project-state\<project-key>\npm-cache
<managed-root>\.officeagent\project-state\<project-key>\npm-prefix
<managed-root>\.officeagent\project-state\<project-key>\uv-cache
<managed-root>\.officeagent\project-state\<project-key>\uv-tools
<managed-root>\.officeagent\project-state\<project-key>\uv-tools-bin
<managed-root>\.officeagent\project-state\<project-key>\uv-python
<managed-root>\.officeagent\project-state\<project-key>\uv-python-bin
<managed-root>\.officeagent\sessions\<session-id>\profile
<managed-root>\.officeagent\sessions\<session-id>\temp
<managed-root>\.officeagent\sessions\<session-id>\logs
```

These roots should be passed explicitly from TS runtime to native helper. The native helper should canonicalize and verify every root using the path policy above. Command scripts, request files, and Python compatibility files should be created/opened through the v2 helper/runner after setup/readiness/ACL refresh, not directly by TS before the sandbox identity can access them. Stdout/stderr should be captured through named pipes, not filesystem log files.

Important: in the initial product policy, `project root P` means the canonical project directory managed under AgentData. If a future mode allows arbitrary external project roots, that mode needs an explicit request field, UI permission, setup ACL path, and regression tests for junction/symlink escapes.

## Protected paths

Even inside a writable root, some paths should be protected from direct command writes.

Initial list:

```text
<managed-root>\.officeagent\sandbox-secrets
<managed-root>\.officeagent\sandbox
<managed-root>\.officeagent\runtime metadata, where applicable
project .officeagent control paths, if introduced
```

Future policy may protect:

```text
.git
package-manager lock metadata only in certain modes
OfficeAgent project config
```

Do not overreach initially; protecting `.git` may break legitimate agent coding workflows. Treat that as a policy choice, not a hard-coded assumption.

## Standard-user UAC and intended real user

Setup may be elevated by the same Windows user, or by a different administrator account when the current user is a standard user. The elevated setup helper must configure the sandbox for the intended OfficeAgent user, not accidentally for the admin account that approved UAC.

Setup must also handle previous installs smoothly. The local sandbox account, group, DPAPI secrets, capability SID file, marker, ACLs, and hidden-user registry values may already exist from an earlier OfficeAgent version, a previous failed setup, or a developer run. Setup should be idempotent: detect compatible existing state, repair missing/outdated pieces, rotate/regenerate secrets only when needed, and avoid duplicating ACEs or prompting for UAC when non-elevated readiness/refresh is enough.

The unelevated helper should resolve and pass at least:

```text
realUserName
realUserSid
managedRoot
requested read/write roots
setup version
```

The elevated helper should validate the payload paths and ACL secrets/control paths for the intended real user SID, Administrators, and SYSTEM as required. Do not rely on `%USERNAME%` inside the elevated process to identify the OfficeAgent user. Because this process runs elevated, treat the payload as untrusted input: verify the canonical managed root, project root, session dir, project-state dir, and all writable/protected roots before applying ACLs. In particular, reject requests that would cause setup to grant writes to the real user's profile/Desktop/Documents, drive roots, remote/mapped roots, or symlink/junction escapes.

## Runner communication and stdio

OfficeAgent v2 should copy Codex's named-pipe stdio model instead of preserving the current stdout/stderr file-capture model.

OfficeAgent still needs stdout/stderr capture because command output is how the GUI/model receives tool results, and child command output must not corrupt the helper's JSON stdout protocol.

Target v2 stdio model:

```text
main helper, real user
  creates stdin/stdout/stderr named pipes with ACLs allowing sandbox user access
  launches command runner with pipe names in the request payload

command runner, OfficeAgentSandbox user
  connects to named pipes
  creates final command process with pipe handles as stdio

main helper
  reads stdout/stderr from pipes
  returns captured output/exit status to TS without filesystem log files
```

Codex reference areas:

- `src/elevated_impl.rs`: pipe name generation, named-pipe creation, runner launch, stdout/stderr reading
- `src/command_runner_win.rs`: runner connects to named pipes and passes handles to final command
- `src/process.rs`: `CreateProcessAsUserW` stdio handle setup

Rules:

- no stdout/stderr filesystem capture in v2
- do not pass command output through the helper JSON stdout stream except as structured response data
- pipe ACLs must allow the sandbox user/runner to connect without broadly weakening filesystem ACLs
- request files under `.officeagent\sandbox\requests` are still acceptable for runner payloads, following Codex's shape
- future streaming/PTY support should build on this pipe model rather than reintroducing stdout/stderr log files

## Setup/readiness flow

### First run with strong sandbox enabled

1. GUI or runtime requests command execution.
2. Helper sees v2 enabled.
3. Helper checks setup marker/secrets/user/capability SIDs.
4. If compatible existing setup is found, skip UAC and continue.
5. If setup is missing, incomplete, or outdated in a way that requires admin rights, helper triggers setup helper with `runas` / ShellExecute elevation.
6. User accepts UAC.
7. Setup helper provisions or repairs user, group, secrets, ACLs, marker, hidden-user registry values, and capability state idempotently.
8. Helper retries readiness check.
9. Command runs normally.

### Normal run

1. Helper checks marker and secrets.
2. Helper refreshes ACLs for current project/session roots as needed.
3. Helper creates/opens v2-owned command artifacts and request files as needed.
4. Helper creates Codex-style named pipes for stdin/stdout/stderr.
5. Helper decrypts selected sandbox password.
6. Helper launches command runner as sandbox user.
7. Command runner connects to named pipes and launches actual command, initially as the sandbox user and later with the restricted/capability token when Phase 3 is enabled.

### Setup failure

Create a structured setup error file under:

```text
<managed-root>\.officeagent\sandbox\setup_error.json
```

Surface a clear GUI message:

```text
Windows strong sandbox setup failed.
Reason: <specific setup step>
Action: Retry setup / Reset setup / Open logs
```

## Network policy

OfficeAgent does not limit network access in this redesign. Unlike Codex, do not create separate online/offline sandbox users and do not install Windows Firewall rules. The sandbox account uses normal network behavior for the machine/user context. Product UI and diagnostics must not claim offline/network confinement.

## Refactor posture and flags

This is a real refactor, not a long-term dual-backend rollout. The legacy write-restricted implementation and the env-password logon-user spike should be removed or reduced to short-lived development-only code as v2 lands. Do not design product behavior around silently falling back to the legacy sandbox.

Suggested temporary development flags/config:

```text
OFFICE_AGENT_WINDOWS_SANDBOX_SETUP=auto|never
OFFICE_AGENT_WINDOWS_SANDBOX_V2_DEV_BYPASS=0|1   # optional, local debugging only
```

Also provide an explicit elevated setup-helper action for clean-slate testing, for example:

```text
office-agent-windows-sandbox-setup.exe setup --payload <payload.json>
office-agent-windows-sandbox-setup.exe reset --payload <payload.json>
```

The reset action is a development/support entry point, requires elevation, and must be safe to run repeatedly.

If a temporary backend selector is needed while a branch is under construction, keep it explicitly internal/development-only and remove it before merging/productizing v2:

```text
OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND=legacy|codex-v2
```

Diagnostics should be explicit that network is not sandbox-restricted, for example:

```text
networkRestricted=false
```

The current env-password spike should be removed as part of the v2 refactor, not kept as a product fallback.

## Migration from current implementation

### Current assets to keep

- managed-root path validation
- project-state env routing
- session temp/log/profile layout
- stdout/stderr capture semantics, reimplemented with Codex-style named pipes
- job object cleanup
- timeout behavior
- JS helper-client launch integration
- existing smoke tests as baseline

### Current assets to replace or remove

- synthetic restricting SID as the primary identity model
- env-var stored logon user/password spike
- Python `sitecustomize.py` temp workaround, once v2 package-manager/private-DACL tests prove it is obsolete or a narrower v2-specific compatibility path replaces it
- any future tool-specific ACL repair hacks

### No product legacy fallback

If v2 setup is unavailable, declined, or broken, the GUI should surface a clear setup/error/retry state rather than silently falling back to the old sandbox behavior. Development builds may keep temporary escape hatches while implementation is incomplete, but those should not become product behavior.

## Implementation phases

### Phase 0: foundations, design hardening, and attribution

- finalize this plan
- use `OfficeAgentSandbox` and `OfficeAgentSandboxUsers` as the account/group names
- add third-party notice/attribution entries in the existing attribution location for copied or closely adapted Codex code
- implement v2 inside `native/windows-sandbox-helper` with shared modules and multiple binary targets unless a concrete build issue requires splitting crates
- decide UI wording for one-time UAC
- adapt or reimplement Codex-style path normalization before any durable ACL grants
- adapt setup error reporting and diagnostics
- adapt DPAPI wrapper
- adapt SID/user/group helper utilities
- define and test the ACL matrix before setup writes it broadly

Exit criteria:

- reviewed plan
- no ambiguity around setup UX or local sandbox account
- explicit project-root vs managed-root policy
- explicit path canonicalization/junction policy
- explicit ACL matrix
- explicit standard-user UAC real-user SID handling

### Phase 1: setup helper and secrets

Implement setup pieces without changing default command execution.

Tasks:

- add setup executable target
- add an elevated, idempotent reset/remove entry point for clean-slate testing and support
- receive and validate setup payload containing intended real user SID/name
- create/update local sandbox user
- create/update sandbox group
- detect existing compatible user/group/secrets/marker and reuse them when valid
- repair incomplete/outdated setup from earlier versions or failed runs
- generate random passwords only when creating/resetting the sandbox user or when stored credentials are missing/invalid
- DPAPI machine-protect passwords
- write/update `sandbox_users.json`
- write/update `setup_marker.json`
- hide sandbox user in Winlogon UserList
- hide profile dirs best-effort where possible
- add setup/disable/reset scripts for development
- reset removes, where present, the sandbox user, sandbox group, hidden-user registry value, setup marker/error files, secrets, capability SID state, and setup-owned metadata that is safe to delete
- add structured setup logs/errors
- verify all setup paths with the new canonicalization policy before applying ACLs
- make setup idempotent: no duplicate ACE growth, no unnecessary password rotation, no unnecessary UAC when existing setup is compatible

Tests:

- avoid finicky automated elevated/admin tests; use unit/non-elevated tests plus explicit manual/dev setup and reset commands
- manual setup verification creates the sandbox user with UAC approval
- second setup/readiness run detects existing compatible setup and does not require UAC
- setup repair handles missing marker with existing user/secrets
- setup repair handles existing user with missing/invalid secrets by resetting credentials through elevated repair
- secrets decrypt from non-elevated runtime
- sandbox user is non-admin
- sandbox user is hidden from Winlogon UserList registry
- disable/reset removes sandbox user, group, hidden-user registry value, setup marker/error files, secrets, capability state, and safe setup-owned metadata when requested
- reset is idempotent and can be run repeatedly to return to a clean slate for setup testing
- setup works when UAC is approved by the same admin user
- setup works when UAC is approved with a different admin account for a standard intended user

### Phase 2: v2 identity launch without final capability restrictions

Get reliable command launch as sandbox user first.

Tasks:

- helper loads setup credentials
- helper loads the sandbox user identity
- helper grants sandbox identity access to current writable roots using the ACL matrix
- helper launches runner with `CreateProcessWithLogonW`
- runner launches actual command
- move command-script/request creation behind the v2 helper boundary or make `fileWrite`/`mkdir` v2-aware
- implement Codex-style named pipes for stdin/stdout/stderr
- preserve stdout/stderr/exit/timeout behavior
- preserve job cleanup

Tests:

- `whoami` shows sandbox user
- command cwd works
- named-pipe stdout/stderr capture works
- timeout kills descendants
- write inside allowed roots succeeds
- obvious write outside managed root fails or is at least not granted by OfficeAgent ACLs
- real-user Desktop/Documents/profile paths are not granted by OfficeAgent and are not used as writable roots
- mapped/remote drive roots such as `R:\`, `U:\`, `X:\`, `L:\`, `P:\` are not granted by OfficeAgent and are not used as writable roots
- `managedRoot\allowed\junction -> C:\outside` is rejected or safely resolved according to policy

### Phase 3: restricted token + capability SIDs

Add the actual Codex-like restriction layer.

Tasks:

- persist global and per-workspace capability SIDs
- grant ACLs to sandbox group and relevant capability SIDs
- runner creates restricted token with capability SIDs
- actual command runs with `CreateProcessAsUserW`
- implement workspace-write policy
- keep relaxed read behavior initially unless/until read confinement is implemented
- protect `.officeagent\sandbox-secrets` and setup metadata from command reads/writes where practical; secrets must not be readable by sandbox commands
- treat launching as sandbox user as acceptable for early v2/package-manager validation, while still tracking restricted/capability token enforcement as the stronger long-term layer

Tests:

- allowed write roots work
- disallowed managed-root escape writes fail, or at minimum are not enabled by OfficeAgent ACL grants
- real-user Desktop/Documents/profile writes are not enabled by OfficeAgent
- mapped/remote roots are not enabled by OfficeAgent
- command-created owner-private child dirs remain usable
- no duplicate ACE growth across launches
- setup refresh updates roots for new projects/sessions
- secrets/control paths remain inaccessible to sandbox commands
- junction/symlink escape tests fail closed

### Phase 4: package-manager acceptance

Replace the Python-temp shim as a requirement with real sandbox semantics if the v2 identity/token model proves it is no longer needed. Until then, keep the shim for compatibility.

Tests:

1. `python -m pip install --user Pillow` in session A, import in session B, same project.
2. Pillow installed in project A is not visible in project B by default.
3. `python -m venv .venv && .venv\Scripts\python -m pip install Pillow` works.
4. `npm install` uses project npm cache.
5. `npm install -g <small-cli>` uses project npm prefix/bin.
6. `uv venv`, `uv pip install`, and `uv run python` work, or fail with clear unsupported diagnostics.
7. Two sessions in same project installing packages do not corrupt state.
8. Tool-created nested private DACL directories remain usable by later commands in the same project/session.

### Phase 5: GUI/productization

Tasks:

- add settings/status UI:
  - Strong Windows sandbox: Disabled / Setup required / Enabled / Error
  - Enable strong sandbox
  - Repair setup
  - Reset/remove sandbox user
  - Open logs
- show clear one-time UAC explanation
- package setup/runner/helper executables in portable Electron build
- handle app updates that require setup version migration

Proposed UI copy:

```text
OfficeAgent can enable a stronger Windows sandbox for agent commands. This creates a local non-admin OfficeAgent sandbox account and configures Windows permissions. You will see a one-time Windows UAC prompt. Normal app use will not require administrator access.
```

### Phase 6: remove transitional code

Before productizing v2:

- remove env-password logon-user spike
- remove the legacy write-restricted backend as a product path
- remove temporary backend selector flags used only during the refactor
- remove or narrow Python temp/sitecustomize compatibility shim if v2 makes it obsolete
- remove uv-specific workaround if obsolete
- update docs to describe v2 as the Windows sandbox implementation

## Risks and mitigations

### Local account visibility

Risk: the sandbox user may appear in admin tools.

Mitigation:

- hide from Winlogon UserList
- clear naming
- settings UI explains/reset removes it
- no admin membership

### Standard-user UAC with separate admin credentials

Risk: if setup runs as a different admin account, secrets/ACL ownership can be wrong.

Mitigation:

- use DPAPI machine scope for secrets, as Codex does
- explicitly ACL secrets for intended real user/system/admin
- store `realUserName` and preferably `realUserSid` in setup payload
- resolve the real user SID in the unelevated process before UAC
- test both admin-user UAC and standard-user-with-admin-credential flows

### Antivirus/EDR sensitivity

Risk: creating a user, changing ACLs, and launching with alternate credentials may trigger security software.

Mitigation:

- clear signed binaries in packaged app if possible
- transparent UI
- deterministic names
- minimal privileges
- logs and reset path

### Path canonicalization and junction escapes

Risk: a path that appears to be under an allowed root may resolve through a junction/symlink to an external location, causing incorrect ACL grants or policy bypass.

Mitigation:

- replace `canonicalish()` for v2 with robust Windows-aware canonicalization
- canonicalize nearest existing parents for future paths
- reject managed-root and writable-root junction escapes by default
- add regression tests for symlink/junction traversal

### Incidental sandbox-user write access

Risk: a normal local non-admin sandbox account may still be able to write to its own profile/temp, public/shared folders, or locations whose ACLs grant write to the sandbox user or one of its groups. Mapped/remote drives are usually not visible to the sandbox logon session and are typically protected by domain ACLs, but OfficeAgent should not rely on that for its managed-root policy.

Mitigation:

- product wording should promise that OfficeAgent does not grant or intentionally route writes outside managed/approved roots, not that every OS-writable location is impossible
- never include drive roots, real-user profile/Desktop/Documents, or remote/mapped roots as writable roots in managed GUI sessions
- keep command environment pointed at OfficeAgent-managed HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/tool-state paths
- add the restricted/capability token layer when feasible for stronger allowlist-style write enforcement

### Copied-code drift

Risk: copied Codex code diverges from upstream fixes.

Mitigation:

- isolate adapted modules
- keep source references in comments/docs
- periodically compare with Codex upstream

## Acceptance criteria for making v2 default

Before enabling by default for strong sandbox mode:

- one-time setup succeeds on a clean Windows machine
- normal command launch after setup requires no UAC
- sandbox user is non-admin and hidden from login UI
- secrets are DPAPI-protected and not stored in env vars/plaintext
- pip/npm/uv acceptance tests pass
- OfficeAgent grants writes only to managed/approved roots, and does not grant real-user profile/Desktop/Documents or mapped/remote drive roots
- writes outside allowed roots fail where strong capability enforcement is enabled
- symlink/junction escape tests fail closed
- standard-user UAC flow configures ACLs for the intended user, not only the approving admin
- process tree cleanup works
- setup readiness/repair handles prior installs and partial failed setups smoothly
- setup repair/reset works
- packaged Electron app includes all helper binaries
- GUI can explain setup state and recover from failures

## Immediate next steps

1. Keep the current logon-user spike only as a validation tool.
2. Add attribution/NOTICE tracking for adapted Codex Windows sandbox code.
3. Create Rust modules mirroring Codex concepts inside `native/windows-sandbox-helper`.
4. Start with foundations: path normalization, setup error reporting, DPAPI, SID/user/group helpers, and ACL helpers.
5. Lock down the initial policy that managed GUI project roots must be under AgentData.
6. Implement setup helper + DPAPI secrets after the foundation helpers exist.
7. Add dev command to run one-time setup and verify sandbox user/secrets.
8. Implement the v2 launch path directly in the helper. If a temporary backend flag is needed during development, mark it internal and remove it before productizing.
9. Move TS-created command scripts/request/compat artifacts behind the v2 helper boundary or make `fileWrite`/`mkdir` v2-aware; implement Codex-style named-pipe stdout/stderr capture instead of file output.
10. Run package-manager smokes, especially `pip install --user Pillow` across sessions.
11. Remove temporary password-in-env spike and legacy write-restricted product path as part of the refactor.
