I want to build an agentic GUI app for company users, based on pi-mono on the backend. The rough ideas are:

- openrouter key setup in a server linux. server linux contains pi infrastructure, our permissions system, our logging system, and executes the actual inference
- users install an electron or whatever GUI app, with a chat interface. Very simplified and fully customized. It's for office users. Not even a model picker, we handle that in our backend in code. 
- the app has a list of chats on the left, grouped by "projects". users can create new projcts to group chats inside. it's just names and a folder. so each chat is constrained to a folder in the user's computer. by default, if not inside a project, there's a deafult workspace folder we specify in code, the GUI takes care of creating it etc. in the defautl workspace, each chat creates its own subfolder for that chat. if inside a workspace, all chats operate on that workspace's folder. The user chooses workspace folder with a folder picker. the name of the workspace = name of the folder. 
- actually, it's likely that the PI engine will need to run on the user GUI client, and that the linux server is just the inference provider. not sure. but the AI agent does work, runs commands, etc operating directly in the user's PC. 
- we would need a way to sandbox the agent execution itself on each user's computer: all file operations must be limited to the folder each chat is enclosed in. it's ok if there would be theoritical wayts for the agent to bypass that with weird commands etc, as we don't worry too much as the models we use will be very powerful and follow rules well. 
- the main tasks for users will be: reading PDF files, excel files, word files, generating new modified copies of those files, generating reports, summaries, etc. Agent will need to run many python commands and leverage its capabilitites in smart ways. 
- the login will be very simple: the server receives the auth details  and we decide there if we give permission to the user etc. we can also rate limit users on our end. 

thoughts?

Yes. This is a viable product shape, and pi-mono is a sensible base because it already supports embedding in a custom UI, headless RPC mode, custom tools, and custom providers. One detail matters: pi’s current docs say RPC is good for embedding in other apps, but for a Node/TypeScript app they suggest using `AgentSession` directly from `@mariozechner/pi-coding-agent` instead of spawning a subprocess. ([GitHub][1])

The architecture I would choose is: inference/auth/rate-limit/logging on your Linux server, but the agent loop and file-manipulation tools on the user machine. That matches your actual workload. If the agent must read and modify local PDFs, Word files, Excel files, and run Python over the user’s folders, local execution avoids file-sync headaches and awkward remote workspace management. pi-mono’s provider layer is also built for proxies, API gateways, custom endpoints, and enterprise auth flows, so your server can sit cleanly between the client and OpenRouter. ([GitHub][2])

For the desktop client, Electron is fine, but keep the renderer as a thin chat UI only. Electron’s current security guidance is clear: use context isolation, expose a very small preload API via `contextBridge`, avoid broad IPC exposure, keep Node integration off in the renderer, and avoid serving your app over `file://` because Electron notes that `file://` pages can access arbitrary local files if you get an XSS issue. Use a custom app protocol instead. ([Electron][3])

So the split should be: renderer = chat/project list; privileged local host = agent session, folder picker, file tools, Python runner, and IPC boundary. Start by running pi in the Electron main process or a dedicated local sidecar. The renderer should only send narrow intents such as `pickWorkspaceFolder`, `createChat`, `runTurn`, `cancelRun`, and `openArtifact`. Electron’s sandbox model is designed exactly around this: sandboxed renderers do not get a normal Node environment and must delegate privileged work to a more privileged process over IPC. ([Electron][4])

The weakest part of your current idea is the sandbox story. “The model is powerful and should follow rules” is not a security boundary. Your minimum practical boundary should be tool-level confinement: do not expose a raw unrestricted shell by default. Instead, expose a small set of explicit tools such as `list_files`, `read_text`, `read_pdf`, `read_spreadsheet`, `read_docx`, `write_copy`, `create_report`, and `run_python_task`. pi’s extension system is built for exactly this kind of custom tool layer, and the docs explicitly list permission gates and path protection as example uses. ([GitHub][5])

For file confinement, every path should be resolved against the chat’s workspace root and then canonicalized before use. Node’s `fs.realpath()` computes the canonical path by resolving `.`, `..`, and symbolic links, which is the right primitive for rejecting paths that escape the allowed root. That will not make the system perfect, but it is the correct baseline. ([Node.js][6])

