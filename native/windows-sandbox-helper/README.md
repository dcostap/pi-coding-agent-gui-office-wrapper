# OfficeAgent Windows Sandbox Helper

Native helper for OfficeAgent's Windows write-contained command launch path.

The helper is intentionally separate from Electron/Node so command execution can use Windows security primitives directly:

- a dedicated `OfficeAgentSandbox` local account
- OfficeAgent-managed-root ACL grants
- Codex-style named-pipe stdin/stdout/stderr
- Job Object process-tree lifetime control
- an experimental restricted/capability child-token path

Current status: v2 product launches run through `office-agent-command-runner.exe` as `OfficeAgentSandbox`. The actual child process also runs as that sandbox account by default, with named-pipe stdio and kill-on-close Job Object cleanup. The stricter restricted/capability child token remains opt-in via `OFFICE_AGENT_WINDOWS_SANDBOX_RESTRICTED_CHILD=1` while Windows tool compatibility is hardened.

This is identity and write containment, not read or network confinement.

The old password-in-environment logon-user spike has been removed from the product path. Use `OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND=codex-v2` with the elevated setup handoff instead.

## Protocol

The helper reads one JSON request from stdin and writes one JSON response to stdout.

Example launch request:

```json
{
  "kind": "launch",
  "requestId": "example",
  "executable": "C:\\Windows\\System32\\cmd.exe",
  "args": ["/d", "/q", "/c", "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc\\command.cmd"],
  "cwd": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\projects\\demo",
  "managedRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData",
  "sessionDir": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc",
  "writablePaths": [
    "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\projects\\demo"
  ],
  "env": {
    "TEMP": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc\\temp"
  },
  "stdoutPath": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc\\logs\\stdout.log",
  "stderrPath": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc\\logs\\stderr.log",
  "timeoutMs": 300000
}
```

## Development

```bash
cargo build --manifest-path native/windows-sandbox-helper/Cargo.toml
```

This builds the main helper plus the sandbox-v2 setup and command-runner binaries.

Desktop packaging uses `apps/gui/scripts/build-windows-sandbox-helper.mjs` to copy the executable into `apps/gui/build/native/windows-sandbox-helper/`.

## Sandbox v2 setup handoff

The `prepareSandboxSetup` request is the current non-elevated UAC handoff point. It validates the managed-root policy, resolves the intended real user's SID before elevation, writes a setup payload under `<managedRoot>\.officeagent\sandbox\requests`, and returns the exact setup-helper command that must be run elevated.

Example request:

```json
{
  "kind": "prepareSandboxSetup",
  "requestId": "setup-handoff",
  "action": "setup",
  "managedRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData",
  "projectRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\projects\\demo",
  "projectStateDir": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\project-state\\demo",
  "sessionDir": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\.officeagent\\sessions\\abc",
  "writeRoots": [
    "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData\\projects\\demo"
  ]
}
```

The response includes `status: "uac-handoff-ready"`, `setupCommand`, `payloadPath`, `intendedRealUserSid`, `username: "OfficeAgentSandbox"`, `groupName: "OfficeAgentSandboxUsers"`, and `networkRestricted: false`.

Use `"action": "reset"` to prepare an elevated clean-slate reset command. The reset entry point is idempotent and removes the sandbox account/group plus v2 setup files where present.

After setup, use `checkSandboxSetup` to validate non-elevated readiness. It verifies marker/secrets presence, DPAPI password decrypt, sandbox user existence, and a password logon check without exposing the password. Secondary Logon (`seclogon`) status is reported as runtime diagnostics only; it is not treated as setup readiness because `CreateProcessWithLogonW` may start/use the Manual service on demand:

```json
{
  "kind": "checkSandboxSetup",
  "requestId": "readiness",
  "managedRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData"
}
```

Use `sandboxRunnerSelfTest` to exercise the first Phase 2 identity-launch seam. It loads the DPAPI credential and launches `office-agent-command-runner.exe --self-test` as `OfficeAgentSandbox` through the v2 credential path:

```json
{
  "kind": "sandboxRunnerSelfTest",
  "requestId": "runner-self-test",
  "managedRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\AgentData"
}
```

Managed OfficeAgent GUI/runtime sessions default to `OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND=codex-v2`; setup-required states are surfaced explicitly instead of silently falling back. Set `OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND=codex-v2` in manual helper invocations to route `launch` requests through the v2 command runner. The current product v2 launch path runs `office-agent-command-runner.exe` as `OfficeAgentSandbox`; the runner launches the actual child as the sandbox account, connects stdin/stdout/stderr to named pipes, and assigns the child process tree to a kill-on-close Job Object. For compatibility, the runner does not force `STARTUPINFO.lpDesktop` on default sandbox-user children; forcing `winsta0\\default` together with `CREATE_NO_WINDOW` caused common console tools to fail DLL initialization under the sandbox account. Capability SIDs are persisted under `.officeagent\sandbox\cap_sid.json` and granted only to the current session/writable/output roots. The final restricted/capability child-token layer remains available as an experimental diagnostic path with `OFFICE_AGENT_WINDOWS_SANDBOX_RESTRICTED_CHILD=1`, but it is not the default because some Windows tools currently fail DLL initialization under that token.

## Legacy launch behavior

The non-v2 backend is disabled for product use and requires the explicit development escape hatch `OFFICE_AGENT_WINDOWS_SANDBOX_ALLOW_LEGACY=1`:

- The helper derives a deterministic OfficeAgent restricting SID from `managedRoot`.
- The helper grants that SID inherited read/write/execute/delete access to `managedRoot`, `sessionDir`, writable paths, and stdout/stderr parent directories.
- Writable/output paths must remain under `managedRoot`.
- The child token is created with `WRITE_RESTRICTED` and remains Medium Integrity.
- The token includes the OfficeAgent restricting SID plus the current logon SID and Everyone SID for real shell/PowerShell startup compatibility.
- The helper sets the token default DACL so child-created IPC/default objects are usable by the restricted token.
- `STARTUPINFO.lpDesktop` is set to `winsta0\\default`.
- Optional `stdoutPath` / `stderrPath` files are opened by the helper as inheritable child stdio handles.
- The process is assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before resume.
- `CREATE_NO_WINDOW` is used so child stdout/stderr do not pollute the helper's JSON stdout protocol when no explicit output file is provided.
- `timeoutMs` terminates the job and returns exit code `124`.
