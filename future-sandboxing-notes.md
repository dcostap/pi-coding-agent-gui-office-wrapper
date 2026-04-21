# Future Sandboxing Notes

Date: 2026-04-21
Project: `C:\Projects\office-gui-for-agentic-ai`

## Status

This is **future work**, not part of the current demo build.

Current OfficeAgent behavior is still:

- gateway-side model control on A
- best-effort client behavior on B
- no OS-backed local execution sandbox yet

That is acceptable for the current prototype and boss demo, but it is **not** the final local safety model we eventually want.

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

- restricted token / ACL-based sandboxing first
- possibly stronger elevated helper modes later
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

## Open questions for later implementation

1. Do we want one sandbox per workspace, per session, or per command?
2. Do we want a restricted-token-only first version, or a stronger helper/orchestrated Windows sandbox?
3. How should writable roots be modeled?
   - workspace root only
   - workspace + temp area
   - workspace + selected extra roots
4. How should approvals interact with sandbox escape requests?
5. How do we want Pi tool semantics to map onto the sandbox broker?
   - only `bash`
   - or also `read` / `write` / `edit` / `grep` / `find`
6. Do we eventually want an `externalSandbox`-style contract between our runtime and the agent layer?

---

## Immediate next step when we return to this topic

Before implementing anything, do a focused Codex source pass on:

- `codex-rs/sandboxing/`
- `codex-rs/windows-sandbox-rs/`
- `codex-rs/core/src/windows_sandbox.rs`
- `codex-rs/app-server/README.md` sandbox sections

and then write an OfficeAgent-specific design deciding:

- target Windows enforcement mechanism
- policy model
- writable-root model
- escalation behavior
- integration point in our GUI/TUI shared runtime
