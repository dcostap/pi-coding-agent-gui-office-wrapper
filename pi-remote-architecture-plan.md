# Pi Managed Split-Host Architecture Plan

Date: 2026-04-20
Project: `C:\Projects\office-gui-for-agentic-ai`

## Final agreed direction

We have now converged on the architecture we want.

### Bottom line

Run the **full stock Pi UI locally on computer B**.

Keep **all real provider credentials, OAuth sessions, API keys, model routing, and upstream model choice on computer A**.

Expose exactly **one abstract model** to the user on B, for example:

- provider: `corp`
- model: `assistant`

That abstract model is backed by an **A-side OpenAI-compatible gateway**.

Computer A also acts as the **audit collector**.

Computer B loads a **managed Pi extension** that:

1. points Pi at A for model traffic
2. audits and enforces local workspace activity
3. wraps or replaces the built-in tools
4. intercepts `user_bash`

This is now the chosen architecture.

---

## What we want

### User experience goal

The user should sit at **computer B** and use Pi normally, with the real local Pi interface and local workspace semantics:

- normal Pi terminal UI
- normal local cwd behavior
- normal local file search / project navigation
- local file reads and edits
- local command execution
- no feeling of “remote control” or “RPC client”

### Control goal

We want **computer A** to retain central control over:

- real model/provider credentials
- provider OAuth sessions
- upstream model selection
- routing policy
- request visibility
- audit visibility

### Audit goal

We want computer A to be able to monitor:

- user prompts submitted from B
- attached images sent from B
- provider payloads leaving B toward A
- the model responses coming back
- local file access on B
- local file edits/writes on B
- local shell commands on B, including `!` and `!!`
- tool usage against the workspace on B

---

## What we are not doing

### Not using SSH as the solution

SSH was useful as a conceptual comparison, but it is not the chosen solution.

Reason:
- it does not give us the exact product boundary we want
- it keeps the Pi process and UI semantics tied to A
- it is a workaround, not the target architecture

### Not using Pi RPC as the primary product architecture

Pi RPC is valid for custom-client architectures, but that is no longer our chosen path.

Reason:
- we want the real Pi UX on B
- we do not want to build and maintain a custom Pi-like client if we can avoid it
- the provider/gateway split is cleaner for our final goal

### Not copying credentials from A to B

This is explicitly rejected.

Reason:
- it defeats the point of centralizing control on A
- it spreads secrets unnecessarily
- it weakens governance and observability

---

## Final architecture overview

## Machine roles

### Computer A: Control plane

Computer A is the trusted backend.

Responsibilities:
- stores real provider credentials and OAuth tokens
- decides which actual upstream model/provider to use
- exposes one OpenAI-compatible gateway endpoint to B
- collects audit events from B
- stores logs and correlation data
- optionally provides admin visibility/reporting later

### Computer B: User workstation

Computer B is the real Pi runtime from the user’s point of view.

Responsibilities:
- runs Pi normally
- shows the stock Pi TUI
- operates on the local filesystem
- runs local shell commands
- uses only the abstract provider/model
- reports local activity to A through the managed extension

---

## Core design principle

The design principle is:

> **B owns UX and workspace. A owns model access, routing, and oversight.**

More concretely:

- **B is where Pi lives operationally**
- **A is where model authority lives**

This is cleaner than the earlier “Pi on A, tools on B” design because it preserves stock Pi behavior on the real working machine.

---

## The abstract model design

From the user’s point of view, Pi on B should expose just one generic model, for example:

- provider: `corp`
- model id: `assistant`
- display name: `Assistant`

The user should not need to know whether A ultimately routes that request to:

- Claude Sonnet
- GPT
- Gemini
- some future custom model

This abstraction gives us:

- a stable user-facing interface
- centralized routing on A
- freedom to change upstream vendors/models without changing B

### Important UI note

Pi is not literally model-less. It still shows a current model in the footer and model selectors. So the practical solution is not “hide models completely,” but rather:

- expose exactly one generic model
- keep its id/name generic
- optionally scope model cycling so that only that model is available

---

## Components

## Component 1: A-side OpenAI-compatible gateway

This is the main model-facing API.

### Purpose

Pi on B should be able to treat A as if A were a normal OpenAI-compatible provider endpoint.

### Responsibilities

For every request from B:

1. authenticate the workstation or user
2. log the incoming request
3. map `assistant` to a real upstream provider/model
4. call the real upstream provider using credentials stored on A
5. stream the response back to B
6. log the routing decision and response metadata

### Why OpenAI-compatible first

This is the most practical v1 interface because:
- Pi supports `openai-completions` cleanly
- it is a common compatibility target
- it keeps B-side configuration simple
- it reduces integration complexity on the workstation

### What this gateway is not

It is not just a dumb proxy.

