# OfficeAgent Windows Sandbox Helper

Native helper scaffold for the Windows sandbox launch path.

The helper is intentionally separate from Electron/Node so the final v1 sandbox can use Windows primitives directly:

- AppContainer profile / token setup
- managed-root ACL grants
- Job Object process-tree lifetime control
- sandbox worker launch / cancellation

Current status: first AppContainer/Job Object launch implementation. The helper can create/derive an AppContainer profile, grant managed-root ACLs to the AppContainer SID, launch a process with AppContainer security capabilities, attach it to a kill-on-close Job Object, wait for completion, and return pid/exit code.

This is still a low-level launch primitive, not the completed product sandbox: tool execution has not yet been moved into a sandboxed worker protocol.

## Protocol

The helper reads one JSON request from stdin and writes one JSON response to stdout.

Example launch request:

```json
{
  "kind": "launch",
  "requestId": "example",
  "executable": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["worker.js"],
  "cwd": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace\\projects\\demo",
  "managedRoot": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace",
  "sessionDir": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace\\.officeagent\\sessions\\abc",
  "env": {
    "TEMP": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace\\.officeagent\\sessions\\abc\\temp"
  },
  "stdoutPath": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace\\.officeagent\\sessions\\abc\\logs\\stdout.log",
  "stderrPath": "C:\\Users\\me\\AppData\\Local\\OfficeAgent\\workspace\\.officeagent\\sessions\\abc\\logs\\stderr.log",
  "timeoutMs": 300000
}
```

## Development

```bash
cargo build --manifest-path native/windows-sandbox-helper/Cargo.toml
```

Desktop packaging uses `apps/gui/desktop/scripts/build-windows-sandbox-helper.mjs` to copy the release executable into `apps/gui/desktop/build/native/windows-sandbox-helper/`.

## Current launch behavior

- AppContainer profile name is derived from the managed root.
- The helper grants the AppContainer SID inherited read/write/execute access to `managedRoot`, `sessionDir`, and writable grant paths.
- Writable/output paths must remain under `managedRoot`.
- The helper grants inherited read/execute access to read-only grant paths; these may be outside the managed root for approved runtime executable resources.
- The process is created suspended with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`.
- Optional `stdoutPath` / `stderrPath` files are opened by the helper as inheritable child stdio handles.
- The process is assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before resume.
- `CREATE_NO_WINDOW` is used so child stdout/stderr do not pollute the helper's JSON stdout protocol when no explicit output file is provided.
- `timeoutMs` terminates the job and returns exit code `124`.
