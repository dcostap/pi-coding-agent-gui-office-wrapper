# OfficeAgent Windows Sandbox Helper

Native helper for OfficeAgent's Windows write-contained command launch path.

The helper is intentionally separate from Electron/Node so command execution can use Windows security primitives directly:

- `CreateRestrictedToken(..., WRITE_RESTRICTED, ...)`
- OfficeAgent-managed-root ACL grants
- real Windows process launch with `CreateProcessAsUserW`
- Job Object process-tree lifetime control
- stdout/stderr capture and timeout handling

Current status: the helper launches real Windows commands using a Medium Integrity write-restricted token. Reads use normal user permissions. Writes require both normal user access and an OfficeAgent restricting SID grant, which is applied only to the managed root/session/writable paths.

This is write containment, not read confinement.

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

Desktop packaging uses `apps/gui/scripts/build-windows-sandbox-helper.mjs` to copy the executable into `apps/gui/build/native/windows-sandbox-helper/`.

## Current launch behavior

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