If later you want a stronger boundary than “well-behaved tools,” add OS-backed isolation as an optional second layer. On Windows, packaged desktop apps can run in AppContainer, where the process and its children can only access explicitly granted resources. On macOS, App Sandbox limits access to system resources and user data, and Apple’s security-scoped bookmark mechanism is the standard way to preserve access to user-selected folders. Those are real sandboxes, but they add packaging complexity and may complicate broad Python/document automation, so I would not make them phase 1. ([Microsoft Learn][7])

Your project/workspace model is good, but I would tighten the semantics. Make each chat bind to exactly one `workspaceRoot`. A “project” is then just a named workspace root plus a set of chats. Keep chat history separate from files on disk, even when multiple chats share the same project folder. Also create a predictable artifacts area, such as `_artifacts/<chat-id>/`, so generated copies do not clutter the user’s working files. That avoids collisions when several chats operate on the same project folder.

For office tasks, build document-oriented tools, not terminal-oriented ones. Office users usually want reliable operations such as “summarize this PDF,” “extract this spreadsheet,” “rewrite this DOCX and save a copy,” or “generate a report in the same folder.” pi extensions already support custom tools, custom UI interactions, and event interception, so this is a better fit than letting the model improvise with shell commands for every task. ([GitHub][5])

On the server side, your “simple login” idea is fine. I would not distribute the OpenRouter key to clients. Keep the key only on your Linux gateway, authenticate users against your own system, choose models server-side, apply rate limits there, and forward the request to OpenRouter. OpenRouter’s docs explicitly say to protect API keys, note that keys can have credit limits, and expose a key-info endpoint for checking remaining credits and limits. pi’s custom-provider support is a clean way to point the local agent at your gateway rather than at OpenRouter directly. ([OpenRouter][8])

The part I would change immediately is this: do not think of the Linux server as “where the agent runs” unless you are willing to remote the user’s entire workspace. For your use case, the better model is “server chooses and pays for inference; client owns files and execution.” That keeps the UX simple and keeps your permissions model aligned with the actual file system the user cares about.

A good first version would be: Electron UI, one default workspace, local pi host, server-side inference gateway, and only 5–8 curated tools. After that, add projects, document writers, audit logging, and stronger local isolation. The architecture is solid enough to build. The main risk is not feasibility; it is over-exposing local execution too early.

[1]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md "pi-mono/packages/coding-agent/docs/rpc.md at main · badlogic/pi-mono · GitHub"
[2]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md "pi-mono/packages/coding-agent/docs/custom-provider.md at main · badlogic/pi-mono · GitHub"
[3]: https://electronjs.org/docs/latest/tutorial/context-isolation "Context Isolation | Electron"
[4]: https://electronjs.org/de/docs/latest/tutorial/sandbox "Process-Sandboxing | Electron"
[5]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md "pi-mono/packages/coding-agent/docs/extensions.md at main · badlogic/pi-mono · GitHub"
[6]: https://nodejs.org/api/fs.html "File system | Node.js v25.9.0 Documentation"
[7]: https://learn.microsoft.com/en-us/windows/msix/msix-containerization-overview "MSIX containerization overview - MSIX | Microsoft Learn"
[8]: https://openrouter.ai/docs/api/reference/authentication "API Authentication | OpenRouter OAuth and API Keys | OpenRouter | Documentation"



client will be windows-only, so we need to investigate ways to leverage strong sandboxing of operations and powershell commands execution to insdie a givne folder for each chat

Yes. For a Windows-only client, this is where I would tighten the design.

The key point is: **changing the working directory is not a sandbox**. If the agent can run normal PowerShell or native processes as the logged-in user, it can usually still read or modify files outside that folder unless Windows itself is enforcing a boundary.

The practical Windows options break down like this:

### 1. AppContainer / isolated Win32 executor

This is the strongest native boundary that still feels like a desktop app. Microsoft’s current packaging docs say AppContainer apps run in a **strictly isolated environment** and that the process **and its children** can access only resources that are explicitly granted. Microsoft also says desktop apps can opt into AppContainer, and there is now a preview path for packaging an isolated Win32 app with `uap18:TrustLevel="appContainer"` and `uap18:RuntimeBehavior="appSilo"`. ([Microsoft Learn][1])

For your use case, the right pattern is:

