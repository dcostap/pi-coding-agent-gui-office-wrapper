import { spawn } from "node:child_process";
import {
  checkOfficeAgentWindowsSandboxSetup,
  prepareOfficeAgentWindowsSandboxReset,
  prepareOfficeAgentWindowsSandboxSetup,
} from "../../../../../../../packages/pi-sdk-driver/src/windows-sandbox-helper-client";
import { getOfficeAgentManagedRootDir } from "../../../../../../../packages/office-agent-runtime/src/index";
import type { DesktopRequestHandlerMap } from "../../../../../shared/desktop-ipc";
import type {
  WindowsSandboxSetupHandoff,
  WindowsSandboxSetupStatus,
} from "../../../../../shared/desktop-contracts";

type WindowsSandboxHandlers = Pick<
  DesktopRequestHandlerMap,
  "getWindowsSandboxSetupStatus" | "prepareWindowsSandboxSetup" | "runWindowsSandboxSetup"
>;

function resultString(result: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = result?.[key];
  return typeof value === "string" ? value : undefined;
}

function resultBoolean(result: Readonly<Record<string, unknown>> | undefined, key: string): boolean | undefined {
  const value = result?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function resultIssues(result: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const value = result?.issues;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function resultStringArray(result: Readonly<Record<string, unknown>> | undefined, key: string): readonly string[] | undefined {
  const value = result?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function mapStatusResponse(response: Awaited<ReturnType<typeof checkOfficeAgentWindowsSandboxSetup>>): WindowsSandboxSetupStatus {
  const result = response.result;
  if (!response.ok) {
    return {
      available: false,
      ready: false,
      issues: [],
      error: response.error?.message ?? "Windows sandbox setup status check failed.",
    };
  }
  return {
    available: true,
    ready: resultBoolean(result, "ready") === true,
    status: resultString(result, "status"),
    managedRoot: resultString(result, "managedRoot"),
    issues: resultIssues(result),
    username: resultString(result, "username"),
    groupName: resultString(result, "groupName"),
    markerPresent: resultBoolean(result, "markerPresent"),
    secretsPresent: resultBoolean(result, "secretsPresent"),
    passwordDecrypts: resultBoolean(result, "passwordDecrypts"),
    credentialLogonWorks: resultBoolean(result, "credentialLogonWorks"),
    secondaryLogonServiceRunning: resultBoolean(result, "secondaryLogonServiceRunning"),
    capabilitySidsPresent: resultBoolean(result, "capabilitySidsPresent"),
    sandboxUserExists: resultBoolean(result, "sandboxUserExists"),
    networkRestricted: resultBoolean(result, "networkRestricted"),
  };
}

function mapHandoffResponse(
  action: "setup" | "reset",
  response: Awaited<ReturnType<typeof prepareOfficeAgentWindowsSandboxSetup>>,
): WindowsSandboxSetupHandoff {
  const result = response.result;
  if (!response.ok) {
    return {
      ok: false,
      action,
      error: response.error?.message ?? "Windows sandbox setup handoff preparation failed.",
    };
  }
  return {
    ok: true,
    action,
    requiresElevation: resultBoolean(result, "requiresElevation"),
    setupCommand: resultString(result, "setupCommand"),
    setupExePath: resultString(result, "setupExePath"),
    setupArgs: resultStringArray(result, "setupArgs"),
    payloadPath: resultString(result, "payloadPath"),
    username: resultString(result, "username"),
    groupName: resultString(result, "groupName"),
    intendedRealUserSid: resultString(result, "intendedRealUserSid"),
  };
}

function quotePowerShellSingleQuotedString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function encodePowerShellCommand(script: string) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function launchElevatedSandboxSetup(
  handoff: WindowsSandboxSetupHandoff,
  managedRootDir: string,
): Promise<WindowsSandboxSetupHandoff> {
  if (!handoff.ok) return handoff;
  if (!handoff.setupExePath || !handoff.setupArgs?.length) {
    return {
      ...handoff,
      ok: false,
      error: "Windows sandbox setup command was not prepared correctly.",
    };
  }

  const quotedExe = quotePowerShellSingleQuotedString(handoff.setupExePath);
  const quotedArgs = handoff.setupArgs.map(quotePowerShellSingleQuotedString).join(", ");
  const elevatedScript = `
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'OfficeAgent Windows sandbox ${handoff.action} is running with administrator permissions...' -ForegroundColor Cyan
Write-Host 'Please wait. This window will close automatically when setup succeeds.' -ForegroundColor Gray
Write-Host ''
$setupExe = ${quotedExe}
$setupArgs = @(${quotedArgs})
& $setupExe @setupArgs
$exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
Write-Host ''
if ($exitCode -eq 0) {
  Write-Host 'OfficeAgent Windows sandbox ${handoff.action} completed successfully.' -ForegroundColor Green
  Write-Host 'You can now return to Castrosua IA and retry.' -ForegroundColor Gray
  Start-Sleep -Seconds 3
} else {
  Write-Host "OfficeAgent Windows sandbox ${handoff.action} failed with exit code $exitCode." -ForegroundColor Red
  Write-Host 'Leave this window open if you need to copy the error above.' -ForegroundColor Yellow
  Start-Sleep -Seconds 20
}
exit $exitCode
`;
  const encodedElevatedScript = encodePowerShellCommand(elevatedScript);
  const elevatedPowerShell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const argumentList = `-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedElevatedScript}`;
  const script = `$p = Start-Process -FilePath ${quotePowerShellSingleQuotedString(elevatedPowerShell)} -ArgumentList ${quotePowerShellSingleQuotedString(argumentList)} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });

  const status = await checkOfficeAgentWindowsSandboxSetup(managedRootDir).catch(() => null);
  const readyAfterRun = status?.ok === true && status.result?.ready === true;
  return {
    ...handoff,
    launched: true,
    exitCode,
    readyAfterRun,
    ...(exitCode !== 0 && !readyAfterRun
      ? { ok: false, error: `Windows sandbox setup exited with code ${exitCode}.` }
      : {}),
  };
}

export function createWindowsSandboxHandlers(): WindowsSandboxHandlers {
  return {
    getWindowsSandboxSetupStatus: async () => {
      if (process.platform !== "win32") {
        return {
          available: false,
          ready: false,
          issues: [],
          error: "Windows sandbox setup is only available on Windows.",
        };
      }
      const managedRootDir = getOfficeAgentManagedRootDir();
      return mapStatusResponse(await checkOfficeAgentWindowsSandboxSetup(managedRootDir));
    },
    prepareWindowsSandboxSetup: async ({ action }) => {
      const requestedAction = action === "reset" ? "reset" : "setup";
      if (process.platform !== "win32") {
        return {
          ok: false,
          action: requestedAction,
          error: "Windows sandbox setup is only available on Windows.",
        };
      }
      const managedRootDir = getOfficeAgentManagedRootDir();
      const response = requestedAction === "reset"
        ? await prepareOfficeAgentWindowsSandboxReset(managedRootDir)
        : await prepareOfficeAgentWindowsSandboxSetup({ managedRoot: managedRootDir });
      return mapHandoffResponse(requestedAction, response);
    },
    runWindowsSandboxSetup: async ({ action }) => {
      const requestedAction = action === "reset" ? "reset" : "setup";
      if (process.platform !== "win32") {
        return {
          ok: false,
          action: requestedAction,
          error: "Windows sandbox setup is only available on Windows.",
        };
      }
      const managedRootDir = getOfficeAgentManagedRootDir();
      const response = requestedAction === "reset"
        ? await prepareOfficeAgentWindowsSandboxReset(managedRootDir)
        : await prepareOfficeAgentWindowsSandboxSetup({ managedRoot: managedRootDir });
      return launchElevatedSandboxSetup(mapHandoffResponse(requestedAction, response), managedRootDir);
    },
  };
}
