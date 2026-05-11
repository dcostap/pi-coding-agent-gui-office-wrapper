# Windows sandbox v2: Codex-inspired direction

Date: 2026-05-08

Detailed product refactor plan: [`windows-sandbox-codex-aligned-redesign.md`](./windows-sandbox-codex-aligned-redesign.md).

## Why this exists

The current OfficeAgent Windows sandbox is useful write containment, but its identity model is fragile for real package managers and build tools.

Current model, simplified:

```text
normal Windows user token
+ write-restricted token
+ OfficeAgent restricting SID must appear on writable paths
```

This means an allowed parent directory can still fail if a tool creates a child directory/file with an explicit private DACL that omits the OfficeAgent restricting SID. Python/pip exposed this with temp unpack directories.

Project-scoped package state fixes persistence across Pi sessions, but it does not by itself fix this identity/DACL class of bugs.

## Product state model

Keep this change regardless of sandbox v2:

```text
<managed-root>/.officeagent/project-state/<project-key>/
  cache/
  config/
  data/
  tools/
  bin/
  python-user-base/
  pip-cache/
  npm-cache/
  npm-prefix/
  uv-cache/
  uv-tools/
  uv-tools-bin/
  uv-python/
  uv-python-bin/

<managed-root>/.officeagent/sessions/<session-id>/
  profile/
  temp/
  logs/
```

Default env policy:

- package/tool state is per project
- temp/log/profile is per session
- same project + multiple Pi sessions share libraries/caches/tools
- different projects do not share package state by default

## Codex-inspired sandbox principle

Do not rely only on inherited ACLs for a synthetic restricting SID.

Target model:

```text
commands run as / with a real sandbox execution identity
allowed writable roots are granted to that identity/capability
files created inside writable roots remain usable even when tools create owner-private DACLs
outside writable roots remains blocked by OS policy/ACLs/token restrictions
```

Copy the principles, not necessarily the exact implementation:

- declarative writable roots
- separate network policy
- protected metadata paths under writable roots
- setup/readiness flow
- explicit diagnostics when setup is incomplete
- tests for real package managers and concurrent sessions

## Required writable roots

For a command in project P and session S:

```text
P project directory
project-state(P)
project-state(P)/cache
project-state(P)/config
project-state(P)/data
project-state(P)/tools
project-state(P)/bin
project-state(P)/python-user-base
project-state(P)/pip-cache
project-state(P)/npm-cache
project-state(P)/npm-prefix
project-state(P)/uv-cache
project-state(P)/uv-tools
project-state(P)/uv-tools-bin
project-state(P)/uv-python
project-state(P)/uv-python-bin
sessions(S)/profile
sessions(S)/temp
sessions(S)/logs
```

Protected paths remain non-writable even inside writable roots when applicable:

```text
.git/
.officeagent internal control paths where needed
future project metadata/config paths
```

## Migration phases

### Phase 1: state layout and env routing

Status: started.

- add project-state runtime paths
- point pip/npm/uv/Python user-base env vars to project state
- keep temp/log/profile per session
- pass project-state dirs as explicit writable paths to current helper
- test same-project multi-session sharing

### Phase 2: current helper hardening, without new hacks

Status: started.

Do only non-controversial hardening:

- keep writable roots explicit
- ensure ACL grant code is idempotent so launches do not grow duplicate ACEs
- add diagnostics showing effective writable roots and selected command backend

The native helper now checks for an existing inheritable allow ACE before appending a new writable-root ACE. This is not a Python/tool repair mechanism; it only prevents repeated launches from growing equivalent ACL entries.

Avoid adding new tool-specific auto-repair/retry hacks.

### Phase 3: sandbox identity v2 spike

Status: started.

Build a feature-flagged helper mode that runs commands under a dedicated sandbox execution identity/capability instead of depending solely on inherited ACEs for a synthetic restricting SID.

Initial spike mode:

```text
OFFICE_AGENT_SANDBOX_IDENTITY_MODE=logon-user
OFFICE_AGENT_SANDBOX_LOGON_USER=<local sandbox account>
OFFICE_AGENT_SANDBOX_LOGON_DOMAIN=.   # optional; default is .
OFFICE_AGENT_SANDBOX_LOGON_PASSWORD=<password>
```

For local testing, `cd apps/gui && bun run sandbox:logon-spike:setup` creates/updates the local test account and persists the required user environment variables. `bun run sandbox:logon-spike:disable` clears those variables.

This mode logs on the supplied account, grants that account SID access to the managed writable roots, and launches the command with that account token. The goal is to test the core hypothesis: owner-private child dirs/files created by package managers should remain usable because the creator/owner is the sandbox execution identity.

Questions to answer in the spike:

- Can we create/use a dedicated local sandbox user without unacceptable install-time elevation?
- If elevation is required, what setup UX is acceptable?
- Can a capability/AppContainer identity give us owner-private child file usability without local user accounts?
- What read policy do we actually want for OfficeAgent 1.0: write containment only, or stronger read confinement?
- How do private desktop, job object cleanup, stdout/stderr capture, and terminal PTY mode interact with the new identity?

### Phase 4: switch and cleanup

When v2 passes package-manager smokes, remove compatibility hacks that became obsolete:

- Python temp/sitecustomize workaround if owner-private temp dirs no longer fail
- uv compatibility shim once real uv works under the sandbox
- legacy per-session package-state env paths
- any tool-specific ACL repair/retry experiments

## Acceptance tests

Minimum green path before making v2 default:

1. `python -m pip install --user Pillow` in session A, import in session B, same project.
2. Same install in project A is not visible in project B by default.
3. `python -m venv .venv && .venv\\Scripts\\python -m pip install Pillow` works.
4. `npm install` and `npm install -g <small-cli>` use project-scoped cache/prefix.
5. `uv python find`, `uv venv`, `uv pip install ...`, and `uv run python ...` work or fail with clear unsupported messages.
6. Two sessions in same project running package installs do not corrupt state.
7. Writes outside managed root fail.
8. Writes to protected metadata paths fail.
9. Process tree cleanup still kills descendants.
10. Network policy is explicit and tested.