* Keep the GUI/broker process separate.
* Run the **agent executor** as a separate helper inside **AppContainer or Less-Privileged AppContainer**.
* Grant that executor access only to:

  * the chat’s workspace root
  * a temp folder for that chat
  * an artifacts/output folder for that chat

Microsoft’s AppContainer docs explicitly describe AppContainer as using **SIDs, tokens, and DACLs** to enforce restrictions. That fits a design where each executor identity gets ACL access only to its chat folder tree. ([Microsoft Learn][2])

This is the option I would target first.

### 2. Windows Sandbox

This is stronger in absolute isolation, but worse for a normal office-user agent workflow.

Microsoft documents that Windows Sandbox can:

* disable networking,
* map folders from the host,
* run a command at startup,
* and as of Windows 11 24H2 it has a CLI for starting sandboxes, executing commands, and sharing folders. ([Microsoft Learn][3])

But it has serious product limitations for your case:

* Microsoft says **only one sandbox instance** can run at a time.
* The CLI `wsb exec` currently has **no process I/O**, so you cannot easily stream command output back into chat.
* Mapped folders themselves are a trust decision; Microsoft warns that exposing host directories can let malicious software affect the system or steal data. ([Microsoft Learn][4])

So Windows Sandbox is good for:

* “high-risk mode”
* opening suspicious files
* one-shot isolated jobs

It is not a good primary execution engine for per-chat, low-latency, interactive agent loops.

### 3. Low integrity / MIC

This is useful, but not enough by itself.

Microsoft’s Mandatory Integrity Control docs say a **low-integrity** process cannot write to a **medium-integrity** object even if the DACL would otherwise allow it. ([Microsoft Learn][5])

That helps protect the machine from writes, but it does **not** give you a clean “this process can only operate inside folder X” guarantee. It is a partial hardening layer, not your main containment model.

### 4. PowerShell restrictions

PowerShell has useful restriction modes, but they are not full filesystem sandboxes.

Microsoft’s current PowerShell docs say:

* **ConstrainedLanguage** still allows cmdlets, native commands, and basic language elements, but blocks access to PowerShell/.NET/COM APIs that could be abused. ([Microsoft Learn][6])
* Under **WDAC/AppLocker**, PowerShell automatically runs in ConstrainedLanguage mode, and App Control can log script enforcement behavior. ([Microsoft Learn][6])
* For stricter confinement, custom session configurations and JEA use **NoLanguage** mode, which restricts the session to command invocation only. ([Microsoft Learn][6])

That said, Microsoft also warns in JEA docs that:

* external programs are **less granularly constrained** than native PowerShell commands,
* and that functions/cmdlets available in a JEA session can still access providers unless you wrap them carefully. Microsoft recommends custom functions for sensitive tasks and using full executable paths for allowed external commands. ([Microsoft Learn][7])

So for your app:

* Do **not** give the agent a generic unrestricted `powershell.exe`.
* Host PowerShell in-process with a **custom runspace**.
* Prefer **NoLanguage** or a very tight constrained runspace.
* Expose only proxy/wrapper commands such as:

  * `Get-WorkspaceFiles`
  * `Read-WorkspaceText`
  * `Write-WorkspaceFile`
  * `Convert-DocxToText`
  * `Save-ModifiedCopy`
* Remove dangerous commands/providers and avoid generic escape hatches like `Start-Process`, `Invoke-Expression`, `Add-Type`, arbitrary module import, and arbitrary provider access.

Microsoft’s runspace samples explicitly show you can:

* set language mode,
* make commands private,
* remove commands/providers,
* and expose only proxy commands through `InitialSessionState`. ([Microsoft Learn][8])

### 5. WDAC / App Control

This is important as a second layer.

Microsoft’s App Control docs say application control is one of the most effective ways to reduce executable-file attacks, and that it covers not only EXEs but also scripts, batch files, and interactive PowerShell behavior. ([Microsoft Learn][9])

For your product, WDAC/App Control can do two useful things:

* force PowerShell into **ConstrainedLanguage**
* restrict which binaries/script hosts are allowed at all

That means you can allow:

* your signed executor
* your signed packaged app
* specific Python runtime and libraries
* specific helper binaries

And block:

* `cmd.exe` if you do not need it
* `wscript.exe`, `cscript.exe`, `mshta.exe`
* random downloaded tools

Microsoft’s script enforcement docs also note an important caveat: `cmd.exe` scripts are not directly controlled the same way as PowerShell, and unenlightened third-party script hosts may bypass the richer enforcement model. ([Microsoft Learn][10])

