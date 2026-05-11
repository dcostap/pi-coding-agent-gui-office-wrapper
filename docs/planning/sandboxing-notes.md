# Sandboxing Notes

Date: 2026-04-21
Project: `C:\Projects\office-gui-for-agentic-ai`

## Status

This file tracks OfficeAgent's Windows sandboxing design, implementation progress, accepted risks, and remaining gaps.

Current OfficeAgent behavior now includes a real AppContainer/Job Object primitive for managed `bash` command execution, but it is **not** a complete untrusted-project sandbox yet.

Known high-level gaps remain:

- file tools still run in the trusted host with path checks
- extensions/packages are not restricted yet by current product decision
- the command backend is still `cmd.exe` by default; Python and uv can now be staged/bundled, while Bash/Git compatibility remains research-only
- no persistent sandbox worker protocol exists yet

---

## Why this matters

Longer-term, we want the agent to have broad freedom **inside a bounded local environment**, not broad freedom on the full user desktop.

The core idea is:

- keep stock Pi UX on the user machine
- but constrain agent-executed commands and file writes to a clear sandbox boundary
- ideally per workspace / per chat / per session policy

This is especially important for the Windows-only product direction.

---

## OpenAI Codex research starting point

Primary OpenAI documentation to study:

- OpenAI Codex sandboxing concepts: <https://developers.openai.com/codex/concepts/sandboxing>

Key high-level takeaways from the public docs:

- Codex separates **sandboxing** from **approval policy**
- sandboxing defines the technical boundary
- approvals decide when the agent must stop and ask
- common modes are:
  - `read-only`
  - `workspace-write`
  - `danger-full-access`
- Codex says it uses **platform-native enforcement**
  - macOS: Seatbelt / `sandbox-exec`
  - Linux / WSL2: `bubblewrap`-based sandboxing
  - Windows: native Windows sandboxing paths depending on environment

For OfficeAgent, this split is important: we should not treat prompt instructions or cwd alone as the boundary.

---

## Codex source-code notes worth studying

Repository:

- <https://github.com/openai/codex>

Reference commit used for the links below:

- `1101dec9ae6c54e0403ac109f5a0f92108a8d0f8`

### 1. Codex has an explicit cross-platform sandbox selector

The sandbox manager enumerates platform sandbox types and selects:

- `MacosSeatbelt`
- `LinuxSeccomp`
- `WindowsRestrictedToken`

Source:

- `codex-rs/sandboxing/src/manager.rs`
- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/manager.rs#L23-L63>
- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/manager.rs#L142-L166>

This is a good mental model for us: one product concept, platform-specific executors.

### 2. Codex transforms commands before execution based on sandbox policy

The same manager converts an intended command into a sandboxed execution request, with platform-specific handling for:

- macOS Seatbelt wrapping
- Linux sandbox helper invocation
- Windows restricted-token execution paths

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/manager.rs#L171-L271>

This is relevant because OfficeAgent will probably need a similar **execution broker** layer rather than trying to bolt policy directly into arbitrary shell calls.

### 3. macOS implementation is explicitly tied to `/usr/bin/sandbox-exec`

Codex hardcodes the trusted Seatbelt executable path instead of relying on PATH lookup.

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/seatbelt.rs#L19-L28>

This is a useful design lesson: when a security boundary depends on a system helper, prefer a trusted system path over PATH search.

### 4. Linux implementation depends on `bubblewrap` and user namespaces

Codex checks for `bwrap`, warns if it is missing, and explicitly calls out WSL1 as unsupported for this style of sandbox.

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/bwrap.rs#L7-L20>
- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/bwrap.rs#L29-L58>
- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/sandboxing/src/bwrap.rs#L80-L100>

This matters for us because it reinforces that the real implementation is OS-specific and not something we can fake with cwd rules.

### 5. Windows has multiple sandbox levels

Codex resolves Windows sandbox mode into:

- `Elevated`
- `RestrictedToken`
- `Disabled`

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/core/src/windows_sandbox.rs#L25-L48>
- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/core/src/windows_sandbox.rs#L59-L89>

This is particularly relevant to OfficeAgent because Windows is our main target. We likely need to study whether our future implementation should begin with a more practical restricted-token approach before attempting a stronger elevated / helper-driven sandbox.

### 6. Codex also supports an `externalSandbox` mode at the app-server boundary

The app-server README documents an `externalSandbox` mode for clients that are **already sandboxed externally**. In that case Codex does not enforce its own sandbox and instead treats the environment as already constrained.

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/app-server/README.md#L822-L827>

This is very interesting for OfficeAgent. It suggests a possible future architecture where:

- OfficeAgent owns the Windows sandbox implementation itself
- Pi / agent runtime is informed that execution is already sandboxed
- model behavior still reflects a bounded environment

### 7. The Windows sandbox crate itself rejects `danger-full-access` and `external-sandbox`

Codex’s Windows sandbox crate parser only accepts enforceable sandbox policies such as `read-only` and `workspace-write`, and explicitly rejects `danger-full-access` and `external-sandbox`.

Source:

- <https://github.com/openai/codex/blob/1101dec9ae6c54e0403ac109f5a0f92108a8d0f8/codex-rs/windows-sandbox-rs/src/policy.rs#L4-L24>

That separation is useful conceptually:

- the top-level runtime can understand broader policy modes
- the low-level sandbox implementation should only accept modes it can actually enforce

---

## What this likely means for OfficeAgent

Our future sandboxing work should probably follow these principles:

### 1. Treat sandboxing and approvals as separate concerns

We should keep separate concepts for:

- **sandbox boundary**
- **approval / escalation policy**

Those are related, but they are not the same thing.

### 2. Use a brokered execution path

Instead of treating raw shell execution as the product primitive, we likely want:

- OfficeAgent main runtime / broker
- a sandbox-aware local executor for commands
- clear translation from requested command -> sandboxed command execution

### 3. Prefer platform-native Windows enforcement

Because Windows is our product target, the future implementation should probably focus on:

- AppContainer + explicit ACL grants as the leading candidate for a **real** folder boundary
- restricted token / low-integrity / job-object hardening as supporting layers or fallback options
- explicit writable roots
- explicit read exceptions if needed

### 4. Keep workspace-write as the likely default target

For our likely day-to-day product mode, the most useful target is probably:

- readable project context
- writable project/worktree roots
- no unrestricted desktop access
- optional network restrictions depending on policy

This maps most closely to Codex’s `workspace-write` philosophy.

### 5. Do not confuse cwd with sandboxing

Changing cwd is useful, but it is not a security boundary.

Future OfficeAgent sandboxing should be based on actual OS-enforced process and filesystem restrictions.

---

## Likely future architecture sketch

One plausible OfficeAgent direction:

1. GUI/TUI remains local on B
2. A-side gateway still owns real model/provider credentials
3. local OfficeAgent runtime routes command execution through a sandbox broker
4. sandbox broker launches commands under a Windows-constrained execution context
5. audit/analytics continue flowing to A
6. approval policy decides when to escalate outside the sandbox, if ever

That would preserve our current split-host architecture while adding a real local safety boundary.

---

## 2026-04-22 initial OfficeAgent 1.0 investigation

### Restated 1.0 product boundary

Target behavior for the Windows GUI app:

- the employee launches a portable OfficeAgent GUI on their Windows PC
- identity is derived from Windows domain + username (+ host for telemetry/audit), which is acceptable for routing but **not** a security boundary
- the GUI should manage one parent directory for that employee
- projects are created by the GUI as subfolders under that parent directory
- users should not point the app at arbitrary folders on disk
- the model/agent should not be able to read, write, or manipulate data outside that parent directory, even through obfuscated shell commands

That means the security boundary is **not** “the current project folder”. It is the one managed parent root.

### What the current codebase does today

Current behavior is materially different from the 1.0 goal:

- the GUI currently allows opening **any** directory through the native folder picker
  - `apps/gui/desktop/electron/main.ts`
  - `pickWorkspaceViaDialog()` uses `dialog.showOpenDialog({ properties: ["openDirectory"] })`
- selected workspaces are then stored/synced as arbitrary paths
  - `apps/gui/desktop/electron/app-store-workspace.ts`
- session cwd is simply the workspace path
  - `packages/pi-sdk-driver/src/session-supervisor.ts`
  - `createSession()` and `ensureRecord()` pass `cwd: workspace.path`
- OfficeAgent already derives Windows identity from environment variables and injects it into gateway headers
  - `packages/office-agent-runtime/src/index.ts`
  - uses `USERNAME`, `USERDOMAIN`, `COMPUTERNAME` / `HOSTNAME`

So today we have **workspace cwd selection**, not a security sandbox.

### Pi runtime facts that matter for sandboxing

Looking at the installed pi runtime:

- built-in file tools accept absolute paths today
  - `@mariozechner/pi-coding-agent/dist/core/tools/path-utils.js`
  - `resolveToCwd()` returns absolute paths as-is
- built-in `read` / `write` / `edit` are therefore not confined by cwd alone
- built-in `bash` launches a real shell with the provided cwd and inherited environment
  - `@mariozechner/pi-coding-agent/dist/core/tools/bash.js`
- on Windows, pi looks for Git Bash or another `bash.exe`
  - `@mariozechner/pi-coding-agent/dist/utils/shell.js`
- pi’s package manager uses `npm`, `git`, temp directories, and on Windows shells out with Windows shell behavior
  - `@mariozechner/pi-coding-agent/dist/core/package-manager.js`

Bottom line: **without an execution broker and OS enforcement, the model has no hard local boundary today.**

### Important consequence of “one parent folder only”

If we really mean one managed parent folder is the boundary, then not only project files but also OfficeAgent-managed mutable state should probably live **inside that root**, or be explicitly included as part of that root.

Why this matters:

- current managed agent data defaults to `%LOCALAPPDATA%\OfficeAgent\pi-agent`
  - `packages/office-agent-runtime/src/index.ts`
- pi sessions, settings, temp package installs, and other runtime state expect an agent dir
- if the future sandbox only allows one managed root, but agent state remains in `%LOCALAPPDATA%`, then we immediately have a conflict

That suggests one of two designs:

1. move OfficeAgent mutable runtime data inside the managed root, or
2. keep a trusted host-side broker outside the sandbox and ensure the model never gets direct host execution there

For the product goal you described, option **1** is conceptually cleaner.

### Windows enforcement findings

#### Restricted tokens are useful, but not enough by themselves

Microsoft docs on restricted tokens:

- <https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens>
- <https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken>

Key takeaway:

- restricted tokens remove privileges / disable SIDs / add restricting SIDs
- access still depends on Windows ACL evaluation
- that is **not automatically equivalent** to “can only touch this one folder”

So “launch with a restricted token” is not yet a complete answer.

#### Low integrity / MIC helps for writes, not full read confinement

Microsoft docs on MIC:

- <https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control>

Key takeaway:

- low integrity blocks writes to medium-integrity objects by default
- this is useful hardening
- but it does **not** by itself solve “cannot read outside the root”

