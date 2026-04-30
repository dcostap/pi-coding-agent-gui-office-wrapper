# GUI Shell Plan

Date: 2026-04-20
Project: `C:\Projects\office-gui-for-agentic-ai`

## Purpose of this document

This document focuses specifically on the **desktop GUI shell** for the client-side Pi experience.

It is separate from `pi-remote-architecture-plan.md`, which is the broader system architecture document for:
- A/B split
- A-side gateway
- A-side audit
- abstract model routing
- client packaging and deployment

This document answers a narrower question:

> What kind of desktop GUI should we build on top of the local Pi runtime on B?

---

## Final GUI direction

We are choosing:

## Option A - use `pi-gui` as a base and simplify it

Repository under consideration:
- `https://github.com/minghinmatthewlam/pi-gui`

### Why this is the chosen direction

Because we do **not** want a trivial launcher-only app anymore.

We want a real but simple desktop shell that gives users:
- a left sidebar for projects/workspaces and sessions
- a main conversation area with streaming chat history
- a prompt/composer area
- persistent session/history behavior
- usability with large chat histories
- a Pi-backed experience that still feels like a lightweight desktop app

That is close enough to what `pi-gui` already tries to do that reusing it is likely smarter than building the whole GUI from scratch.

---

## What this decision means

We are **not** choosing:
- a bare terminal-only product
- a custom GUI built from zero for v1
- a heavy enterprise fork of Pi internals

We are choosing:
- a **desktop shell around stock Pi**
- built by **forking or adapting `pi-gui`**
- then simplifying and hardwiring it for our product

The goal is not to preserve all of `pi-gui`.

The goal is to use it as a practical base for:
- session navigation
- conversation rendering
- desktop app structure
- streaming UI behavior
- local persistence patterns

---

## Relationship to the overall architecture

This GUI decision does **not** change the already chosen runtime architecture.

The runtime architecture remains:

- **B runs Pi locally**
- **A hosts the OpenAI-compatible gateway**
- **A hosts audit collection**
- **B uses a small local extension** for provider routing and local telemetry
- **the user sees one abstract model**, e.g. `assistant`

The GUI is just the local shell around that runtime.

So:
- `pi-remote-architecture-plan.md` remains the system source of truth
- this file describes the client-side GUI product decision

---

## Target user experience

The desired GUI should be:
- simple
- clear
- office-user-friendly
- recognizable as a chat/workspace tool
- still faithful to Pi’s core interaction model

## Core layout

### Left sidebar

The sidebar should contain at least:
- projects or workspaces
- sessions / chats inside the selected workspace

This does not need to be complex, but it needs to be usable.

The sidebar is important because users need a stable way to:
- switch workspace context
- resume old sessions
- start new sessions
- keep work organized

### Main conversation area

The main area should show:
- conversation history / timeline
- streaming assistant output
- tool-related output as needed
- enough performance and structure to remain usable with long histories

### Prompt/composer area

The bottom area should provide:
- prompt input
- basic attachment support if relevant
- message sending / cancel behavior
- enough fidelity to Pi’s interaction flow to feel natural

---

## Why `pi-gui` is attractive

Based on initial inspection, `pi-gui` already appears to provide many of the desktop-shell concerns we would otherwise have to build ourselves, including:
- Electron shell structure
- workspace/session concepts
- timeline/chat UI
- streaming behavior
- persistence and reopening patterns
- desktop state management
- packaging direction and update-related structure

This makes it attractive as a base because the boring but necessary desktop-app work is already partly solved.

---

## Why we are not just using `pi-gui` unchanged

Because our product assumptions are different.

We do **not** want a general-purpose Pi desktop app.

We want a curated product with these opinions:
- one abstract model
- A-side gateway routing
- no user-managed vendor auth as the primary product story
- local extensions that support our A/B design
- simpler UX than a broad Pi desktop companion app

So `pi-gui` is useful as a base, but not as a drop-in final product.

---

## What we want to keep from `pi-gui`

These are the parts we are likely to preserve conceptually, and possibly structurally:

### 1. Desktop shell structure

We want the basic Electron app structure and desktop-app shell patterns.

### 2. Sidebar-based navigation

A left-side project/session navigation model is directly aligned with what we want.

### 3. Conversation timeline UI

We want a persistent chat timeline with streaming output and good readability.

### 4. Session persistence / resume behavior

We want the user to be able to reopen and continue work naturally.

### 5. Local workspace-centric mental model

We want the GUI to feel tied to local workspaces/projects, not like a remote web chat.

### 6. Existing desktop app plumbing

Any already-solved work around:
- state persistence
- window behavior
- desktop startup behavior
- rendering a nontrivial chat app

is useful to inherit rather than rebuild.

---

## What we want to simplify or remove

These are the areas we likely want to cut back or hardwire.

### 1. Provider choice UX

We do not want provider selection to be a major visible concept for the user.

In our product, the provider should effectively be:
- our gateway on A

So the GUI should not emphasize multiple provider setup paths as a primary workflow.

### 2. Model choice UX

We do not want end users thinking in terms of many models.

The product should expose one generic model, e.g.:
- `assistant`

So model-selection complexity should be removed, hidden, or strongly simplified.

### 3. General-purpose power-user settings