So WDAC helps a lot, but it must be paired with your own executor boundary.

## What I would recommend

### Recommended architecture

Use a **broker + sandboxed executor** model:

**1. Electron UI / renderer**

* chat UI only
* no direct shell, no direct filesystem access except user-driven folder pickers

**2. Broker process**

* medium-integrity local controller
* handles login/session/auth with your server
* creates chat workspaces
* grants the executor access only to the chat root and artifact/temp subfolders
* receives structured requests from the renderer

**3. Sandboxed executor**

* separate process
* run in **Less-Privileged AppContainer** if feasible, or full AppContainer/isolated Win32 packaging if your app model supports it cleanly
* all file I/O goes through the executor
* current chat root is the only granted filesystem scope

**4. Command model**

* PowerShell: custom runspace, not raw interactive shell
* Python: same principle; do not expose “run arbitrary python against the whole user account”
* prefer structured tools over arbitrary shelling out

### Workspace enforcement

For each chat:

* create a dedicated root folder
* create `_artifacts`, `_temp`, `_logs`
* canonicalize every path before use
* reject anything outside the root
* grant the executor identity access only to that subtree

With AppContainer, the Windows enforcement becomes “can only touch what was granted,” instead of “please obey the prompt.”

### Security layers

Use all three:

* **Layer 1: AppContainer** for real process/file isolation ([Microsoft Learn][1])
* **Layer 2: constrained PowerShell runspace** for language-level restriction ([Microsoft Learn][6])
* **Layer 3: WDAC/App Control** for binary/script allowlisting and PowerShell CLM enforcement ([Microsoft Learn][10])

## What not to do

I would avoid these as the primary design:

* relying only on “chat is bound to folder X”
* relying only on “PowerShell current directory = folder X”
* relying only on PowerShell ConstrainedLanguage
* using Windows Sandbox as the normal per-chat runtime

Those are either too weak or too awkward for a normal desktop product.

## My concrete recommendation

Build around this stack:

* **Windows-only packaged desktop app**
* **local broker**
* **per-chat sandboxed executor using AppContainer/LPAC**
* **curated PowerShell runspace**
* **WDAC/App Control policy for enterprise installs**
* optional **Windows Sandbox high-risk mode** for special jobs only

That gives you a real boundary without making the product unusable.

The next useful step is to turn this into a specific implementation plan: process model, ACL/AppContainer grant flow, and the exact PowerShell command surface for v1.

[1]: https://learn.microsoft.com/en-us/windows/msix/msix-containerization-overview "MSIX containerization overview - MSIX | Microsoft Learn"
[2]: https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer "Launch an AppContainer - Win32 apps | Microsoft Learn"
[3]: https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file "Use and configure Windows Sandbox | Microsoft Learn"
[4]: https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/ "Windows Sandbox | Microsoft Learn"
[5]: https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control "Mandatory Integrity Control - Win32 apps | Microsoft Learn"
[6]: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes?view=powershell-7.6 "about_Language_Modes - PowerShell | Microsoft Learn"
[7]: https://learn.microsoft.com/en-us/powershell/scripting/security/remoting/jea/role-capabilities?view=powershell-7.6 "JEA Role Capabilities - PowerShell | Microsoft Learn"
[8]: https://learn.microsoft.com/en-us/powershell/scripting/developer/hosting/runspace11-sample?view=powershell-7.6 "Runspace11 Sample - PowerShell | Microsoft Learn"
[9]: https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol "Application Control for Windows | Microsoft Learn"
[10]: https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/script-enforcement "Understand App Control script enforcement | Microsoft Learn"


ok note: i'd like to work on both the client and server in the same repo. and for testing i can easily just run both in my local machine. 

the GUI chat interface needs some thought, it needs to be very robustly represent the agent chat history and correctly stream its thoughts, the tool call widgets, etc. Just like the pi TUI does. 

I am thinking we could leverage or get inspired by existing desktop guis with the same basic layout:

https://github.com/IgorWarzocha/howcode
https://github.com/jakemor/kanna
https://github.com/pingdotgg/t3code

but, of course, our GUI will be very simple. it should render the pi agent things correctly and efficiently, but we don't need any fancy functionality other than that, it's like the pi TUI adapted to a user-friendly GUI app