It is a policy point that can:
- choose different upstream models per request
- apply org policy
- collect telemetry
- evolve independently of the workstation

---

## Component 2: A-side audit collector

This receives local activity events emitted from B.

### Why it is required

The gateway alone is not enough.

If we only watch model traffic from A, we will miss important things such as:
- `!!command` activity not sent to the model
- local-only tool usage details
- failed tool calls that never meaningfully enter model context
- the full contents of large file reads / large command output when Pi truncates them before model context

Therefore we need a separate audit path from B to A.

### Responsibilities

Receive structured events from B for:
- user input
- attached images metadata and optionally content policy
- `user_bash`
- tool calls
- tool execution results
- message/session/turn lifecycle if needed
- optional full-content snapshots when policy requires them

### Storage responsibilities

A should persist enough information to correlate:
- workstation / user
- session id
- turn index
- toolCallId
- timestamps
- upstream model selected
- request/response metadata

---

## Component 3: Managed B-side Pi extension

This is the key workstation-side control point.

It should be treated as an organization-managed extension, not an optional convenience script.

### Responsibilities

#### A. Register the provider that points to A

The extension should register one provider that points Pi to the A-side gateway.

High-level behavior:
- provider name: e.g. `corp`
- baseUrl: A’s gateway URL
- api type: `openai-completions`
- auth: bearer token or org SSO token for A
- models: just one model, `assistant`

#### B. Audit raw input and attached images

The extension should use appropriate Pi events to capture:
- raw user input before skill/template expansion if needed
- final prompt before the agent starts
- attached images

This gives us visibility into what the user actually submitted.

#### C. Audit provider-bound traffic

The extension should also observe provider request payloads on B before they are sent to A.

That creates strong correlation between:
- what the user typed
- what Pi serialized
- what A received

#### D. Audit and enforce local shell execution

The extension must intercept `user_bash` so that both:
- `!command`
- `!!command`

are visible to A.

This is mandatory for reliable workstation monitoring.

#### E. Wrap or replace built-in tools

The extension must wrap or replace the built-in tools so local workspace activity is always audited and, if needed, enforced.

Minimum required tools:
- `read`
- `write`
- `edit`
- `bash`
- `grep`
- `find`
- `ls`

### Preferred enforcement model

Use Pi with `--no-tools`, then re-register organization-wrapped versions of the tools.

Reason:
- avoids accidental bypass of unmanaged built-ins
- makes audit/enforcement explicit
- gives stronger guarantees

### Important implementation principle

Do not reimplement Pi tool behavior from scratch unless necessary.

Prefer:
- Pi’s built-in tool factories
- Pi’s schemas
- Pi’s built-in renderers
- thin wrappers that add audit + policy

That will preserve Pi UX while adding control.

---

## Component 4: B-side launcher / thin wrapper

For v1, we are intentionally keeping the client simple.

The launcher is a convenience layer, not a hard enforcement boundary.

### Current stance

We are okay with the user having a fairly raw Pi experience locally.

That means:
- the user may launch Pi directly if they want
- the user may remove or modify the local extension/config if they want
- the user may get something closer to raw Pi on B

This is acceptable for now because the true control point is A.

### What the launcher should do in v1

The launcher should simply make the intended path easy:
- point `PI_CODING_AGENT_DIR` at our app-specific Pi data/config location
- start Pi with our preferred defaults
- make the abstract provider/model easy to use
- optionally open a terminal window with Pi already started

### Important boundary decision

For now, we are **not** treating the B-side launcher or extension as authoritative security enforcement.

Instead:
- **A is authoritative for inference access and policy**
- **B is best-effort for UX, defaults, and telemetry**

This keeps the client simple while still preserving the server-side control we care about.

---

## Portable client packaging and manual update model

For v1, the client will be a **portable Windows bundle**, not an installer-based product.

### Packaging stance

We want the client to be:
- easy to copy to a machine
- easy to replace manually
- easy to test and iterate
- as close as possible to “stock Pi + thin wrapper + small local extensions”

### Disposable app folder

The portable app folder should be considered disposable and replaceable.

Manual update flow should be as simple as:
1. close the app
2. delete the old portable app folder
3. copy the new portable app folder
4. run it again

### Persistent user data location

To make manual replacement safe, all persistent data must live outside the replaceable app folder.

Use normal Windows per-user storage, for example under:
- `%LOCALAPPDATA%\<our-app>\...`

This should include:
- Pi agent/config directory
- Pi sessions / chat history
- logs
- cache
- extension state if needed
- any other user-specific persistent data

### Preferred Pi data layout

Even though we are using stock Pi underneath, we should keep our app’s Pi state in its own dedicated location rather than the user’s generic personal Pi directory.