So low integrity is good defense-in-depth, but not the full boundary we want.

#### AppContainer looks much closer to the actual requirement

Microsoft docs:

- <https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-for-legacy-applications->
- <https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer>

Relevant takeaways from Microsoft’s docs:

- unpackaged legacy Win32 apps can run in AppContainer
- child processes normally inherit the AppContainer token
- resources are blocked unless explicitly granted
- AppContainer provides sandboxing for files, registry, network, devices, and other apps
- AppContainer runs at low integrity
- AppContainer profiles also give us a natural per-sandbox profile/temp concept

This is much closer to “obfuscated command still cannot escape” than cwd rules or low-integrity-only tricks.

#### Job Objects are still valuable

Microsoft docs:

- <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>

Job objects do not create the filesystem boundary, but they are still useful for:

- process-tree lifetime control
- cleanup on cancel/timeout/app exit
- resource limits
- easier supervision of descendants

### Initial conclusion on Windows primitives

If the requirement is truly:

> the agent must not be able to read or write outside the managed root, even via complex/obfuscated commands

then the leading candidate for 1.0 is:

- **AppContainer-based sandboxed child execution**
- plus **Job Object** supervision
- plus explicit ACL grants for the managed root and required trusted runtime locations

Restricted token / low integrity are still worth studying, but should be treated as:

- defense-in-depth layers, or
- a weaker fallback mode,

not automatically as equivalent to a strong root-confined sandbox.

### Package manager / toolchain impact

This is the main practical wrinkle.

#### Good news

Commands that stay local to the project should fit the model well:

- `npm install` into project `node_modules`
- local Python virtual environments such as `.venv`
- local temp/build output inside the managed root

Those are compatible with a workspace-write style sandbox.

#### Bad news: user/global installs and caches

Official docs say:

- npm Windows global prefix defaults to `%AppData%\npm`
  - <https://docs.npmjs.com/cli/v9/configuring-npm/folders>
- npm temp files default from `TMPDIR` / `TMP` / `TEMP`
  - same npm docs above
- Python user site on Windows defaults to `%APPDATA%\Python\PythonXY\site-packages`
  - <https://docs.python.org/3/library/site.html>
- `pip install --user` is explicitly a user-site install flow on Windows
  - <https://packaging.python.org/tutorials/installing-packages/>

That means a strict sandbox will affect:

- `npm install -g ...`
- `pip install --user ...`
- package caches
- tools that expect writable `%TEMP%`
- tools that read global user config from the real profile

#### Implication

For good day-to-day agent behavior, sandboxed child processes probably need environment rewriting such as:

- `APPDATA`
- `LOCALAPPDATA`
- `USERPROFILE`
- `HOME`
- `TEMP`
- `TMP`

pointing to sandbox-local profile/temp directories.

If we do this carefully, then:

- npm global installs can be redirected into the sandbox-managed profile
- Python user installs can also be redirected into the sandbox-managed profile
- caches and temp output stop leaking into the employee’s real profile

If we **do not** do this, a lot of normal agent workflows will either break or escape the intended data boundary.

### Extra runtime constraint: pi packages and extensions are trusted code

This is easy to miss.

Current pi capabilities include:

- JS/TS extensions
- npm/git-delivered pi packages
- workspace/user-level extension discovery

Those are effectively **trusted code execution**, not just model tool calls.

So if OfficeAgent 1.0 is supposed to provide a strong local safety boundary for office workers, then letting arbitrary user/workspace extensions/packages load would undermine the model.

Very likely 1.0 default should be:

- allow only built-in / admin-shipped extensions
- disable arbitrary user/workspace npm or git package installs
- be conservative about custom providers and extension code loading

Skills written as markdown prompts are much less dangerous than arbitrary JS extensions, but even there we should still be deliberate.

### Repo-level integration hint

There is a promising integration seam already:

- `packages/pi-sdk-driver/src/session-supervisor.ts`
- `PiSdkDriverOptions` exposes `createAgentSessionRuntimeImpl`

And pi’s built-in tools already support pluggable backends / operations.

That suggests we may not need to fork all of pi internals to do this. A plausible approach is:

- keep OfficeAgent main runtime trusted
- inject a custom session runtime / tool backend layer
- route `bash` through a Windows sandbox helper
- route file tools through brokered operations that enforce the managed-root policy

This fits the “execution broker” direction already noted above.

### Initial 1.0 recommendation

1. Replace “open any folder” with “create/open project inside OfficeAgent-managed root only”.
2. Treat the managed parent folder as the real boundary, not the current project cwd.
3. Put OfficeAgent mutable runtime data inside that root as well, for example:
   - `projects/`
   - `.officeagent/pi-agent/`
   - `.officeagent/temp/`
   - `.officeagent/profile/`
4. Keep the GUI/main runtime trusted, but route all model-executed shell/filesystem actions through a sandbox broker.
5. Prefer AppContainer-based child execution plus Job Object supervision for the actual Windows boundary.
6. Redirect user-profile-style env vars into sandbox-local directories so npm/pip/temp behavior stays inside the boundary.
7. Decide explicitly whether 1.0 allows outbound network from the sandbox. If normal workflows include `npm`, `pip`, `git clone`, etc., network is probably needed by default.
8. Lock down extensions / pi packages in 1.0 so we do not reintroduce escape via trusted JS code.

### Practical clarifications for 1.0

- domain + username is fine for identification/audit right now, but it is not auth security
- cwd is only a convenience, not the boundary
- projects are a UI concept; the security boundary is the one managed parent root
- if cross-project access inside that root is acceptable, one sandbox root per user may be enough for 1.0
- if cross-project isolation later becomes a requirement, we will need per-project or per-session sub-sandboxes

### 2026-04-23 review of external practical sandboxing report

Overall assessment: **good and helpful**. It is directionally aligned with the conclusions above and is useful as design input, especially because it pushes toward:

- trusted broker + untrusted worker split
- AppContainer as the primary Windows primitive
- Job Object supervision
- session-local scratch/profile/temp/package-manager state
- proving the design with a small PoC before over-designing it

#### What the report gets especially right

1. **Brokered execution is the right mental model**
   - This matches our earlier conclusion that cwd/prompt rules are not a boundary.
2. **AppContainer is the first serious non-VM candidate**
   - This matches the strongest Windows-native direction we have found so far.
3. **Job Objects are lifecycle/process-tree tooling, not the core filesystem boundary**
   - Good distinction.
4. **npm/pip feasibility depends on profile/temp/cache redirection**
   - Very relevant to product usability.
5. **A small PoC is the correct next validation step**
   - Specifically: can our real runtime do `npm install` and `python -m venv .venv` inside the sandbox?

#### Where I think the report needs nuance

1. **Per-project boundary is a product decision, not an automatic conclusion**
   - The report recommends ACL-granting only the active project + session scratch.
   - That is the **stronger** design.
   - But our currently stated 1.0 goal allows all work under one managed parent root, even if sibling projects are reachable.
   - So we should treat this as:
     - **option A:** one root per user for simpler 1.0
     - **option B:** one root per active project/session for stronger isolation
   - Not as an already-settled requirement.

2. **The worker will still need some non-project reads**
   - The report correctly says “one folder and nothing else” is not literal on Windows.
   - In practice, beyond system libraries, we may also need read/execute access for:
     - bundled app/runtime files
     - trusted shell/node/python/git binaries
     - maybe selected cert/config locations
   - That means the real policy will be “project + session scratch + minimal trusted runtime allowlist”, not just project + scratch.

3. **Compatibility risk with our exact runtime stack is still the big unknown**
   - Our current stack involves Electron, pi, Node, bash/git tooling, extension/resource loading, and package-manager behaviors.
   - AppContainer may be the right answer, but the important question is not theoretical correctness alone.
   - It is whether **our actual runtime** behaves well enough under it.

4. **“Mostly containable” for npm/pip is true, but only with disciplined defaults**
   - This is realistic for:
     - local `node_modules`
     - local `.venv`
     - redirected user/global/cache/temp dirs
   - It becomes less clean for:
     - native build steps
     - machine-wide installers
     - COM-heavy or registry-heavy tooling
     - Windows-specific dev tooling assumptions
   - So the report is right, but we should read it as “feasible for normal coding workflows”, not “all package flows become easy”.

#### Net effect on our design thinking

Yes, the report **does help**.

It reinforces these likely design directions:

- keep a trusted OfficeAgent GUI/broker
- strongly consider a small native Windows helper
- use AppContainer for the untrusted worker/process tree
- use a Job Object for supervision/cancellation/cleanup
- redirect profile/temp/package-manager state into OfficeAgent-managed directories
- validate the design with a focused PoC before committing the product architecture

#### Concrete implication for next prototype

A very good prototype target now looks like:

1. create a managed root
2. create a project dir + session scratch/profile dirs
3. launch a worker/process tree under AppContainer
4. ACL-grant only:
   - managed project area (or managed root, depending on policy choice)
   - session scratch/profile area
   - minimal trusted runtime/toolchain reads
5. run these validation cases:
   - `npm install`
   - `npx ...`
   - `python -m venv .venv`
   - `pip install ...` inside `.venv`
   - attempted read outside sandbox
   - attempted write outside sandbox
   - child-process spawning and cancellation

If those pass with our real stack, we will know we are not just theorizing.

---

## 2026-04-23 proposed first robust slice (not a demo)

If we want the **first real, internally-usable version**, the best slice is probably this:

### Product scope for the first robust slice

#### In scope

1. **Windows-only**
2. **Managed-root-only workspace model**
   - no arbitrary folder picker for agent work
   - GUI creates projects as subfolders under one OfficeAgent-managed parent root
3. **Real sandbox for model-executed work**
   - all model shell execution goes through a sandbox broker
   - all model file access goes through sandbox-aware execution paths
4. **Allow installs inside sandbox**
   - local `npm install`
   - `npx`
   - `python -m venv .venv`
   - `pip install` inside `.venv`
   - redirected user/global/cache/temp dirs inside the managed root
5. **Safe process-tree lifecycle**
   - cancellation kills descendants
   - app exit kills descendants
6. **Admin-controlled executable extension surface**
   - no arbitrary user/workspace JS extension loading in this slice

#### Explicitly out of scope

1. per-project isolation from sibling projects
   - first slice can keep the boundary at the **managed parent root** if that matches product 1.0
2. arbitrary external folder access by the worker
3. machine-wide installs
4. Windows services / drivers / Program Files writes
5. broad custom extension/package freedom
6. Linux/macOS

### Why this is the right first slice

Because it gives us a version that is:

- **real**: OS-enforced boundary, not prompt theater
- **usable**: supports npm/python workflows inside the sandbox
- **aligned with current product statement**: one managed parent folder
- **small enough to finish**: does not require solving every future hardening step before shipping internally

### Recommended architecture for this slice

#### Trusted side

- Electron GUI / main process
- OfficeAgent app state manager
- sandbox broker coordinator
- gateway/auth/audit plumbing
- Explorer/open-folder shortcuts
- project creation/import UI

#### Untrusted side