thoughts?

Yes. A **single monorepo** is the right choice for this, especially since you want to run client and server together on one machine during development. Given pi-mono’s current guidance, I would avoid a subprocess/RPC-first architecture for your desktop app and instead use `AgentSession` directly in a local Node/TypeScript host, then keep RPC only as a fallback or debug mode. pi’s RPC docs explicitly say RPC is useful for embedding, but also say Node/TypeScript apps should consider using `AgentSession` directly. ([GitHub][1])

The other strong reason to keep one repo is that your hardest problem is not auth or inference routing. It is **keeping the transcript, streaming state, tool widgets, and persisted session state perfectly in sync** between the agent runtime and the GUI. Kanna’s architecture is useful here: it keeps a WebSocket-driven real-time model, persists JSONL event logs plus compacted snapshots, and builds read models for sidebar/chat/project views. That is very close to what you need conceptually, even if your product is simpler. ([GitHub][2])

My main recommendation is this:

## Build the app around an event log, not around message objects

Do not make the renderer consume “chat messages” as the primary source of truth. Make it consume an **append-only stream of typed agent events**, then derive messages/tool rows/thinking rows from that.

That is the only reliable way to reproduce pi-TUI-like behavior in a GUI:

* partial assistant streaming
* tool call started / running / completed / failed
* collapsible tool output
* intermediate prompts like confirm/select/input
* resuming an interrupted run
* rebuilding the exact transcript after app restart

This lines up well with pi’s extension and session model. The current docs explicitly mention custom tools, event interception, session persistence, user interaction via `ctx.ui`, and custom rendering of tool calls/results/messages. ([GitHub][3])

## Repo shape

I would structure the repo like this:

```text
/apps
  /desktop          # Electron shell + React renderer
  /server           # auth, rate limits, logging, inference gateway
/packages
  /agent-host       # wraps pi AgentSession; local runtime API
  /protocol         # shared event types, DTOs, zod/typebox schemas
  /ui               # transcript renderer, shared React components
  /storage          # event log + snapshot + read-model builders
  /tools            # workspace-safe tools, PowerShell/Python wrappers
  /sandbox          # Windows executor / policy / path confinement
```

That lets you run:

* desktop only
* server only
* both locally
* integration tests against the same shared protocol types

For local development, the desktop app can talk to:

* the real local server, or
* a mock server, while the agent still runs locally

That keeps your test loop fast and avoids packaging noise early.

## Use the reference apps selectively

The three examples are useful, but for different reasons.

**Howcode** is the most relevant inspiration if you want a Pi-flavored desktop shell. Its README describes threaded Pi conversations, project-aware sidebars, a built-in terminal, diff views, and local-first desktop behavior, with real streaming, persistence, PTY terminal support, and checkpoint-backed diff rendering already in place. That makes it a good reference for “Pi adapted to desktop.” ([GitHub][4])

**Kanna** is the best reference for **state architecture**. Its README calls out project-first sidebar grouping, rich transcript rendering, collapsible tool groups, persistent local history via JSONL + snapshots, session resumption, and a browser ↔ WebSocket ↔ server architecture with event store and read models. That is almost exactly the mental model I would borrow. ([GitHub][2])

**T3 Code** is the best reference for **product discipline**: keep the interface minimal, session-oriented, and desktop-capable. Its docs position it as a minimal GUI with persistent sessions and both web and desktop interfaces. ([GitHub][5])

So the borrowing should be:

* from **Howcode**: desktop Pi feel
* from **Kanna**: event store + derived UI state
* from **T3 Code**: restraint and simplicity

## The transcript should be modeled as blocks, not plain bubbles

Your GUI should not think in terms of only:

* user message
* assistant message

It should think in terms of transcript blocks such as:

* `user_message`
* `assistant_message_chunk`
* `assistant_message_finalized`
* `thinking_started`
* `thinking_delta`
* `thinking_finished`
* `tool_call_started`
* `tool_call_stdout_chunk`
* `tool_call_result`
* `tool_call_error`
* `ui_prompt_requested`
* `ui_prompt_resolved`
* `run_status_changed`

Then the renderer composes those into a friendly transcript.

That gives you three big benefits:

1. exact replay after restart
2. stable streaming behavior
3. no mismatch between “what happened” and “what the UI guessed happened”