We want a narrower, productized experience, not a giant control panel for Pi internals.

### 4. Any flows that assume fully user-managed auth/provider configuration

That is not the center of our architecture.

The center is:
- local Pi runtime on B
- upstream model control on A

### 5. Extra surface area not needed for v1

If `pi-gui` has features beyond:
- workspace selection
- session list
- timeline
- prompt box
- basic settings

we should be willing to remove or postpone them.

---

## Product philosophy for the GUI

The GUI should feel like:
- a lightweight local workspace assistant
- a practical shell over Pi
- a tool for real work, not a demo of every Pi capability

The GUI should **not** feel like:
- a broad developer playground
- a configuration-heavy model lab
- a completely custom agent platform disconnected from Pi

---

## Simplicity standard

Even though we are choosing to reuse a richer base, we still want the resulting product to be simple.

That means:
- fewer visible options
- fewer concepts exposed to the user
- one main path for normal usage
- project/session organization that is obvious
- a conversation view that remains readable during long runs

In other words:

> We are not choosing `pi-gui` because we want more product surface.
> We are choosing it because we want to avoid rebuilding the minimum useful desktop shell from zero.

---

## GUI responsibilities versus Pi responsibilities

## GUI responsibilities

The GUI should handle:
- windowing
- sidebar navigation
- project/workspace selection
- session list / chat switching
- conversation rendering
- prompt input
- user-friendly app state persistence

## Pi responsibilities

Pi should continue to handle:
- actual agent runtime behavior
- session execution
- tool use
- model interaction through our configured provider/gateway
- local extension-driven telemetry and wrapping

This separation is important.

We do not want the GUI to gradually become a reimplementation of Pi runtime logic.

---

## Desired relationship between GUI and Pi

The GUI should be a **thin product shell around local Pi**, not an attempt to replace Pi’s core runtime behavior.

That means:
- Pi remains the engine
- our GUI remains the wrapper
- our small local extensions supply the custom org behavior

This keeps the architecture aligned with our overall goal of staying close to stock Pi while productizing the experience.

---

## Performance expectations

Because one reason we like `pi-gui` is that it already approaches real chat history rendering, the GUI must be good enough at:
- streaming partial assistant output
- rendering long histories without becoming unusable
- managing multiple sessions/workspaces
- reopening prior state reliably

We do not yet need perfect large-scale enterprise polish, but we do need a shell that feels credible for real ongoing use.

---

## Packaging implications

This GUI decision also fits with the portable deployment model already chosen elsewhere.

For v1, we still want:
- portable app folder
- manual folder replacement updates
- persistent user data under `%LOCALAPPDATA%`

So the GUI app should be compatible with that model and should not assume an installer-first setup.

---

## Initial implementation strategy

## Step 1 - Evaluate `pi-gui` as a practical base

Goal:
- determine how directly it maps to our desired simplified product shell

Things to evaluate:
- how tightly it is coupled to upstream Pi assumptions we do not want
- how easy it is to hardwire provider/model behavior
- how easy it is to simplify settings and onboarding flows
- how easy it is to preserve only the project/session/timeline/composer shell

## Step 2 - Fork and trim

Goal:
- reduce the app to the core product shell we actually want

Likely actions:
- remove or hide multi-provider emphasis
- simplify model flows
- align the app around our abstract model and A-side gateway
- keep only the most relevant navigation, timeline, and composer behavior

## Step 3 - Connect to our chosen A/B architecture

Goal:
- ensure the GUI is simply the front-end shell for the already-agreed runtime architecture

This means:
- local Pi runtime on B
- local extension on B
- provider routing to A
- local telemetry to A

## Step 4 - Polish only after the shell is correct

Goal:
- avoid over-investing in UX polish before the product shape is stable

First priority is:
- correct shell
- correct local Pi behavior
- correct A-side integration

Only after that should we invest more in:
- branding
- richer settings
- visual polish
- secondary workflows

---

## What success looks like

A successful v1 GUI shell would let a user:

1. launch the app
2. choose or view a workspace/project in the left sidebar
3. open or create a session/chat
4. see the conversation history in the main area
5. send prompts and watch assistant output stream in real time
6. keep using Pi as the real engine underneath
7. do all of this without needing to think about real upstream providers/models

That is the target.

---

## What this doc does not decide yet

This doc does not yet decide:
- exact file/folder structure of the GUI fork
- exact packaging mechanics
- exact launcher behavior
- exact set of GUI features to cut from `pi-gui`
- whether we talk to Pi via CLI process or deeper SDK integration inside the app

Those are follow-up implementation questions.

---

## Final summary

The chosen GUI direction is:

- use **`pi-gui` as a base**
- **fork or adapt it** rather than building the GUI entirely from scratch
- keep the parts we need most:
  - desktop shell
  - sidebar navigation
  - session/workspace handling
  - timeline/chat UI
  - streaming conversation behavior
- simplify or remove the parts that do not fit our product:
  - broad provider/model UX
  - configuration-heavy general-purpose surfaces
  - extra complexity not needed for a focused v1

The resulting GUI should be:
- simple
- functional
- Pi-backed
- workspace-centric
- close to stock Pi behavior underneath
- but much easier for our target users to navigate than a raw terminal-only experience