- worker process tree launched under Windows AppContainer
- attached to a Job Object
- receives redirected env/profile/temp/cache locations
- runs the shell/toolchain seen by the model

#### Native helper

Strong recommendation: add a small native Windows helper process/binary to own:

- AppContainer setup
- ACL grants
- Job Object setup
- worker launch / kill
- maybe later brokered file ops too

This can be packaged with the Electron app using the existing packaging flow (`electron-builder` already supports shipping extra resources / helper binaries).

### Boundary definition for the first robust slice

For the first robust slice, use this boundary:

- **allowed content area** = OfficeAgent-managed root
- inside it:
  - `projects/<name>/...`
  - `.officeagent/sessions/<session-id>/...`
  - maybe `.officeagent/shared-cache/...` later, but safer to start session-local
- outside it:
  - deny worker access to user content and arbitrary host folders

This matches the current product direction better than jumping immediately to per-project isolation.

### Folder layout for the first robust slice

Example:

```text
<managed-root>/
  projects/
    project-a/
    project-b/
  .officeagent/
    sessions/
      <session-id>/
        profile/
        temp/
        npm-cache/
        npm-prefix/
        pip-cache/
        python-user-base/
        logs/
```

### Tool behavior policy

#### Keep model-facing tool names if possible

Keep the agent seeing standard tools such as:

- `read`
- `write`
- `edit`
- `bash`

But replace the execution backends underneath.

#### Bash

- must run inside the sandboxed worker, not directly on the host

#### File tools

- should only operate within the managed root policy
- absolute paths outside the root should fail clearly

### Install policy for the first robust slice

#### Supported and encouraged

- `npm install`
- `npx`
- local `node_modules`
- `python -m venv .venv`
- pip installs inside `.venv`
- redirected temp/cache/profile dirs

#### Supported but secondary

- `npm install -g ...` only if redirected into sandbox-owned prefix
- `pip install --user ...` only if redirected into sandbox-owned user base

#### Not supported

- machine-wide install flows
- registry-heavy installers
- Program Files writes
- service/driver installs

### Minimum environment rewriting for this slice

Sandboxed worker should receive rewritten values for at least:

- `APPDATA`
- `LOCALAPPDATA`
- `USERPROFILE`
- `HOME`
- `TEMP`
- `TMP`

Likely also tool-specific overrides:

- npm prefix/cache/userconfig
- Python user base / pip cache / optional pip config file

### Security posture for the first robust slice

This slice should be able to honestly claim:

- model-executed commands and child processes are sandboxed to an OfficeAgent-managed boundary on Windows
- installs, temp files, and user-level package state are redirected into the sandbox-owned area
- the worker does not have arbitrary host folder access

It should **not** claim yet:

- perfect per-project isolation
- support for every Windows development/install workflow
- full stock-pi extension freedom inside the sandbox

### Concrete implementation phases for this slice

#### Phase 1: managed-root product changes

- replace arbitrary workspace picking for normal use with managed project creation/import flow
- introduce managed root settings/state
- make project/workspace records derive from that root model

#### Phase 2: native helper + sandbox launch

- add Windows helper binary
- launch a sandboxed worker under AppContainer
- attach Job Object with kill-on-close / no breakaway behavior
- add session-scoped profile/temp dirs

#### Phase 3: shell/install viability

- validate `npm install`
- validate `npx`
- validate `python -m venv .venv`
- validate `pip install` inside `.venv`
- validate cancellation and descendant cleanup

#### Phase 4: tool backend hardening

- route `bash` through sandboxed worker execution
- route file tools through managed-root-aware execution paths
- disable or lock down unsafe extension/package loading paths for this slice

#### Phase 5: internal-use readiness

- clear error messages for unsupported install/system workflows
- audit/logging around sandboxed command execution
- packaging and update story for the helper binary
- internal docs and known limitations

### Success criteria for calling this “v1 slice” instead of “prototype”

We should only call it a first real slice if all of these are true:

1. normal internal users can create a project and work inside it without arbitrary folder picking
2. model-executed shell commands are actually sandboxed on Windows
3. local npm and Python workflows succeed inside the boundary
4. obvious outside-root reads/writes fail
5. child processes do not survive cancellation/app close
6. the feature can ship in the portable Windows package, not just a dev-only harness

---

## 2026-04-23 actionable implementation workstreams

Below is a practical repo-oriented plan for building the first robust slice.

### Workstream A — managed-root product model

#### Goal

Stop treating arbitrary host folders as normal workspaces. Make OfficeAgent own the root.

#### Likely repo changes

##### `apps/gui/desktop/electron/main.ts`

- replace or narrow `pickWorkspaceViaDialog()` for the sandboxed product path
- add IPC for:
  - get managed root
  - create project in managed root
  - import external folder into managed root
  - open managed project in Explorer
- keep host-side Explorer integration trusted

##### `apps/gui/desktop/src/*`

- change empty-state/new-project UX from “open any folder” to:
  - choose managed root on first run, or auto-provision one
  - create project by name
  - optional import/copy existing folder into managed root
- sidebar/workspace UI should assume projects belong to the managed root model

##### `apps/gui/desktop/electron/app-store-workspace.ts`

- stop treating arbitrary paths as normal first-class workspaces
- move toward managed project creation + sync only for paths under the managed root

##### `packages/office-agent-runtime/src/index.ts`

- add helpers for managed root layout, for example:
  - `getOfficeAgentManagedRoot(...)`
  - `getOfficeAgentProjectsDir(...)`
  - `getOfficeAgentSessionDir(...)`
  - `getOfficeAgentSandboxProfileDir(...)`
- stop assuming all mutable OfficeAgent state belongs under `%LOCALAPPDATA%` only

#### Deliverable

A user can create a project in the managed root without needing arbitrary folder selection for normal flow.

### Workstream B — native Windows sandbox helper

#### Goal

Introduce the smallest trusted native component that can own the hard Windows boundary.

#### Strong recommendation

Add a new native helper project, likely something like one of these:

- `native/windows-sandbox-helper/`
- `packages/windows-sandbox-helper/`

If using Rust, this helper should expose only a minimal command/API surface.

#### Helper responsibilities

- create/derive sandbox identity/profile
- create session-local working dirs
- set ACLs for allowed paths
- launch worker under AppContainer
- assign worker to Job Object
- enforce kill-on-close behavior
- accept run/kill/status requests from the trusted app

#### Packaging changes

##### `apps/gui/desktop/package.json`

Add build scripts such as:

- `build:sandbox-helper`
- include helper in normal desktop build/package flow

##### `apps/gui/desktop/electron-builder.yml`

- package the Windows helper binary via `extraResources` or equivalent
- ensure portable Windows package includes it

##### `apps/gui/desktop/scripts/`

- add helper build/copy script similar in spirit to `build-notification-status-helper.mjs`

#### Deliverable

A packaged Windows build can launch a helper binary and ask it to start/stop sandboxed workers.

### Workstream C — sandbox session layout and environment model

#### Goal

Make installs/temp/cache/profile activity land inside OfficeAgent-owned session dirs.

#### Likely repo changes

##### `packages/office-agent-runtime/src/index.ts`

Add session directory helpers for a layout like:

- `.officeagent/sessions/<session-id>/profile/`
- `.officeagent/sessions/<session-id>/temp/`
- `.officeagent/sessions/<session-id>/npm-cache/`
- `.officeagent/sessions/<session-id>/npm-prefix/`
- `.officeagent/sessions/<session-id>/pip-cache/`
- `.officeagent/sessions/<session-id>/python-user-base/`
- `.officeagent/sessions/<session-id>/logs/`

##### New helper/app coordination code

Define the env var rewriting contract, at least for:

- `APPDATA`
- `LOCALAPPDATA`
- `USERPROFILE`
- `HOME`
- `TEMP`
- `TMP`

Likely also tool-specific values:

- npm prefix/cache/userconfig
- `PYTHONUSERBASE`
- pip cache/config file if needed

#### Deliverable

A sandboxed worker sees a coherent fake profile and temp environment inside the managed root.

### Workstream D — session runtime launch override

#### Goal

Insert the sandboxed worker into the current pi/OfficeAgent runtime flow without throwing everything away.

#### Likely repo changes

##### `packages/pi-sdk-driver/src/session-supervisor.ts`

Use the existing `createAgentSessionRuntimeImpl` seam as the main integration point.

What we likely need:

- a custom runtime/session creation path that launches the agent worker through the sandbox helper
- a clear distinction between:
  - trusted app orchestration
  - untrusted sandboxed execution environment

##### Possible new files in `packages/pi-sdk-driver/src/`

Something like:

- `sandbox-session-runtime.ts`
- `sandbox-worker-client.ts`
- `sandbox-policy.ts`

These would:

- talk to the helper
- create sandbox sessions
- map OfficeAgent workspace/session state to helper launch parameters
- own cancellation/kill semantics

#### Deliverable

Opening or creating a session can use a sandbox-backed runtime instead of direct host execution.

### Workstream E — tool backend replacement while preserving Pi shape

#### Goal

Keep familiar tool names, replace unsafe execution guts.

#### Likely approach

##### `bash`

- must run through the sandbox helper / sandboxed worker
- no direct host shell execution from the trusted Electron/main process

##### `read` / `write` / `edit`

Two realistic options:

1. **phase-first option:** run them against the sandbox-visible filesystem policy via controlled backends
2. **stronger option:** broker them explicitly through helper-managed file operations

The safest long-term version is explicit brokered file ops. The fastest first robust slice may start with sandbox-visible filesystem execution plus strict managed-root policy.

##### Extension/package loading

- restrict or disable arbitrary workspace/user JS extension execution for this slice
- likely allow only built-in/admin-shipped resources initially

#### Likely repo changes

##### `packages/pi-sdk-driver/src/runtime-supervisor.ts`

- add policy mode for locked-down extension/package behavior
- narrow resource loading for the sandboxed product profile

##### `apps/gui/desktop/electron/app-store.ts`

- reflect reduced/controlled runtime capability in settings/runtime refresh flows

#### Deliverable

The model still sees familiar tool names, but actual execution respects sandbox policy.

### Workstream F — networking and provider surface

#### Goal

Avoid accidentally giving the worker more network freedom than needed.

#### Likely policy for first slice

- trusted broker/app continues owning provider/gateway credentials
- sandboxed worker should have the least outbound network needed for:
  - normal package installs if we allow them directly
  - or no direct outbound package access if later proxied by broker

#### Repo changes

Mostly policy/config + helper launch args at first, rather than large UI changes.

#### Deliverable

We can explain exactly who owns credentials and what outbound connectivity the worker has.

### Workstream G — tests and internal readiness

#### Goal

Make the first robust slice verifiable in CI/local validation, not just by manual trust.

#### Likely repo changes

##### `apps/gui/desktop/tests/`

Add a new lane or targeted set for sandbox behavior, for example:

- managed-root creation flow
- project creation in managed root
- blocked outside-root access
- npm install in sandbox
- Python venv + pip install in sandbox
- cancellation kills descendants