Kanna’s “rich transcript rendering” and event-log/snapshot design point in this direction, and pi’s own extension system already treats UI prompts and tool/rendering as first-class concepts rather than plain text blobs. ([GitHub][2])

## For “thought streaming,” separate UX from raw internals

I would be careful here.

You want the GUI to represent the agent’s progress robustly, but you do **not** want the UI architecture to depend on raw private reasoning text always being available or always being desirable to show. A safer and cleaner approach is:

* support a collapsible **Thinking** section when the runtime emits one
* otherwise show a generic **Working** / **Planning** / **Running tools** status row
* make tool progress first-class and more important than internal thoughts

This also matches current UX pressure in pi itself: there is a very recent “zen mode” change request specifically about hiding tool-call and thinking noise while keeping a working spinner/status. That is a useful signal that verbose internal rows should be optional, not the center of the interface. ([GitHub][6])

So in your GUI:

* assistant text should be primary
* tool activity should be secondary but visible
* thinking should be collapsible and optional

## The right desktop architecture

For your case I would use:

* **Electron main process**: app shell, windowing, native dialogs
* **local agent host process**: owns `AgentSession`, workspace enforcement, tools, PowerShell/Python wrappers
* **React renderer**: pure UI, subscribed to the event stream
* **local store**: JSONL event log + periodic snapshots
* **server**: auth, permissions, rate limiting, inference proxy, central logging

This keeps the renderer dumb and robust. It also means your transcript is driven by the same event source whether the app is:

* live-streaming,
* replaying history,
* resuming a run,
* or rendering a saved transcript offline.

## Minimal UI layout I would build

The basic layout should be:

**Left sidebar**

* default workspace
* projects
* chats under each project
* per-chat status dot: idle, running, waiting, failed

**Center transcript**

* user message blocks
* assistant answer blocks
* collapsible thinking sections
* tool execution cards
* file artifact cards
* confirm/select/input widgets inline in the transcript

**Bottom composer**

* prompt box
* attachment button
* “Run in this workspace” indicator
* stop button while running

You do not need model pickers, provider selectors, reasoning toggles, or terminal panes for office users. Kanna includes many advanced provider controls because it targets power users; your app should omit most of that. ([GitHub][2])

## Tool widgets should be semantic, not raw logs

Do not render every tool result as a monospaced blob. Use specialized cards:

* **Read PDF** → pages read, file name, extracted summary preview
* **Read Excel** → workbook/sheet names, row count, selected ranges
* **Read Word** → sections/headers summary
* **Write file** → created copy path, open folder button
* **Python task** → concise summary + expandable raw logs
* **Permission prompt** → approve/deny inline

pi’s current extension docs and examples support custom rendering for tool calls/results, which is exactly what you need here. ([GitHub][3])

## Persistence model

I would persist three things per chat:

1. `events.jsonl`
   append-only source of truth

2. `snapshot.json`
   compact derived state for quick load

3. `artifacts/`
   generated output files, previews, temp assets

Kanna explicitly uses JSONL event logs plus compacted snapshots, and session resumption is one of its stated features. That is a good pattern to copy. ([GitHub][2])

## What I would build first

Phase 1 should be very small:

* one monorepo
* Electron app
* local agent host using `AgentSession`
* one server app for auth + inference proxy
* event log + snapshot store
* sidebar with projects/chats
* transcript with:

  * user messages
  * assistant streaming
  * tool cards
  * confirm/select/input widgets
* only a few tools:

  * list/read files
  * read pdf/docx/xlsx
  * write modified copy
  * run curated Python task

That is enough to validate the hard part: transcript fidelity.

## Bottom line

Your idea is sound, and the right direction is:

* **monorepo**
* **local AgentSession-based host**
* **event-sourced transcript**
* **simple desktop shell inspired by Howcode**
* **state/read-model approach inspired by Kanna**
* **restraint and minimalism inspired by T3 Code** ([GitHub][1])

If I were making one decision now, it would be this: define the **event protocol and transcript block model before building the GUI**. That one decision will determine whether the app feels solid or constantly glitchy.

