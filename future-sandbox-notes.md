# Future Windows Sandbox Notes

Status: planning notes after accepting the current OfficeAgent Windows sandbox limitations.

## Current accepted baseline

OfficeAgent currently uses a Windows native helper for agent shell commands and direct file-tool writes. The main app remains trusted; agent shell command children and native file-tool writes are constrained separately.

The managed runtime now fails closed when `cwd` is outside the OfficeAgent managed AgentData tree. The previous stock Pi fallback is available only for explicit development/testing via:

```text
OFFICE_AGENT_ALLOW_UNMANAGED_PI_RUNTIME=1
```

Current target root:

```text
%LOCALAPPDATA%\OfficeAgent\AgentData
```

Current command execution model:

- Real Windows process execution.
- No fake shell.
- No command allowlist as the security boundary.
- Medium-integrity restricted token.
- `CreateRestrictedToken(... WRITE_RESTRICTED ...)`.
- `CreateProcessAsUserW`.
- Job object cleanup.
- Agent shell commands may read outside the managed root where Windows permits.
- Network remains allowed.

Current direct file-tool write model:

- Pi `write` and `edit` tool writes go through the native helper, not plain Node `writeFile`.
- The helper first validates that the requested path is lexically under the managed root.
- The helper grants the OfficeAgent managed-root SID to the managed root.
- The helper impersonates a strict write-restricted token for the actual filesystem operation.
- Strict file-tool token policy:
  - `SidsToRestrict = OfficeAgent SID only`
  - no `Everyone` restricting SID
  - no logon restricting SID
- This means symlinks/junctions/reparse targets are taken into account by the OS access check during the actual write, instead of relying only on string path checks.
- A smoke test verifies that native file-tool write succeeds inside AgentData and fails through a junction to an outside `Everyone`-writable directory.

Current preferred shell UX:

1. `pwsh.exe`, if installed.
2. Windows PowerShell `powershell.exe`.
3. `cmd.exe` fallback.

## Important limitation discovered

The current PowerShell-compatible shell-command restricted-token policy uses broad restricting SIDs:

```text
OfficeAgent managed-root SID
current logon SID
Everyone SID
```

This makes PowerShell/pwsh work, but it weakens the strongest write-containment claim.

With `WRITE_RESTRICTED`, Windows write access is checked against the normal token and the restricting SID list. The restricting-side check can be satisfied by any SID in that restricting list. Therefore, if `Everyone` or the current logon SID are included, an outside object that grants write to those principals may be writable.

A targeted test confirmed this:

- Created an outside folder under `C:\Users\Public\...`.
- Granted `Everyone` Modify with `icacls`.
- Ran a sandboxed OfficeAgent `pwsh` command.
- The sandboxed command successfully wrote a file there.

So this claim is not true for shell commands in the current PowerShell-compatible mode:

```text
Writes require the OfficeAgent restricting SID.
```

A more accurate claim is:

```text
OfficeAgent shell commands run with a Windows restricted token and are blocked from many normal outside write targets. However, in the current PowerShell-compatible shell mode, outside objects that explicitly grant write access to broad compatibility principals such as Everyone or the current logon SID may still be writable. Pi write/edit tool writes use a stricter native file-operation path.
```

## Strict restricted-token variant

A stricter variant was tested with:

```text
SidsToRestrict = OfficeAgent SID only
```

Observed behavior:

- `cmd.exe` starts.
- `cmd.exe` can write inside AgentData.
- `cmd.exe` is blocked from writing to an outside `Everyone`-writable test folder.
- PowerShell/pwsh do not currently start correctly.

PowerShell/pwsh failures observed under stricter policies included:

```text
0xC0000142 / DLL initialization failure
Windows PowerShell CLR startup failure, HRESULT 80070005
pwsh BCrypt.dll / CNG / .NET initialization failure
```

This suggests that PowerShell/.NET/CNG/session-object startup currently depends on access satisfied by broad principals such as logon SID and/or Everyone.

## Remote/network drive observations

Protecting remote units is important.