##### Production/package tests

Extend packaged Windows smoke coverage to verify:

- helper binary is present
- packaged app can start sandboxed run
- session dirs are created under managed root

#### Deliverable

We have repeatable checks that distinguish a real slice from a demo.

---

## Suggested build order

### Milestone 1 — root-owned product flow

Ship internally only after:

- managed-root concept exists
- users create projects under that root
- arbitrary folder flow is no longer the normal path

### Milestone 2 — helper launches real sandboxed worker

Ship internally only after:

- helper binary is packaged
- app can launch/kill worker via helper
- Job Object cleanup works

### Milestone 3 — install viability

Ship internally only after:

- `npm install` works inside sandbox
- `python -m venv .venv` works inside sandbox
- `pip install` inside `.venv` works inside sandbox

### Milestone 4 — tool hardening and policy lock-down

Ship internally only after:

- `bash` is no longer direct host execution
- outside-root access failures are proven
- arbitrary extension/package execution is not silently re-opening the host

### Milestone 5 — internal usable release

Ship to internal users only after:

- logs/errors are understandable
- unsupported workflows fail clearly
- portable Windows package carries the helper and works end-to-end

---

## Decisions to make now so implementation does not thrash later

1. **Boundary choice for first slice**
   - **chosen:** one managed parent root per user
2. **Native helper language**
   - **chosen:** Rust
3. **Install policy**
   - **chosen:** local-first for Node/Python, with redirected sandbox-owned user/global installs allowed; machine-wide installs forbidden
4. **Extension policy**
   - **chosen:** built-in/admin-only for first slice
5. **Network policy**
   - **chosen:** free outbound internet access from the sandboxed worker for the first slice
6. **Import policy**
   - **chosen:** explicit trusted import/copy into the managed root; no direct live work on arbitrary outside folders

If we decide those six items early, the rest becomes much more like implementation and much less like philosophical churn.

### Recommended decision for 3 — install policy

#### Recommendation

Use this policy for the first robust slice:

- **strongly prefer and encourage local installs**
  - `npm install`
  - `npx`
  - `python -m venv .venv`
  - `pip install` inside `.venv`
- **allow redirected user/global installs inside the managed root**, but treat them as secondary
  - redirected sandbox-global npm prefix
  - redirected sandbox-user Python base
- **do not support machine-wide installs**

#### Why this is the recommended middle ground

It gives us:

- good day-to-day usability
- low surprise for the model
- fewer support problems than banning redirected user/global installs completely
- much less risk than allowing true host-level installs

#### Pros

- normal JS/Python workflows keep working
- models naturally adapt because local installs are already common
- if a tool insists on `-g` or `--user`, it can still land **inside the sandbox**
- avoids forcing users into awkward workarounds too early

#### Cons

- redirected user/global installs add complexity to env/path setup
- some workflows may become dependent on sandbox session/profile state
- native/system-style installers are still out of scope

#### Simpler but harsher alternative

- allow **only** project-local installs
- reject all `-g` and `--user`

Pros:

- simplest policy
- easiest to reason about

Cons:

- more breakage
- more friction for models and users
- more “why did this command fail?” support burden

#### Recommendation summary

Best first-slice call:

- **local-first**
- **redirected sandbox-owned user/global allowed**
- **host/machine-wide forbidden**

### Chosen decision for 5 — network policy

#### Chosen policy

For the first robust slice:

- allow **free outbound internet access** from the sandboxed worker
- do **not** add domain allowlists, package proxying, or egress restrictions in this slice
- still keep the filesystem/process boundary strong via the sandbox itself

#### Why this is acceptable for the first slice

This matches the product goal of not disturbing normal agent work more than necessary.
It also keeps package installs, documentation fetches, git operations, and general research flows simple.

#### Pros

- least friction for the model
- best compatibility with real dev workflows
- simplest first release from a networking-policy standpoint
- no need to build registry/domain/proxy policy infrastructure yet

#### Cons

- weaker network governance than a more locked-down enterprise model
- broader exfiltration surface if sensitive data somehow exists inside the allowed root
- harder to make strong claims later about network minimization/auditability

#### Important implication

Because outbound internet is intentionally unrestricted in this slice, the **sandbox boundary must stay focused on local containment**:

- protect the host filesystem and local machine
- assume internet access is allowed
- make sure only approved local content enters the managed root in the first place

#### Practical guardrails that still make sense

Even with free outbound internet, we should still:

- keep provider/gateway credentials on the trusted side where practical
- keep extension execution tightly locked down
- keep import policy strict (explicit import/copy only)
- log sandboxed command execution for internal audit/debugging

### Recommended decision for 6 — import policy

#### Recommendation

Use an **explicit trusted import flow**:

- the worker never works directly on arbitrary outside folders
- if the user wants an outside repo/folder/file, the trusted GUI/broker imports it into the managed root
- after import, the agent works on the imported copy inside the managed root

Recommended first-slice import modes:

1. **Import/copy folder into managed root**
   - safest and simplest default
2. **Import single files into a project area**
   - useful for docs/assets/input files
3. **Maybe later:** broker-managed sync/update flow
   - not required for the first robust slice

#### Why this is the recommended approach

It preserves the integrity of the boundary:

- one managed root per user
- no arbitrary live host path access by the worker

#### Pros

- very clear mental model
- easier to reason about security
- simpler ACL/boundary behavior
- avoids “special case” path holes into the host

#### Cons

- users must import before working
- copied projects can drift from their original location
- sync/re-import UX must be designed carefully later

#### More permissive alternative

- let the user point to an outside folder and temporarily grant access

Pros:

- convenient
- less copying

Cons:

- erodes the boundary quickly
- invites exceptions and policy sprawl
- makes the one-managed-root story much weaker

#### Recommendation summary

Best first-slice call:

- **explicit import/copy into the managed root**
- **no direct live work on arbitrary outside folders**
- **sync features can come later**

---

## Open questions for later implementation

1. Do we want one sandbox per workspace, per session, or per command?
2. Do we want AppContainer as the primary 1.0 mode, or a weaker restricted-token fallback first?
3. How should writable roots be modeled?
   - workspace root only
   - workspace + temp area
   - workspace + agent-owned hidden state inside the same managed root
   - workspace + selected extra roots
4. How should approvals interact with sandbox escape requests?
5. How do we want Pi tool semantics to map onto the sandbox broker?
   - only `bash`
   - or also `read` / `write` / `edit` / `grep` / `find` / `ls`
6. Should `PI_CODING_AGENT_DIR` and all session persistence move inside the managed root?
7. Which env vars do we rewrite for sandboxed children?
   - `APPDATA` / `LOCALAPPDATA`
   - `USERPROFILE` / `HOME`
   - `TEMP` / `TMP`
   - tool-specific overrides for npm / pip / git if needed
8. Do we allow arbitrary extensions / pi packages in 1.0, or only admin-shipped ones?
9. Do we ship our own trusted shell / git / node / python toolchain, or depend on host installs?
10. Do we eventually want an `externalSandbox`-style contract between our runtime and the agent layer?

---

## Immediate next step when we return to this topic

Before implementing anything, do two focused passes:

### 1. Codex source pass

- `codex-rs/sandboxing/`
- `codex-rs/windows-sandbox-rs/`
- `codex-rs/core/src/windows_sandbox.rs`
- `codex-rs/app-server/README.md` sandbox sections

### 2. OfficeAgent/pi integration pass

- `apps/gui/desktop/electron/main.ts`
- `packages/office-agent-runtime/src/index.ts`
- `packages/pi-sdk-driver/src/session-supervisor.ts`
- current pi tool construction / pluggable operations
- extension/package loading paths we may need to disable for 1.0

Then write an OfficeAgent-specific design deciding:

- target Windows enforcement mechanism
- whether agent data moves inside the managed root
- policy model
- writable-root model
- env var redirection model
- extension/package policy for 1.0
- escalation behavior
- integration point in our GUI/TUI shared runtime
- whether we need a small native Windows helper / broker process

## Implementation progress update (2026-04-22)

Managed-root product work has now started in the repo.

### Landed foundation

- `packages/office-agent-runtime/src/index.ts`
  - added managed-root path helpers
  - added managed sessions/projects layout helpers
  - added managed project creation helpers
  - added duplicate-safe project-name allocation for imports (`-2`, `-3`, ...)
- `apps/gui/desktop/electron/app-store.ts`
  - app state now carries `managedRootPath` / `managedProjectsPath`
  - persisted managed-root selection is restored on startup
  - creating a project now always creates `<managed-root>/projects/<project-name>/`
- `apps/gui/desktop/electron/main.ts`
  - managed-root picker wired through IPC
  - workspace picker now starts from an import-oriented flow instead of normal arbitrary-folder opening

### Landed import/copy slice

- selecting an external folder through the GUI now imports it into the managed root instead of treating the outside path as the live workspace path
- imports currently copy into `<managed-root>/projects/<source-folder-name>/`
  - duplicate names auto-suffix (`foo`, `foo-2`, `foo-3`, ...)
- import copy is recursive and currently **rejects symlinks/junctions and other special filesystem entries** instead of reproducing them inside the managed root
- partially copied imports are cleaned up on failure
- state refresh/startup now filters visible workspaces to OfficeAgent-managed areas instead of arbitrary catalog entries

### Landed managed session/runtime layout foundation

- `packages/office-agent-runtime/src/index.ts`
  - now defines concrete session-layout helpers for:
    - `<managed-root>/.officeagent/sessions/<session-id>/profile/`
    - `<managed-root>/.officeagent/sessions/<session-id>/temp/`
    - `<managed-root>/.officeagent/sessions/<session-id>/npm-cache/`
    - `<managed-root>/.officeagent/sessions/<session-id>/npm-prefix/`
    - `<managed-root>/.officeagent/sessions/<session-id>/pip-cache/`
    - `<managed-root>/.officeagent/sessions/<session-id>/python-user-base/`
    - `<managed-root>/.officeagent/sessions/<session-id>/logs/`
  - now exposes managed session env construction helpers for later sandbox launch
- `packages/pi-sdk-driver/src/session-supervisor.ts`
  - managed workspaces now store session files under the managed root instead of under the old global agent session location
  - opening/creating a session now ensures the managed per-session runtime directory layout exists for that session id
- this is still **pre-sandbox plumbing**: the env layout now exists as repo/runtime structure, but current execution has not yet been forced to run inside those redirected dirs

### Landed import-oriented desktop API naming

- primary desktop IPC / preload / renderer calls now use import-oriented naming:
  - `importWorkspacePath(...)`
  - `pickImportFolder()`
- old `addWorkspacePath(...)` / `pickWorkspace()` entry points are still temporarily wired as compatibility aliases, but the intended product model is now explicit in the main desktop API surface

### Landed removal of obsolete git/worktree GUI paths

- desktop worktree creation/removal paths have been removed from the active GUI/electron flow
- new-thread creation is now local-only; there is no worktree environment selector in the GUI
- diff-panel / git-diff / stage-file desktop wiring has been removed from the active GUI/electron flow
- workspace rendering now treats projects as plain managed folders instead of repo/worktree hierarchies
- obsolete worktree/diff modules were reduced to inert stubs so they no longer participate in runtime behavior