For example:
- `%LOCALAPPDATA%\<our-app>\pi-agent\`

and the launcher can set:
- `PI_CODING_AGENT_DIR=%LOCALAPPDATA%\<our-app>\pi-agent`

This keeps our wrapped Pi experience separate from any unrelated personal Pi install the user may have.

### What stays inside the portable app folder

The portable app folder should contain only runtime-like content, such as:
- launcher executable/script
- bundled Node runtime if needed
- bundled Pi runtime/package
- local extension files bundled with the app
- static app assets

That folder should be safe to delete and replace without losing user data.

### Future updater direction

Later, we can add an auto-updater that:
- checks a server for a new version
- downloads a zip or portable package
- swaps the portable app folder
- relaunches the app

But this future updater should preserve the same basic model:
- **replaceable app runtime**
- **persistent user data under `%LOCALAPPDATA%`**

---

## Observability model

## What A can observe via the gateway

If B routes all model traffic through A, then A can observe:
- prompts actually sent to the provider path
- attached images included in provider requests
- tool result content that Pi includes in model context
- final provider request payloads
- model responses and response metadata
- upstream provider/model actually used

## What A cannot observe reliably from the gateway alone

A cannot rely on the gateway alone to know:
- every local file path touched on B
- every local shell command on B
- `!!command` activity
- full large outputs if Pi truncates before context inclusion
- all local workspace activity that does not fully appear in model traffic

## Therefore

The B-side extension must additionally send audit events for:
- raw user input
- user bash commands
- tool calls
- tool execution results
- file read/write/edit metadata
- optional full content when policy requires it

---

## File and attachment model

## Images

Pi directly supports image attachments from the terminal flow.

Those images can be observed both:
- at input / before-agent-start time on B
- at gateway request time on A

## Ordinary files

There is no reason to think of normal project files as one separate, generic “attachment pipeline.”

The robust model for ordinary files is:
- the user references them in input or context
- the model calls `read`, `grep`, `find`, etc.
- content enters tool results
- some of that content later enters provider payloads

So file observability should be built from:
- input events
- wrapped built-in tools
- tool result audit
- provider request payload logging

---

## Correlation strategy

Every important event should be correlatable across B and A.

### Minimum correlation keys

- workstation id / device id
- session id
- turn index
- toolCallId
- timestamp

### Correlation goal

We should be able to join:
- raw prompt on B
- provider request leaving B
- gateway request received on A
- upstream model selected on A
- response returned to B
- tools called locally on B during that turn
- final transcript outcome

This will make the system debuggable and auditable.

---

## Policy and enforcement stance

For v1, our stance is intentionally simpler:

- **A is the real control plane**
- **B is a convenience/runtime layer**

### Hard guarantees should come from A

We want A to remain authoritative for:
- authentication
- authorization
- inference approval or denial
- upstream credential ownership
- model routing
- request logging

### B-side controls are best-effort for now

On B, the extension and launcher are still useful for:
- good defaults
- local telemetry
- wrapped tool behavior
- easier alignment with our intended workflow

But they are **not** being treated as the core security boundary in v1.

### Practical implication

If a user removes the extension or launches Pi more directly, they may get something closer to raw Pi locally.

That is acceptable for now, as long as:
- vendor credentials do not live on B
- real inference access still depends on A

So the actual enforcement model for v1 is:

> **client convenience, server enforcement**

---

## Security boundaries

## On B

B should only need:
- access to the A-side gateway URL
- access to the A-side audit endpoint
- a workstation or org auth token for A

B should not need:
- vendor API keys
- vendor OAuth credentials
- direct upstream provider access for normal operation

## On A

A should protect:
- real upstream credentials
- routing policy
- audit logs
- prompt/response logs
- any stored content snapshots

### Minimum security for v1

- HTTPS between B and A
- bearer token or org-issued token for B → A auth
- per-workstation identity if possible
- rate limiting and request size limits on A
- structured logging and retention policy

---

## Storage and privacy considerations

This solution gives us the power to see a lot.

That means we must decide deliberately what to store.

### Things to decide explicitly

For each category, decide whether to store:
- metadata only
- hashes only
- truncated content
- full content

Categories:
- raw prompts
- images
- provider payloads
- model responses
- file contents read by tools
- full bash output
- edit/write snapshots

This is not only a technical choice; it is a product/policy choice.

---

## Why this architecture won over the previous ones

## Better than Pi-on-A + remote tools

This final architecture is better because:
- Pi UX stays local to the user’s machine
- cwd, local filesystem, editor behavior, and shell behavior stay natural
- we do not need to build a custom Pi client
- we preserve stock Pi experience on B

## Better than credential copying

This final architecture is better because:
- secrets remain centralized
- upstream provider access stays under our control
- model routing is hidden from B
- we can change providers/models without touching B

## Better than gateway-only with no B audit

This final architecture is better because:
- it captures local actions the gateway alone would miss
- it handles `!!command`
- it handles local-only workspace activity
- it gives stronger observability guarantees

---

## Implementation plan

## Phase 1 - Make Pi on B talk only to A

Goal:
- prove that B can run stock Pi while using only the abstract model routed through A

Deliverables:
- A-side OpenAI-compatible gateway
- B-side provider registration for one abstract model (`assistant`)
- B-side default provider/model config
- successful end-to-end prompt/response using A’s real upstream credentials

Success criteria:
- Pi runs normally on B
- the user sees only the generic model
- A receives and forwards all model traffic

## Phase 2 - Add audit collection

Goal:
- make A aware of what happens on B beyond pure provider traffic

Deliverables:
- A-side audit endpoint(s)
- B-side extension hooks for:
  - raw input
  - before-agent-start
  - before-provider-request
  - user_bash
  - session/turn/message lifecycle as needed
- session and turn correlation IDs

Success criteria:
- A can reconstruct user prompt flow and local shell activity
- `!` and `!!` usage is visible to A

## Phase 3 - Wrap built-in tools for local telemetry and better defaults

Goal:
- make local workspace activity visible to A in the normal intended usage path

Deliverables:
- B-side extension wraps or replaces:
  - `read`
  - `write`
  - `edit`
  - `bash`
  - `grep`
  - `find`
  - `ls`
- wrapped `user_bash`
- audit events emitted for wrapped tool actions
- optional use of `--no-tools` if we decide stronger local consistency is worth it

Success criteria:
- in the normal supported client flow, A receives consistent tool/file audit events
- local Pi behavior remains close to stock Pi

## Phase 4 - Portable packaging and manual update flow

Goal:
- make distribution and updates extremely simple

Deliverables:
- portable app folder containing runtime + launcher + bundled local extensions
- persistent user data in `%LOCALAPPDATA%`
- dedicated Pi agent dir under our app namespace
- documented manual replacement update flow

Success criteria:
- we can update a user machine by deleting/replacing the app folder without losing sessions, history, or config

## Phase 5 - Admin and routing sophistication

Goal:
- improve operations, visibility, and policy on A

Deliverables:
- audit viewer / admin UI
- richer routing policy engine
- cost/latency/model selection policy
- workstation dashboards and history
- content retention controls

Success criteria:
- A becomes a complete control plane for the managed Pi deployment

---

## Concrete B-side requirements

B must ultimately have:

- stock Pi runtime available locally
- one small local extension package
- app-specific Pi settings/data location
- a thin launcher or wrapper for the preferred startup path
- wrapped built-in tools in the intended workflow
- wrapped/intercepted `user_bash`

Optional but likely useful later:
- org branding / custom status UI
- session tagging metadata
- richer error reporting back to A
- stronger local consistency/enforcement if we later decide we need it

---

## Concrete A-side requirements

A must ultimately provide:

- HTTPS gateway endpoint compatible with Pi’s provider configuration
- authentication for B
- audit event ingestion API
- correlation store / log database
- upstream vendor credential management
- routing engine from `assistant` to real models/providers
- streaming response handling
- retention and visibility policy

Optional later:
- admin UI
- analytics
- policy engine
- org SSO

---

## Unresolved implementation details

The architecture is now chosen, but some implementation details remain open.

### Open questions

1. What exact OpenAI-compatible surface will A expose first?
   - chat completions style is the likely first choice

2. Will B authenticate with:
   - bearer token
   - per-workstation token
   - org SSO token
   - some combination

3. How much content will A store for audit?
   - metadata only vs full content

4. Should wrapped tools send:
   - metadata only
   - truncated output
   - full output/content to A
   depending on policy and size?

5. How much local consistency do we want in v1 versus later?
   - thin wrapper + best-effort extension now
   - stronger local enforcement only if product needs it later

6. Future local sandboxing direction on B
   - tracked separately in `sandboxing-notes.md`
   - likely requires OS-backed Windows sandboxing, not cwd-only restrictions
   - should be treated as a later implementation layer, not a blocker for the current gateway-first architecture

These questions do not change the architecture choice.

---

## Final summary

The final agreed solution is:

- **Run full Pi locally on B**
- **Keep real credentials and model control on A**
- **Expose one abstract model on B**, such as `assistant`
- **Route that model through an A-side OpenAI-compatible gateway**
- **Collect audit logs on A**
- **Ship a managed B-side Pi extension** that:
  - registers the provider pointing to A
  - audits raw input and images
  - audits provider-bound traffic
  - intercepts `user_bash`
  - wraps or replaces built-in tools (`read/write/edit/bash/grep/find/ls`)
- **Package B as a portable thin wrapper over stock Pi** with local extensions and app-specific Pi data under `%LOCALAPPDATA%`
- **Treat A as the real enforcement point**, while B remains a simple, user-friendly runtime layer

This is the architecture we are committing to for now.
