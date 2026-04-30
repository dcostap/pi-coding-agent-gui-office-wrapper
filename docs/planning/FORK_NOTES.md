# Fork Notes

We are starting by forking/adapting `pi-gui` rather than building the GUI from scratch.

Reason:
- we want a presentable desktop shell ASAP
- we want sidebar + session/workspace navigation + streaming timeline + composer
- we do not want to rebuild all Electron/chat-shell plumbing from zero yet

Current intent:
- fork now
- simplify aggressively
- hardwire our own gateway/runtime assumptions
- later decide whether to continue the fork or replace it with a custom GUI