### Landed OfficeAgent-controlled session runtime startup path

- `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts` now owns the default managed-workspace session runtime startup path
- managed-workspace sessions now:
  - detect their managed root from the workspace path
  - ensure the per-session runtime layout exists before startup
  - construct the managed session env (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, npm/pip redirects)
  - temporarily apply that env during session/runtime creation
  - replace default built-in coding tools with OfficeAgent-controlled tool definitions for managed workspaces
- current controlled tool definitions are still local-process implementations, but they are now the intended seam for the broker/Rust/AppContainer worker replacement
- the custom `bash` tool definition injects the managed session env into spawned shell processes
- custom file mutation/read tool definitions reject paths outside the OfficeAgent managed root before touching the local filesystem

### Landed Rust Windows sandbox helper scaffold

- added native Rust helper project at `native/windows-sandbox-helper/`
- added stdin/stdout JSON protocol for:
  - `selfTest`
  - `launch`
- launch request shape now captures the broker/helper contract fields needed for the first sandbox worker path:
  - executable
  - args
  - cwd
  - managedRoot
  - sessionDir
  - env
  - readOnlyPaths
  - writablePaths
  - timeoutMs
- helper validates that cwd/session/granted paths remain under the managed root before launch work proceeds
- added Electron-side helper wrapper at `apps/gui/desktop/electron/windows-sandbox-helper.ts`
- added desktop build script `apps/gui/desktop/scripts/build-windows-sandbox-helper.mjs`
- wired Windows package scripts to build the helper before `electron-builder`
- added `electron-builder.yml` extra resource packaging for `build/native/windows-sandbox-helper/`

### Landed first AppContainer + Job Object launch primitive

- Rust helper `launch` now performs the first real Windows launch path instead of returning `NOT_IMPLEMENTED`
- implemented:
  - stable AppContainer profile name derivation from managed root
  - AppContainer profile create-or-derive flow
  - inherited ACL grant for the AppContainer SID on managed root/session/writable paths
  - inherited read/execute ACL grant for read-only paths
  - `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`
  - suspended process creation
  - Job Object creation with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
  - assign-to-job before `ResumeThread`
  - timeout handling via `TerminateJobObject` and exit code `124`
  - `CREATE_NO_WINDOW` to prevent child output from corrupting helper JSON stdout
  - pid/exit-code JSON response
- smoke validation confirmed the helper builds and can create an AppContainer-launched process attached to the helper flow
- this is the first real OS-enforced primitive, but it is not yet wired to Pi tool execution or a sandboxed worker protocol

### Landed first sandbox-backed bash execution bridge

- added `packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts`
- managed-workspace `bash` tool execution now calls the Rust helper instead of spawning directly from the trusted host process
- bash bridge behavior:
  - creates per-command stdout/stderr log files under the managed session logs dir
  - asks helper to AppContainer-launch a shell process with cwd/session env/managed-root grants
  - helper redirects child stdout/stderr to managed session log files
  - bridge reads those logs and feeds the output back through Pi's normal `BashOperations.onData` path
- helper protocol now supports optional `stdoutPath` and `stderrPath`
- helper opens those output paths as inheritable handles and sets `STARTF_USESTDHANDLES`
- validated a managed-root command writes/reads inside the project through the AppContainer helper and returns output to the Pi bash operation

### Current bash compatibility finding

- Git Bash from `C:\Program Files\Git\bin\bash.exe` failed under AppContainer in local smoke testing with exit code `3221225794`
- attempting to grant the AppContainer SID read/execute access to `C:\Program Files\Git` failed with access denied (`SetNamedSecurityInfoW` error 5), which is expected for a non-admin portable app
- first bridge therefore defaults to AppContainer-compatible `cmd.exe` for the tool execution transport unless `OFFICE_AGENT_SANDBOX_BASH_PATH` is explicitly set
- this preserves the model-facing `bash` tool seam and OS boundary, but full Git Bash compatibility remains an open v1 workflow issue
- AppContainer may rewrite `%TEMP%` for launched processes to an AppContainer package temp path under the managed session profile, e.g. `<session>/profile/AppData/Local/Packages/<profile>/AC/Temp`; this still stays under the managed root but differs from the explicit `TEMP` value supplied by the broker
- current product decision: OfficeAgent should ship/stage its own Bash-compatible runtime so the `bash` tool works for every Windows user without relying on a machine-level Git install
- recommended direction: stage a vetted portable Git-for-Windows/MSYS2 runtime under an OfficeAgent-controlled path, grant the AppContainer SID read/execute access to that staged runtime, and point sandboxed `bash` at its `bash.exe`
- avoid relying on `C:\Program Files\Git` for sandboxed execution; non-admin portable installs cannot assume ACL control there

### Landed staged Bash runtime selection foundation

- added managed runtime layout helpers in `@office-agent/runtime`:
  - `getOfficeAgentRuntimeDir(...)`
  - `getOfficeAgentStagedGitBashDir(...)`
  - `getOfficeAgentStagedBashPath(...)`
  - `getOfficeAgentStagedGitBashCandidatePaths(...)`
- managed root creation now ensures `<managed-root>/.officeagent/runtime/`
- sandbox bash bridge now resolves shell in this order:
  1. direct `OFFICE_AGENT_SANDBOX_BASH_PATH` override
  2. `OFFICE_AGENT_STAGED_GIT_BASH_DIR` override containing `bin/bash.exe`, `usr/bin/bash.exe`, or `bash.exe`
  3. default staged runtime at `<managed-root>/.officeagent/runtime/git-bash/v1/`
  4. temporary `cmd.exe` fallback
- staged Git Bash runtime dirs are passed to the Rust helper as read/execute grants
- this prepares the product path where OfficeAgent ships/stages a vetted portable Git-for-Windows/MSYS2 runtime instead of relying on machine-level Git Bash
- added desktop staging script `apps/gui/desktop/scripts/stage-portable-git-bash.mjs`
- packaging now runs `build:portable-git-bash` before Windows `electron-builder`
- staging script supports:
  - `OFFICE_AGENT_PORTABLE_GIT_ARCHIVE=<path-to-PortableGit-*.7z.exe>` for offline/local builds
  - `OFFICE_AGENT_DOWNLOAD_PORTABLE_GIT=1` for download-based builds using the default Git for Windows PortableGit archive
  - optional `OFFICE_AGENT_PORTABLE_GIT_SHA256` verification
- staged package resource path is `apps/gui/desktop/build/runtime/git-bash/v1/`, packaged to `resources/runtime/git-bash/v1/`
- at runtime, the pi-sdk-driver can copy a packaged/bundled Git Bash runtime into `<managed-root>/.officeagent/runtime/git-bash/v1/` before launching sandboxed bash
- 2026-04-27 validation update: PortableGit downloaded and staged successfully, but `bash.exe` failed under AppContainer with `NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-...): 0xC0000022`
- this indicates MSYS2/Git Bash needs named-object behavior that our current AppContainer launch does not permit
- staged Git Bash use is now gated behind `OFFICE_AGENT_ENABLE_STAGED_GIT_BASH=1` while we investigate; default smoke remains on the `cmd.exe` fallback so the rest of the AppContainer primitive stays testable
- likely next investigation: AppContainer named object namespace support (`GetAppContainerNamedObjectPath` / BaseNamedObjects shadowing) or a non-MSYS Bash-compatible/runtime alternative

### Landed OfficeAgent Windows sandbox shell framing and managed command layer

