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
  "getWindowsSandboxSetupStatus" | "prepareWindowsSandboxSetup"
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
    payloadPath: resultString(result, "payloadPath"),
    username: resultString(result, "username"),
    groupName: resultString(result, "groupName"),
    intendedRealUserSid: resultString(result, "intendedRealUserSid"),
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
  };
}