[1]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md "pi-mono/packages/coding-agent/docs/rpc.md at main · badlogic/pi-mono · GitHub"
[2]: https://github.com/jakemor/kanna "GitHub - jakemor/kanna: A beautiful web-based UI for Claude Code & Codex · GitHub"
[3]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md "pi-mono/packages/coding-agent/docs/extensions.md at main · badlogic/pi-mono · GitHub"
[4]: https://github.com/IgorWarzocha/howcode "GitHub - IgorWarzocha/howcode: The Pi desktop app you want to use. · GitHub"
[5]: https://github.com/pingdotgg/t3code "GitHub - pingdotgg/t3code · GitHub"
[6]: https://github.com/badlogic/pi-mono/issues/3203?utm_source=chatgpt.com "Zen mode in pi · Issue #3203 · badlogic/pi-mono"


i agree:

Howcode is good reference on wrapping pi
T3 Code has the best architecture, web libraries, performant GUI, polished UX, project discipline, repo adapted for coding agents to work on, etc. That should be a strong reference in those aspects too.

I wouldn't want to duplicate stuff that pi already handles: session management, stored history in jsonl, etc. That kinda stuff. We should leverage everything that pi gives us. Of course, we would expose only the functionality we choose, to the user. 

I don't like your idea of hand-crafting each tool's widget. I think just rendering similar raw stuff to what pi TUI renders is enough. let's not overcomplicate ourselves on the chat history rendering. 

I don't agree with how you say that we hand-pick the commands and stuff the model runs. we want to give the model agent free reign inside the sandbox. 


Thoughts?


I mostly agree.

The direction becomes much cleaner if you adopt these three rules:

1. **Pi owns the agent session and transcript persistence**
2. **Your app owns only product-specific metadata and presentation**
3. **The sandbox is broad, but the boundary is process-level, not prompt-level**

That gives you a simpler system.

## 1. Do not reimplement session history

I agree with you here. If pi already gives you session management, JSONL history, resume behavior, tool/event streaming, and the agent loop, duplicating that in your app is wasted effort and a future maintenance trap.

So I would not build a second canonical chat store.

I would make the source of truth:

* **pi session state/history**
* plus a very small app-level store for:

  * projects
  * chat-to-project mapping
  * chat-to-workspace-root mapping
  * pinned titles / UI labels
  * local app settings
  * auth/session tokens for your backend

So the split is:

**Pi-owned**

* message history
* tool call history
* run state
* checkpoints/resume
* any built-in JSONL/session persistence

**App-owned**

* project tree on the left
* which chats belong to which project
* which folder each chat is bound to
* local preferences
* server auth state

That keeps your architecture thin.

## 2. The GUI should mirror pi, not invent a richer abstraction

I agree with you on the widget point too.

You do **not** need a bespoke “PDF tool widget,” “Excel widget,” “Word widget,” etc. That is overdesigned for v1.

A better approach is:

* render the transcript in a way that is **structurally faithful** to pi
* keep the visual layer simple
* only prettify the minimum needed for readability

So the renderer should support a few generic block types:

* user message
* assistant message
* thinking block
* tool call block
* tool output block
* tool error block
* approval / prompt block
* final result block

That is enough.

In practice, the UI can look like “pi TUI, but calmer and more readable”:

* cleaner spacing
* collapsible tool blocks
* monospace for raw tool output
* inline streaming text
* simple labels for tool status
* no fancy custom per-tool visualizations

That fits your goal much better.

## 3. The hard part is not custom widgets, it is event fidelity

The GUI only needs to “correctly render pi” if you preserve the event stream semantics.

That means the main UI contract should not be “chat message strings.”
It should be closer to “append these session events in order.”

So even if you do not duplicate pi persistence, you still need a **thin adapter layer** that translates pi runtime events into UI events.

Something like:

* `assistant_delta`
* `assistant_done`
* `thinking_delta`
* `tool_started`
* `tool_stdout`
* `tool_stderr`
* `tool_finished`
* `tool_failed`
* `approval_requested`
* `approval_resolved`
* `run_started`
* `run_finished`

The key is: this is **not a second transcript system**. It is just a UI-facing stream.

Pi remains the source of truth. Your app just subscribes and renders.

## 4. T3 Code is a better reference than the others for the frontend shell

Your updated framing makes sense.

If Howcode is the reference for “wrapping pi,” then T3 Code is the reference for:

* frontend project organization
* desktop/web-friendly stack choices
* polished interaction patterns
* performant rendering
* keeping the repo easy for agents to work in

That is a good combination.

So I would copy from each reference selectively:

**From pi**

* session/runtime
* transcript persistence
* agent loop
* tool semantics

**From Howcode**

* the idea of adapting pi to a desktop GUI
* basic transcript/tool rendering approach

**From T3 Code**

* repo hygiene
* frontend architecture
* performant rendering patterns
* disciplined UX scope

That is a strong mix.

## 5. On “free reign inside the sandbox”: yes, but be precise

I agree with your product intent.

You do not want a tiny allowlist of hand-picked operations.
You want the model to behave like a real agent inside a constrained environment.

That is reasonable.

But the important distinction is:

* **broad freedom inside the sandbox**: good
* **broad freedom on the user’s normal machine token**: bad

So I would revise my earlier stance like this:

### What I would not do

I would not try to restrict the agent by only exposing a few narrow commands forever.

### What I still would do

I would absolutely still run the agent in a **separate local executor** with a real boundary:

* fixed workspace root
* dedicated temp/artifact folders
* constrained token / AppContainer-style isolation if feasible
* working directory fixed
* environment filtered
* process tree killable
* CPU / memory / timeouts if practical
* optional network policy

That is not “hand-picking commands.”
That is **runtime containment**.

Inside that boundary, yes:

* let it run PowerShell
* let it run Python
* let it inspect files
* let it create and modify outputs
* let it chain commands

That is the right model.

So the principle becomes:

**Do not overconstrain the agent’s behavior. Constrain the environment it runs in.**

That is a much better fit for what you want.

## 6. A cleaner architecture given your preferences

Given everything you just said, I would simplify the architecture to this:

### Monorepo

* `apps/desktop`
* `apps/server`
* `packages/shared`
* `packages/agent-host`
* `packages/sandbox`

### Desktop app responsibilities

* login
* project/chat sidebar
* transcript rendering
* folder picker
* sending user input
* showing live run state

### Local agent host responsibilities

* embed pi directly
* attach to local workspace
* stream pi events to renderer
* launch commands in sandbox executor
* handle cancel/stop/resume

### Server responsibilities

* auth
* permissions
* rate limits
* logging
* model routing
* OpenRouter proxy / provider gateway

### App-owned storage

Very small:

* `projects`
* `chat -> project`
* `chat -> workspaceRoot`
* `chat title`
* UI prefs
* auth/session state

### Pi-owned storage

* transcript/session history
* tool history
* run state
* any session artifacts pi already persists

This is much slimmer than the earlier design.

## 7. How I would approach transcript rendering now

Given your preference, I would explicitly avoid trying to be clever.

Build a transcript renderer that is intentionally generic:

### Message row

Plain rich text / markdown-ish rendering.

### Thinking row

Muted, collapsible, streamable.

### Tool row

Header with:

* tool name
* running / success / failed
* duration

Body:

* raw streamed output in monospace
* collapsible by default after completion

### Approval row

Simple inline approve/deny UI.

### Artifact row

Generic file chip with open/reveal actions.

That is enough.
No special PDF/Excel/Word card design needed.

## 8. The one thing I would still not do

I would still avoid making the renderer itself depend directly on raw pi internals everywhere.

Even if pi is the source of truth, put one thin local adapter in front of the UI so you can normalize event shapes.

That adapter should be tiny.
Its purpose is not to replace pi.
Its purpose is to make your GUI stable if pi changes formatting details.

Think of it as:

* **pi runtime schema in**
* **UI event schema out**

Very thin.
Very boring.
Very useful.

## 9. What this means for v1

Your v1 can now be much simpler:

* one monorepo
* one desktop app
* one server app
* one local embedded pi host
* one sandboxed executor
* one generic transcript renderer
* one small metadata DB

And crucially:

* no custom per-tool widgets
* no duplicate transcript store
* no overdesigned command allowlist
* no unnecessary product surface

## My updated recommendation

I would now define the system like this:

**“A minimal desktop shell around pi, with project/workspace organization, server-mediated inference, and a strong local execution boundary.”**

That is the right product statement.

The remaining key decisions are only three:

1. **How the local agent host subscribes to and replays pi events**
2. **How the sandboxed executor is implemented on Windows**
3. **How little metadata you can store while keeping the sidebar/project UX good**

That is a good place to be.

The next useful step is to sketch the actual monorepo package boundaries and the transcript event types the renderer will consume.