- current v1 command transport still launches `cmd.exe` because it is the backend proven by the AppContainer smoke path
- Pi compatibility is preserved by keeping the internal tool name `bash` for now
- the managed-workspace command tool now presents itself as `OfficeAgent Windows shell`, not as plain Bash and not as an unrestricted Windows terminal
- model-facing description/guidelines now tell the agent to use Windows/cmd-style syntax, avoid Bash-only syntax, and not assume access to `C:\`, arbitrary user-profile folders, Program Files, PowerShell, Git Bash, arbitrary host tools, or POSIX paths
- `cmd.exe` is treated as a launcher/parser while OfficeAgent provides managed implementations for common commands that are unreliable under AppContainer
- landed managed command compatibility layer currently covers:
  - `dir`
  - `where`
  - `copy`
  - `move`
  - `del` / `erase`
  - `mkdir` / `md`
  - `rmdir` / `rd`
- this avoids common AppContainer shell quirks such as native `dir` failing with `Acceso denegado` because it touches denied root/volume metadata even when project directory enumeration is allowed
- this is the first step toward an eventual `exec` / `process` command model and persistent sandbox worker without risking immediate Pi/UI/transcript breakage

### Landed sandbox env allowlist with host `PATH` compatibility

- sandboxed bash launch no longer receives arbitrary merged `process.env`
- environment is now constructed from an explicit allowlist plus managed session redirects
- 2026-04-27 policy update after Codex implementation review: inherit the host `PATH` for developer-tool compatibility, but **do not** inherit the full host environment
- inherited host `PATH` entries are normalized, de-duped, filtered to existing absolute directories, copied into sandbox `PATH`/`Path`, and passed to the helper as best-effort read/execute grants
- `PATHEXT`, `SystemRoot`, and `ComSpec` remain explicitly supplied for Windows command resolution
- `OFFICE_AGENT_SANDBOX_INHERIT_HOST_PATH=0` disables host `PATH` inheritance for debugging/regression comparison
- intentionally excluded from sandbox command env:
  - OfficeAgent gateway token
  - arbitrary provider/API credentials
  - arbitrary host environment variables except selected Windows/toolchain compatibility keys
- smoke test now checks that the default OfficeAgent gateway token is not visible inside the sandbox command environment
- accepted compatibility tradeoff: commands can discover and attempt to execute tools on the user's host `PATH`; AppContainer write confinement and managed profile/temp/cache redirects remain the v1 boundary, while read/execute exposure to host tool directories is intentionally broader than the earlier staged-only plan

### Accepted temporary risk: extensions/packages not sandbox-limited yet

- current product decision: do not spend implementation time now on disabling/limiting Pi user/project extensions or package resources
- accepted risk: untrusted project/user extensions or package-loaded JS may still execute in the trusted host process and can bypass the AppContainer command boundary
- this means current sandboxing work should be described as command/process containment progress, not a complete untrusted-project sandbox
- revisit before any security-sensitive or adversarial-project release; the likely future policy remains admin-shipped/built-in extensions only for hardened sandbox mode

### Landed standalone sandbox smoke test harness

- added `apps/gui/desktop/scripts/smoke-windows-sandbox.mjs`
- added root script `npm run sandbox:smoke`
- the smoke test builds runtime, pi-sdk-driver, and the Rust helper, then exercises the sandbox without launching the GUI
- current checks:
  - helper `selfTest`
  - AppContainer-backed command writes/reads inside managed project
  - managed command compatibility for `dir`, `where`, `copy`, `move`, `del`, `mkdir`, `rmdir`, redirection, quoted paths, and missing-command behavior when the staged Python runtime is available
  - temp path remains inside managed root
  - OfficeAgent gateway token is not visible inside sandbox command env
  - outside-root write attempt does not create the target
  - outside-root read attempt does not leak file contents
  - long-running command is killed by helper timeout/job path and returns `124`
- this gives the agent/dev loop a self-contained verification path before GUI packaging/e2e tests

### Landed diagnostic workflow smoke harness

- added `apps/gui/desktop/scripts/smoke-windows-sandbox-workflows.mjs`
- added root script `npm run sandbox:smoke:workflows`
- this smoke is diagnostic by default and can be made strict with `OFFICE_AGENT_SANDBOX_WORKFLOW_SMOKE_STRICT=1`
- current expected diagnostic behavior with the default `cmd.exe` backend:
  - sandbox command containment still works
  - `node`, `npm`, `python`, and `git` should be discoverable when they are installed on the host `PATH` and readable/executable from the AppContainer
  - host `PATH` read/execute grants are best-effort because non-admin portable apps may not be able to modify ACLs on protected tool directories such as some `Program Files` locations; the workflow smoke should expose which toolchains actually work on the machine
- 2026-04-27 first run after host `PATH` inheritance:
  - sandbox smoke still passes
  - user-profile Python 3.13 is discoverable and `python --version` succeeds
  - Node/npm from `C:\Program Files\nodejs` still do not execute (`node` not recognized / npm access-denied path), likely because non-admin AppContainer ACL grants on protected `Program Files` tool directories are best-effort and may fail
  - Git for Windows is discoverable but `git` fails with `/dev/null` permission behavior under AppContainer, consistent with earlier MSYS/Git Bash compatibility concerns
  - Python venv creation sees the host Python but fails resolving/bootstrapping the real Python install inside AppContainer
- implication: v1 now prioritizes Codex-style host toolchain compatibility over staged-only purity, while preserving the curated non-secret environment and managed-root write boundary; however, AppContainer still needs staged/bundled or elevated-granted toolchains for common `Program Files` installs to become reliable

### Landed OfficeAgent-staged Python + uv runtime path

- added OfficeAgent-managed runtime helpers for Python and uv under `<managed-root>/.officeagent/runtime/`
- added desktop staging scripts:
  - `apps/gui/desktop/scripts/stage-python-runtime.mjs`
  - `apps/gui/desktop/scripts/stage-uv-runtime.mjs`
- Python staging supports local archives or download from Astral `python-build-standalone`:
  - `OFFICE_AGENT_PYTHON_RUNTIME_ARCHIVE`
  - `OFFICE_AGENT_DOWNLOAD_PYTHON_RUNTIME=1`
  - `OFFICE_AGENT_PYTHON_RUNTIME_SHA256`
  - `OFFICE_AGENT_PYTHON_VERSION`
  - `OFFICE_AGENT_PYTHON_BUILD_STANDALONE_RELEASE`
  - `OFFICE_AGENT_PYTHON_RUNTIME_PACKAGING_REVISION`
- uv staging supports local archives or download from Astral uv releases:
  - `OFFICE_AGENT_UV_ARCHIVE`
  - `OFFICE_AGENT_DOWNLOAD_UV=1`
  - `OFFICE_AGENT_UV_SHA256`
  - `OFFICE_AGENT_UV_VERSION`
  - `OFFICE_AGENT_UV_PACKAGING_REVISION`
- packaged app resources are copied from:
  - `apps/gui/desktop/build/runtime/python` -> `resources/runtime/python`
  - `apps/gui/desktop/build/runtime/uv` -> `resources/runtime/uv`
- runtime discovery also supports development/build paths plus:
  - `OFFICE_AGENT_BUNDLED_PYTHON_RUNTIME_DIR`
  - `OFFICE_AGENT_BUNDLED_UV_RUNTIME_DIR`
- staged runtimes are copied into the managed root side-by-side by runtime id, with `current.json` manifests
- shared runtime dirs and shim dirs are granted read/execute only; sandbox writes remain limited to the project cwd and per-session dirs
- sandbox `PATH` now prefers OfficeAgent-staged Python/uv ahead of host tools
- managed session env now supplies mutable package/tool state under the session dir:
  - `PIP_CACHE_DIR`
  - `PYTHONUSERBASE`
  - `UV_CACHE_DIR`
  - `UV_TOOL_DIR`
  - `UV_TOOL_BIN_DIR`
  - `UV_PYTHON_INSTALL_DIR`
  - `UV_PYTHON_BIN_DIR`
- `pip` remains real pip, not remapped to uv; the pip shim only injects `--user` for bare `pip install ...` outside a virtualenv
- `UV_PYTHON` points at OfficeAgent Python and uv Python auto-downloads are disabled by default with `UV_PYTHON_DOWNLOADS=manual`
- Python `venv` and temp-file behavior needed AppContainer-specific compatibility shims:
  - `python.cmd`/`python3.cmd` route through `python-shim.py`
  - `python -m venv` is implemented as `venv --without-pip` followed by explicit `ensurepip` so the managed `sitecustomize.py` remains active for temp handling
  - `sitecustomize.py` redirects Python temp behavior to the managed session temp dir and works around AppContainer ACL inheritance problems for Python-created temp dirs/files
- real uv currently hits AppContainer `NUL`/child-process compatibility issues when inspecting Python (`Access denied`), so `uv.cmd` routes common day-1 flows through an OfficeAgent uv compatibility shim:
  - `uv --version` still delegates to bundled uv
  - `uv python find` reports OfficeAgent Python
  - `uv venv`, `uv pip ...`, and `uv run python ...` use the OfficeAgent Python/pip-backed workflow
  - unsupported uv subcommands now fail with a clear OfficeAgent strict-sandbox message instead of unpredictably falling through to native uv
- local strict validation is now green for the Python/uv smoke path with staged Python `3.13.13+20260408` and uv `0.11.8`
- known limitation: python-build-standalone currently emits `Failed to find real location of ...python.exe` warnings under AppContainer; sandbox command output filters this warning from agent-visible stdout/stderr, and workflows pass
- license/notice handling now has an initial root/package notice in `THIRD_PARTY_NOTICES.md`, but it still needs legal review before external distribution
- known product follow-ups: clean-Windows VC runtime validation and deciding whether to keep the current Python `sitecustomize.py` compatibility strategy or replace it with a lower-level helper/ACL strategy

### Future task: real uv under AppContainer

The current `uv.cmd` shim intentionally handles common day-1 workflows (`uv python find`, `uv venv`, `uv pip ...`, and `uv run python ...`) through the OfficeAgent Python-backed compatibility path. This keeps user workflows green, but it is not the same as claiming full native uv compatibility.

Future work should investigate and fix the underlying AppContainer compatibility issue where real uv fails while inspecting/spawning Python with `Access denied (os error 5)`, likely related to Windows `NUL` / stdio / child-process behavior inside AppContainer. Once fixed, reduce or remove the uv compatibility shim and let real uv own those flows directly.

### Important remaining gaps before product-model lock-in is complete

- compatibility aliases (`addWorkspacePath` / `pickWorkspace`) still exist and should eventually be removed after dependent tests/helpers are migrated
- some dead repo/worktree-oriented artifacts may still remain in non-runtime areas (tests/docs/styles/helpers) and should be cleaned up opportunistically
- runtime/resource loading and file tool definitions still run in the trusted host process; file read/write/edit are not yet brokered through a sandbox worker
- current TypeScript path checks are defense-in-depth only for file tools
- Rust helper is now in the managed `bash` execution path, but the bridge is one-command-at-a-time and log-file based rather than a persistent sandboxed worker protocol
- real sandbox compatibility remains unverified for current Node/Pi/Python/npm workflows until worker execution and shell/runtime packaging decisions are hardened
- cleanup after the robust sandbox/runtime-state work lands: remove temporary compatibility hacks that become obsolete (Python temp/sitecustomize workaround if no longer needed, uv compatibility shims once real uv works, legacy per-session package-state paths, and any tool-specific ACL repair/retry code)

---

## 2026-04-29 rethink: stop making the shell artificially small

### Problem statement

The current sandbox path is drifting toward an overly curated command environment:

- the model-facing tool says the command backend is an `OfficeAgent Windows shell`, not a normal terminal
- prompt guidance tells the agent not to assume PowerShell, Git Bash, arbitrary host tools, `Program Files`, or broad Windows paths
- the transport defaults to `cmd.exe`, but OfficeAgent rewrites several common commands (`dir`, `where`, `copy`, `move`, `del`, `mkdir`, `rmdir`) into managed shims
- Python and uv have additional compatibility shims

This kept the early AppContainer smoke path green, but it also **dumbs down the agentic experience**. Agents are best when they can use the real local operating-system affordances: `cmd`, PowerShell, `pwsh`, package managers, build tools, scripts, and normal command composition. If the sandbox is real, we should not need to protect the machine by forbidding normal shell usage at the tool layer.

The better product goal is:

> Let the agent attempt normal Windows commands inside an OS-enforced sandbox. If a command tries to read/write/execute something the sandbox cannot access, Windows should return the permission/file-not-found/process failure, and the agent should adapt.

### Key distinction

We should separate two things that are currently blended together:

1. **Security boundary**
   - AppContainer token
   - ACL grants for managed root/session/runtime/toolchain paths
   - low-integrity behavior
   - Job Object process-tree supervision
   - curated non-secret environment
2. **Convenience/compatibility layer**
   - command shims
   - staged Python/uv wrappers
   - Git Bash/MSYS workarounds
   - friendly error messages

The first one is the sandbox. The second one should be optional and minimal. If the compatibility layer becomes a command allowlist or a fake shell, we lose the main value of an agentic desktop tool.

### Current implementation read

Important current facts from the repo:

- `native/windows-sandbox-helper/src/platform.rs` already accepts an arbitrary `executable` and `args`; validation requires `cwd`, `sessionDir`, writable/output paths to stay under the managed root, but it does **not** inherently restrict commands to a small vocabulary.
- The real restriction is mostly in the TypeScript bridge and prompt framing:
  - `packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts` resolves the shell to Git Bash override/staged Git Bash when enabled, otherwise `C:\Windows\System32\cmd.exe`.
  - `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts` tells the model not to assume PowerShell or arbitrary host tools.
  - `rewriteCmdManagedCommands(...)` replaces selected `cmd` built-ins with OfficeAgent shims when using the `cmd` backend.
- The helper already launches under AppContainer and attaches the process to a Job Object. That is the primitive we should lean into.

So the next design move should not be “add more managed commands”. It should be “make the sandbox launcher a general process runner”.

### Recommended product posture

Change the model-facing promise from:

> Here is a restricted OfficeAgent shell with a small managed command compatibility surface.

To:

> Here is a Windows process runner inside the OfficeAgent sandbox. You may run normal `cmd.exe`, `powershell.exe`, `pwsh.exe`, or project/toolchain commands. The OS sandbox decides what succeeds.

The agent should be allowed to try, for example:

```cmd
cmd.exe /d /s /c "dir && npm test"
```

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-ChildItem; npm test"
```