Read-only ACL probes on `R:\` showed no obvious `Everyone` writable ACLs in sampled top-level and random recursive folders. ACLs were mostly domain groups/users, for example:

```text
CASTROSUA\Comercial:(OI)(CI)(M)
CASTROSUA\Tecnica:(OI)(CI)(M)
CASTROSUA\Dario Costa:(OI)(CI)(M)
CASTROSUA\Usuarios del dominio:(OI)(CI)(RX)
```

A GUI-agent test against:

```text
R:\Sistemas
```

showed:

- `Get-ChildItem` failed with Access denied.
- `New-Item` failed with Access denied.

This is good evidence that the current sandbox does not blindly access all of `R:\`. However, it does not prove that all writable remote folders are protected. A conclusive test would require a known harmless remote folder where the normal user can write, then verifying that a sandboxed command cannot write there.

Open question:

```text
How consistently do restricted-token semantics and synthetic restricting SIDs protect SMB/network mapped drives where the normal user's domain account has write permissions?
```

## Accepted product wording for now

Avoid saying:

```text
Agent shell commands can modify only AgentData.
```

unless running a strict mode that has `SidsToRestrict = OfficeAgent SID only` and has passed permissive outside ACL tests.

Safer wording for current PowerShell-compatible mode:

```text
OfficeAgent runs agent shell commands with a Windows restricted token and grants the managed AgentData root writable access. This blocks writes to many normal outside user and system locations. In the current PowerShell-compatible shell mode, compatibility SIDs are also present, so outside objects that explicitly grant write access to broad principals such as Everyone or the current logon SID may still be writable. OfficeAgent's built-in file write/edit tools use a stricter native file-operation path and remain limited to the managed root by both path validation and OS access checks.
```

## Possible future direction: explicit modes

One possible product direction is to expose or internally separate two modes.

### Strict mode

```text
SidsToRestrict = OfficeAgent SID only
Default shell = cmd.exe
```

Pros:

- Stronger write-containment story on local NTFS/DACL-backed targets.
- Blocks outside `Everyone`-writable folder test.

Cons:

- PowerShell/pwsh currently fail.
- Worse agent UX because the tool is still named `bash` but backend syntax is `cmd`.
- Needs clearer prompt guidance.

### PowerShell compatibility mode

```text
SidsToRestrict = OfficeAgent SID + logon SID + Everyone SID
Default shell = pwsh/powershell
```

Pros:

- Good Windows shell UX.
- PowerShell/pwsh work.

Cons:

- Not strict write containment.
- Outside permissive ACLs may be writable.
- Security wording must be weaker and honest.

## Possible future direction: Codex CLI-like elevated sandbox pivot

Codex has a stronger Windows approach using an elevated setup with dedicated lower-privilege sandbox users and filesystem ACL boundaries.

A Codex-like pivot for OfficeAgent could mean:

- Ask for elevation during setup or when enabling secure mode.
- Create/manage one or more dedicated sandbox Windows users or a sandbox user group.
- Grant those sandbox users write access only to OfficeAgent-managed AgentData/project roots.
- Do not grant those sandbox users access to the real user's profile or sensitive remote shares.
- Launch agent commands as the sandbox user.
- Optionally add firewall/network policies later.

Potential benefits:

- Cleaner Windows security primitive than same-user restricted-token tricks.
- Better chance of combining PowerShell-first UX with strong write containment.
- Remote shares and user-profile writes may be naturally blocked unless explicitly granted to the sandbox user.
- Security claim can be stronger if implemented and tested carefully.

Costs/risks:

- Requires admin/elevation/UAC for setup.
- More complex installer and lifecycle management.
- User/account creation may be blocked by enterprise policy.
- Need safe credential/logon handling.
- Need cleanup, upgrades, repair, diagnostics.
- Need to handle profile initialization for the sandbox user.
- Need careful ACL migration and recovery if AgentData moves.
- May surprise users of a consumer-style GUI app.

Potential product shape:

```text
Default: no-admin compatibility mode with honest limitations.
Optional: elevated secure mode for strong containment.
```

Alternative product shape:

```text
Default: elevated secure mode if user accepts UAC setup.
Fallback: limited/no-admin mode with downgraded security claims.
```

## Other future investigation ideas

### Find PowerShell's exact strict-token blocker

Investigate whether PowerShell/pwsh can run with `SidsToRestrict = OfficeAgent SID only` by granting narrow access to the exact missing objects.

Possible probes:

- Native hello-world child.
- Native BCrypt/CNG probe:
  - `LoadLibraryW("bcrypt.dll")`
  - `BCryptGenRandom(..., BCRYPT_USE_SYSTEM_PREFERRED_RNG)`
- Minimal .NET console app.
- `pwsh -NoLogo -NoProfile -NonInteractive`.
- Windows PowerShell with module analysis cache disabled/redirected.
- Token dump utility printing user, groups, restricted SIDs, default DACL, integrity level, privileges.

Diagnostics:

- ProcMon with Access Denied filters and stack traces.
- WinObj/WinObjEx64 for Object Manager namespaces.
- Security auditing/SACLs if practical.
- Compare private desktop/window station vs `winsta0\default`.

Potential environment redirects to test:

```text
TEMP=<sessionDir>\Temp
TMP=<sessionDir>\Temp
LOCALAPPDATA=<managedRoot>\_sandbox_appdata\Local
APPDATA=<managedRoot>\_sandbox_appdata\Roaming
HOME=<managedRoot>\_sandbox_home
USERPROFILE=<managedRoot>\_sandbox_profile
PSModuleAnalysisCachePath=<sessionDir>\ModuleAnalysisCache
POWERSHELL_TELEMETRY_OPTOUT=1
POWERSHELL_UPDATECHECK=Off
POWERSHELL_DIAGNOSTICS_OPTOUT=1
DOTNET_CLI_HOME=<sessionDir>\dotnet
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_EnableDiagnostics=0
```

### Revisit Low Integrity only as a mitigation

A previous Low Integrity path had failures with private profile roots and LocalLow on this machine. It was abandoned in favor of the write-restricted model.

However, one future hybrid idea is:

```text
PowerShell-compatible broad restricting SIDs + Low Integrity + low-labeled AgentData
```

This could block writes to many normal medium-integrity outside locations even if DACLs are permissive. It is not a complete path-based write boundary, especially for low-labeled external targets, no-DACL filesystems, network shares, or special objects.

### AppContainer/broker path

AppContainer previously broke real shell UX:

- `dir /b` returned Access denied.
- PowerShell FileSystem provider initialization failed.
- `GetVolumeInformationW("C:\")` failed with Access denied.

A future AppContainer design would likely need a broker and careful capability/namespace design. It should not be revived casually if real shell behavior is a hard requirement.

### File-system broker/minifilter

A kernel minifilter or brokered filesystem layer could enforce path-based write containment more directly, including cases where Windows restricted-token semantics are insufficient.

Costs are high:

- Driver signing/deployment.
- Enterprise/security software friction.
- Complex correctness burden.
- Not suitable as a quick product fix.

## Smoke tests to add later

Future smoke tests should include permissive outside ACLs, not only default outside paths.

Test outside directories with grants to:

```text
Everyone: S-1-1-0
current logon SID: S-1-5-5-X-Y
Authenticated Users: S-1-5-11
Builtin Users: S-1-5-32-545
INTERACTIVE: S-1-5-4
```

For each:

- Create unique outside test dir.
- Preserve/delete safely.
- Grant test SID Modify.
- Run sandboxed write attempt.
- Assert outside file does not exist in strict mode.
- Assert inside write still works.

Remote drive smoke, if safe:

- Choose a harmless folder on a mapped drive where the normal user can write.
- Verify sandboxed shell cannot write there in strict/elevated mode.
- Do not run destructive tests on sensitive shares.

## Current unresolved decision

The current same-user, PowerShell-compatible restricted-token model is useful but does not fully support the strongest write-containment claim.

The major future decision is whether OfficeAgent should:

1. Keep the current compatibility model and use weaker, honest wording.
2. Add a strict `cmd`-based mode for stronger no-admin containment.
3. Pivot to a Codex CLI-like elevated sandbox user model for strong containment with better shell compatibility.
4. Continue deep investigation to make PowerShell run with strict restricted SIDs.

No final decision is recorded here. These notes are intended to preserve the current understanding and future options.
