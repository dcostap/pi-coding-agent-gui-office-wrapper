export type WindowsSandboxSetupAction = "setup" | "reset";

export interface WindowsSandboxSetupStatus {
  readonly available: boolean;
  readonly ready: boolean;
  readonly status?: string;
  readonly managedRoot?: string;
  readonly issues: readonly string[];
  readonly username?: string;
  readonly groupName?: string;
  readonly markerPresent?: boolean;
  readonly secretsPresent?: boolean;
  readonly passwordDecrypts?: boolean;
  readonly credentialLogonWorks?: boolean;
  readonly secondaryLogonServiceRunning?: boolean;
  readonly capabilitySidsPresent?: boolean;
  readonly sandboxUserExists?: boolean;
  readonly networkRestricted?: boolean;
  readonly error?: string;
}

export interface WindowsSandboxRepairResult {
  readonly ok: boolean;
  readonly kind: "secondary-logon";
  readonly launched?: boolean;
  readonly exitCode?: number;
  readonly readyAfterRun?: boolean;
  readonly error?: string;
}

export interface WindowsSandboxLaunchStatus {
  readonly ok: boolean;
  readonly ready: boolean;
  readonly status?: string;
  readonly issue?: string;
  readonly secondaryLogonLikelyBlocked?: boolean;
  readonly error?: string;
}

export interface WindowsSandboxSetupHandoff {
  readonly ok: boolean;
  readonly action: WindowsSandboxSetupAction;
  readonly requiresElevation?: boolean;
  readonly setupCommand?: string;
  readonly setupExePath?: string;
  readonly setupArgs?: readonly string[];
  readonly payloadPath?: string;
  readonly username?: string;
  readonly groupName?: string;
  readonly intendedRealUserSid?: string;
  readonly launched?: boolean;
  readonly exitCode?: number;
  readonly readyAfterRun?: boolean;
  readonly error?: string;
}