```powershell
pwsh.exe -NoLogo -NoProfile -NonInteractive -Command "Get-ChildItem; python -m pytest"
```

If `pwsh.exe` is not installed, not on PATH, or cannot run in AppContainer, that should be a normal command failure. If PowerShell tries to read outside the managed root, Windows/AppContainer should deny it. If a tool on host PATH cannot execute because its installation directory cannot be granted to the AppContainer, the agent sees that failure and can use staged/bundled tools instead.

### What should remain restricted

“Run any command” should mean **any command inside the sandbox**, not unrestricted host execution.

Keep these constraints:

- launch all model-executed processes through the Rust helper/AppContainer path
- keep cwd/session/output paths under the managed root
- keep mutable env/profile/temp/cache locations under the managed root
- do not pass provider/gateway/API credentials into the command environment
- keep Job Object kill-on-close / timeout behavior
- only grant read/execute access to explicit runtime/toolchain/system paths
- keep write access limited to managed root/session paths
- keep trusted GUI/import flows responsible for bringing external data into the managed root

The OS can only return meaningful permission errors if the process is actually sandboxed. Direct host `powershell.exe`/`cmd.exe` from Electron/Node would be a regression.

### What should be relaxed

Relax these constraints:

- stop telling the model that PowerShell is unavailable
- stop implying `cmd.exe` is the only valid command grammar
- stop growing the managed command vocabulary as a substitute for the OS shell
- stop treating failures from real commands as product-policy failures when they are ordinary sandbox/Windows failures
- allow explicit shell selection or direct executable launch

The compatibility shims should be for known AppContainer bugs and bundled runtime bootstrapping, not for deciding what commands the agent is morally allowed to run.

### Suggested architecture change: `exec` as the real primitive

Introduce a lower-level sandbox execution primitive with roughly this shape:

```ts
type SandboxExecRequest = {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdoutPath?: string;
  stderrPath?: string;
};
```

Then build thin shell adapters on top:

- `cmd`: `cmd.exe /d /s /c <command>`
- Windows PowerShell: `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>`
- PowerShell 7: `pwsh.exe -NoLogo -NoProfile -NonInteractive -Command <command>`
- direct exec: run `<executable> <args...>` with no shell parser

Pi compatibility can keep the internal tool name `bash` temporarily if needed, but OfficeAgent should conceptually expose a sandboxed Windows `exec`/`shell` tool, not a fake Bash or fake cmd subset.

### Recommended prompt/tool wording

Replace the current restrictive guidance with something closer to:

- “Commands run inside an OfficeAgent Windows AppContainer sandbox.”
- “You may use `cmd.exe`, `powershell.exe`, `pwsh.exe`, or direct project/tool commands.”
- “Prefer commands that operate within the current project/managed root.”
- “If Windows returns access denied / file not found / command not recognized, treat it as the sandbox or installed-tool reality and adapt.”
- “Do not ask for host-level access unless the user explicitly imports files or changes product policy.”

Avoid saying:

- “Do not assume PowerShell.”
- “Do not assume arbitrary host tools.”

A better nuance is:

- “You may try host tools visible on PATH, but they may fail if they are not installed or not executable from the sandbox.”

### Managed command shims: downgrade from default behavior to fallback/debug aid

The current managed `dir`/`copy`/etc. layer was useful because native `cmd.exe` built-ins hit AppContainer oddities. But long term it is risky because it creates a parallel pseudo-shell.

Recommended policy:

1. First try the real requested command through the real shell.
2. Let Windows/AppContainer errors surface naturally.
3. Use OfficeAgent shims only for:
   - explicit `oa ...` helper commands, or
   - tightly scoped compatibility wrappers for bundled runtimes where we understand the bug.
4. Do not silently rewrite broad shell syntax unless a smoke test proves there is no better option.

This preserves agent freedom while still letting us patch known runtime-specific problems.

### PowerShell-specific considerations

PowerShell is powerful, but that is exactly why the OS sandbox matters. Inside AppContainer it should still be constrained by:

- filesystem ACL/AppContainer access checks
- low-integrity behavior
- registry/device/app access limitations
- curated environment
- Job Object process-tree lifetime

Recommended first test path:

- launch Windows PowerShell from `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
- use `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass`
- set `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, and `TMP` to the managed session dirs
- verify:
  - `Get-ChildItem` inside project succeeds
  - outside-root read fails without leaking content
  - outside-root write fails
  - child `Start-Process` descendants are killed by the Job Object
  - no host secrets are visible in `$env:`
  - module/profile loading does not reach real user profile paths

For `pwsh.exe`, do not require it as a v1 dependency. Resolve it from staged runtime or PATH and let command-not-found be a normal failure. Later, if PowerShell 7 is important, consider staging a vetted portable pwsh runtime just like Python/uv.

### Toolchain compatibility implication

This “run anything and let Windows decide” posture makes staged/bundled toolchains more important, not less.

Host PATH compatibility is useful, but protected locations such as `Program Files` can be hard to ACL-grant from a non-admin portable app. Therefore:

- allow trying host PATH tools
- keep staged OfficeAgent runtimes first on PATH for reliability
- treat host tool failures as normal sandbox compatibility outcomes
- do not hide those failures behind a fake command subset

### Security caveat

This change improves usability, but it does **not** complete the untrusted-project sandbox story by itself. The already accepted gaps still matter:

- file tools currently run in the trusted host process with TypeScript path checks
- arbitrary Pi extensions/packages can still execute trusted JS unless locked down
- current command bridge is one-command-at-a-time and log-file based

If we let agents run richer shells, these gaps become more visible. The answer is not to shrink shell capability again; the answer is to move file tools and extension/package execution behind the same sandbox/broker model.

### Recommended next implementation slice

1. Add a sandbox `exec` abstraction in `packages/pi-sdk-driver` that maps directly to the Rust helper `launch` request.
2. Add shell adapters for `cmd`, `powershell`, `pwsh`, and direct executable launch.
3. Update the managed runtime prompt text to allow PowerShell/cmd/direct commands and explain OS-enforced failures.
4. Stop silently rewriting normal `cmd` commands by default; keep shims only behind an explicit fallback flag or `oa` helper command.
5. Add smoke tests for:
   - `cmd.exe /c ...`
   - `powershell.exe -Command ...`
   - optional `pwsh.exe -Command ...` when present
   - outside-root read/write denial from each shell
   - env secret absence from each shell
   - child-process cleanup from each shell
6. After command execution is OS-first, prioritize moving file read/write/edit operations into the sandbox/broker path.

### Updated conclusion

The sandbox should not be a small, OfficeAgent-invented command language. It should be a Windows sandboxed process boundary. Agents should be free to run normal `cmd`, PowerShell, `pwsh`, and project/toolchain commands. Windows/AppContainer should be the thing that says “access denied”, “not found”, or “this executable cannot run here”. OfficeAgent should focus on making that boundary real, observable, and recoverable rather than preemptively narrowing the agent’s command vocabulary.

### 2026-04-29 implementation update: transparent launch by default

Landed first pass toward the transparent-launch model:

- `packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts`
  - command scripts now pass the requested command through unchanged by default
  - the old managed `cmd` command rewrite layer is now behind `OFFICE_AGENT_ENABLE_MANAGED_CMD_SHIMS=1`
  - added `OFFICE_AGENT_SANDBOX_DEFAULT_SHELL=powershell|windows-powershell|pwsh` selection
  - PowerShell backends write the requested command to a `.ps1` file and launch real `powershell.exe`/`pwsh.exe` with non-interactive flags
- `packages/pi-sdk-driver/src/office-agent-managed-runtime.ts`
  - prompt/tool wording now describes a Windows AppContainer sandbox exec, not a fake OfficeAgent shell
  - model guidance now allows `cmd.exe`, `powershell.exe`, `pwsh.exe`, and normal project/toolchain commands
- `apps/gui/desktop/scripts/smoke-windows-sandbox.mjs`
  - smoke now records native `cmd` and PowerShell compatibility diagnostics
  - `OFFICE_AGENT_SANDBOX_REAL_SHELL_STRICT=1` makes those diagnostics hard failures

Validation:

- `npm run build --workspace @pi-gui/pi-sdk-driver` passes
- `cargo build --manifest-path native/windows-sandbox-helper/Cargo.toml` passes
- `npm run sandbox:smoke` passes in non-strict mode

Important finding from the smoke run:

- transparent launch works for basic `cmd` execution such as `echo`, `type`, inside-root writes, outside-root denial, env filtering, and timeout/job cleanup
- native `cmd` built-ins such as `dir /b` still return `Acceso denegado` under AppContainer on this machine
- Windows PowerShell `Get-ChildItem` also fails while initializing/defaulting the filesystem drive, reporting denied/missing `C:\`

This confirms the architectural point: the fake command layer is no longer default, but AppContainer compatibility for real Windows shell built-ins is still a real sandbox-engine problem. The next fix should be at the sandbox/process environment layer, not by silently reintroducing OfficeAgent command emulation.

### 2026-04-29 follow-up: ancestor read/traverse ACL experiment

We investigated the natural next fix: grant the AppContainer SID non-inherited metadata/traverse access on the parent chain and/or drive root, while keeping real read/write confined to the managed root.

Target rights were intentionally narrower than read-only content access:

- `FILE_TRAVERSE`
- `FILE_READ_ATTRIBUTES`
- `READ_CONTROL`
- `SYNCHRONIZE`
- no `FILE_LIST_DIRECTORY`
- no `FILE_READ_DATA`
- no write/delete/create rights

Findings:

- granting this kind of access to `C:\Users\...\AppData\Local\Temp` completed quickly
- attempting to apply the same ACL update to `C:\Users\...\AppData\Local` hung inside the native ACL update path on this machine and caused the helper request watchdog to fire
- granting only the drive root / top-level ancestor was safe but did not fix `dir`/PowerShell because the full path/provider chain still lacks enough access
- therefore we did **not** leave broad parent-chain ACL granting enabled by default

Conclusion:

- the idea is directionally correct, but mutating ACLs on existing profile/system ancestor folders from a non-admin portable helper is not currently safe enough to do synchronously per command/session
- if we want this approach, we need a safer grant strategy, probably one of:
  - provision the managed root in a location where OfficeAgent owns the needed ancestor chain
  - apply parent-chain grants once during trusted setup with explicit progress/error handling
  - use a helper/elevated/admin-installed component for machine/profile-level ACL preparation
  - avoid shell provider paths that require `C:\`/profile ancestor access, if possible

The current landed code keeps the transparent launch model and diagnostic smoke behavior, but does not enable unsafe ancestor ACL mutation by default.

### 2026-04-29 low-integrity pivot and Public OfficeAgentData root

We pivoted from the strict AppContainer read-confined model to a compatibility-first Windows model:

- commands run as the same Windows user at Low integrity
- normal Windows shell/tool behavior is preserved much better than AppContainer
- OfficeAgentData/session/project dirs get a Low mandatory label so Low-integrity children can write there
- outside OfficeAgentData stays normal integrity, so Low-integrity children should be blocked from writes by MIC

Important discovery:

- `%USERPROFILE%\OfficeAgentData` is **not** a good default for Low integrity on this machine
- Low-integrity children can read/list `C:\Users` and `C:\Users\Public`, but they cannot list/read inside `C:\Users\<user>` even when running as that user
- this means a Low-integrity command launched with cwd under `%USERPROFILE%\OfficeAgentData` still gets `Acceso denegado` for normal operations
- moving the managed root under `C:\Users\Public\OfficeAgentData\<user-key>` fixes the practical command behavior without requiring ACL mutations on the user's profile directory

Current default-root decision:

- default managed root is now `%PUBLIC%\OfficeAgentData\<domain_user>`
- first-run GUI state auto-provisions this default managed root if no persisted root exists
- the managed-root picker opens at the same default path
- sandbox smoke now creates temporary roots as `%PUBLIC%\OfficeAgentData-smoke-*`
- existing persisted roots are still respected for now, but roots under `%USERPROFILE%` may not work well with Low-integrity command execution

Implementation work landed:

- helper protocol supports `sandboxMode: "appContainer" | "lowIntegrity"`
- helper default is now `lowIntegrity`
- TypeScript command bridge defaults to `lowIntegrity`; `OFFICE_AGENT_SANDBOX_MODE=appcontainer` opts back into strict AppContainer
- Low-integrity launch path uses a duplicated primary token with `TokenIntegrityLevel = Low`
- managed root/session/writable paths get Low mandatory labels
- Job Object cleanup and stdout/stderr capture remain in place
- command scripts are used again for `cmd`/PowerShell so normal quoting works; this is still a transparent shell launch, not command emulation
- OfficeAgent read tool now allows broad reads, while write/edit remain confined to the managed root

Validation after moving smoke roots to `%PUBLIC%`:

- `dir /b` works
- `type inside.txt` works
- redirection/write inside project works
- `mkdir`, quoted paths, `copy`, `move`, `del`, and `rmdir` work in native `cmd`
- PowerShell `Get-ChildItem` works when invoked through the command runner
- writes outside the managed area are blocked in smoke
- command env still does not expose the OfficeAgent gateway token
- timeout/job cleanup still works
- reading normal system files such as `C:\Windows\win.ini` works

Important limitation / product wording:

- this is now a **write containment** model, not a strict confidentiality/read containment model
- Low-integrity commands can read many normal system/public files
- on this machine, Low-integrity commands still cannot read the user's private profile folders such as `C:\Users\<user>\Desktop`; Windows denies those independently
- therefore the honest product claim is: agents run real Windows commands with reduced integrity, can modify OfficeAgentData, and are blocked from modifying normal user/system locations; reads outside OfficeAgentData are allowed where Windows permits them

## 2026-04-29 implementation update: private-profile roots tested

We attempted to move the default managed root from the working Public-based root to a private per-user profile root.

Tested candidates:

- `%USERPROFILE%\AppData\LocalLow\OfficeAgentData`
- `%USERPROFILE%\OfficeAgentData`

Result:

- `%USERPROFILE%\AppData\LocalLow\...` still failed for the current Low Integrity launch model on this machine.
- The failure reproduced even though the folder showed a Low mandatory label and inherited the current user's Full Control ACE.
- Low Integrity child processes could start with cwd under the LocalLow tree, but direct filesystem operations against `LocalLow`, the managed root, and the project folder returned `ERROR_ACCESS_DENIED`.
- Therefore LocalLow cannot currently be treated as a confirmed working fix for real `cmd`/PowerShell UX.

Observed LocalLow failure examples:

```text
cwd=Ok("C:\\Users\\Dario Costa\\AppData\\LocalLow\\OfficeAgentData-smoke-...\\projects\\demo")
metadata(projectDir)=ERROR_ACCESS_DENIED
read_dir(projectDir)=ERROR_ACCESS_DENIED
write(projectDir\\probe-write.txt)=ERROR_ACCESS_DENIED
cmd inside smoke: Acceso denegado.
```

We also prototyped a Windows `CreateRestrictedToken(..., WRITE_RESTRICTED, ...)` path because it is conceptually closer to the desired policy:

- normal user-profile reads
- writes require both the user's normal DACL access and an OfficeAgent-granted restricting SID
- no Low Integrity traversal wall

However the first prototype is **not enabled by default** because child processes failed during startup (`0xC0000142` / `0xC0000022`) before command code ran. It needs deeper Windows token/object namespace work before it can replace the Low Integrity model.

Current confirmed passing model remains:

- default sandbox mode: Low Integrity
- default managed root: `%PUBLIC%\OfficeAgentData\<domain_user>`
- commands: real `cmd.exe` / PowerShell / tools, launched through the native helper
- write policy: writes inside the managed root work; writes outside are blocked by MIC
- read policy: reads are allowed where Windows permits

Smoke status after this investigation:

```text
npm run sandbox:smoke  # passes
npm run build --workspace @office-agent/gui  # passes
```

Decision impact:

- If private-profile storage is mandatory, we need either:
  1. a working write-restricted-token implementation, or
  2. a different Windows-native broker/worker design.
- We should not claim LocalLow works until the startup self-test passes on the target machine.

## 2026-04-29 implementation update: write-restricted private root is now active

OfficeAgent has moved to a single Windows command sandbox model:

```text
Command token: Medium Integrity restricted token
Restriction:   CreateRestrictedToken(..., WRITE_RESTRICTED, ...)
Data root:     %LOCALAPPDATA%\OfficeAgent\AgentData
Shell UX:      real cmd.exe / PowerShell / tools
Reads:         normal user reads where Windows permits
Writes:        allowed only where the OfficeAgent restricting SID is granted
```

The previous active Low Integrity/AppContainer product paths were removed from the helper protocol and launch dispatch. The helper now always uses the write-restricted model for launch requests.

Important implementation details:

- The managed root default is now `%LOCALAPPDATA%\OfficeAgent\AgentData`.
- The native helper creates a deterministic OfficeAgent restricting SID from the managed-root path.
- Before launch, the helper grants that restricting SID writable access on:
  - managed root
  - session dir
  - command cwd/writable paths
  - stdout/stderr parent dirs
- The restricted token includes:
  - the OfficeAgent root restricting SID
  - the current logon SID
  - Everyone SID
- The logon/Everyone SIDs were needed for real shell/PowerShell startup compatibility. Without them, cmd/PowerShell startup hit access-denied / DLL-init style failures.
- The token default DACL is set so child-created IPC/pipes/default objects are usable under the restricted token.
- `STARTUPINFO.lpDesktop` is set to `winsta0\default`, following the Codex lesson that PowerShell can fail with `STATUS_DLL_INIT_FAILED` if a restricted-token launch has no desktop.
- The process remains Medium Integrity; no Low mandatory labels are applied.
- Command execution remains a real shell/script launch, not command emulation.
- Managed cmd shims are no longer active; command rewriting is removed from the command path.

Validated:

```text
cargo build --manifest-path native/windows-sandbox-helper/Cargo.toml
npm run build --workspace @office-agent/runtime
npm run build --workspace @pi-gui/pi-sdk-driver
npm run build:sandbox-helper --workspace @office-agent/gui
OFFICE_AGENT_SANDBOX_REAL_SHELL_STRICT=1 npm run sandbox:smoke
npm run build --workspace @office-agent/gui
```

Smoke now uses `%LOCALAPPDATA%\OfficeAgent\AgentData-smoke-*` and confirms:

- real cmd backend works
- `dir /b` works
- redirection works
- inside writes work
- copy/move/del/mkdir/rmdir work
- quoted paths work
- PowerShell `Get-ChildItem` works
- TEMP is redirected inside managed root
- writes outside managed root are blocked for the tested outside targets
- normal system reads work
- outside reads are allowed where Windows permits
- gateway token is not visible in sandbox env
- timeout/job cleanup works

Security wording remains important:

```text
This is write containment, not read confinement.
Agents may read files outside AgentData where Windows permits.
Network remains allowed.
The correct user promise is: agents can modify only OfficeAgent AgentData, not that agents can only see OfficeAgent AgentData.
```

## 2026-04-29 implementation update: PowerShell-first command context

OfficeAgent now resolves the managed command backend in this order:

```text
1. `pwsh.exe` on PATH, if installed
2. built-in Windows PowerShell (`powershell.exe`)
3. `cmd.exe` as last fallback
```

Overrides remain available through `OFFICE_AGENT_SANDBOX_DEFAULT_SHELL=pwsh|powershell|windows-powershell|cmd` and `OFFICE_AGENT_SANDBOX_PWSH_PATH` for explicit `pwsh` location.

The runtime now injects the actual loaded command backend into the agent context using supported Pi mechanisms:

- tool `promptGuidelines` for the OfficeAgent command tool
- `DefaultResourceLoader.appendSystemPromptOverride` for managed sessions

The injected context explicitly says that the tool named `bash` is OfficeAgent Windows shell exec and reports the actual backend, executable path, and invocation style. Example content:

```text
The tool named `bash` is currently OfficeAgent Windows shell exec, not necessarily GNU Bash.
Actual backend: pwsh (C:\Program Files\PowerShell\7\pwsh.exe).
Commands are launched as: pwsh.exe -NoLogo -NoProfile -NonInteractive -File <script.ps1>.
Use PowerShell syntax by default. Use cmd.exe /d /q /c "..." when cmd semantics are needed.
```

This should avoid the previous GUI confusion where the model saw a tool named `bash`, the actual backend was `cmd.exe`, and bare `pwd` failed even though `pwd` works in PowerShell.

Validated:

```text
npm run build --workspace @pi-gui/pi-sdk-driver
OFFICE_AGENT_SANDBOX_REAL_SHELL_STRICT=1 npm run sandbox:smoke
npm run build --workspace @office-agent/gui
```

Smoke confirmed the default backend on this machine is now:

```text
C:\Program Files\PowerShell\7\pwsh.exe
```

## 2026-05-08 direction: project-scoped tool state and Windows sandbox v2

The Python/pip ACL failures showed that per-session package directories and inherited ACEs are not enough for a robust package-manager experience.

Current direction:

- package/tool state should be project-scoped, not session-scoped
- temp/log/profile should remain session-scoped
- new writable roots should be explicit inputs to the sandbox helper
- the long-term Windows sandbox should move toward a Codex-inspired execution identity model instead of relying solely on inherited ACLs for a synthetic restricting SID
- avoid piling on new tool-specific repair hacks; remove temporary shims once the identity model makes them obsolete

Detailed direction: [`windows-sandbox-v2-codex-inspired.md`](./windows-sandbox-v2-codex-inspired.md).

Final refactor/redesign plan: [`windows-sandbox-codex-aligned-redesign.md`](./windows-sandbox-codex-aligned-redesign.md).
