import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

export interface WindowsSandboxLaunchRequest {
  readonly kind: "launch";
  readonly requestId?: string;
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly managedRoot: string;
  readonly sessionDir: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly readOnlyPaths?: readonly string[];
  readonly writablePaths?: readonly string[];
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  readonly timeoutMs?: number;
}

export interface WindowsSandboxHelperResponse {
  readonly ok: boolean;
  readonly requestId?: string;
  readonly result?: {
    readonly pid: number;
    readonly exitCode?: number;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export async function invokeWindowsSandboxHelper(
  request: WindowsSandboxLaunchRequest | { readonly kind: "selfTest"; readonly requestId?: string },
): Promise<WindowsSandboxHelperResponse> {
  const helperPath = await resolveWindowsSandboxHelperPath();
  return invokeHelperExecutable(helperPath, request);
}

export async function resolveWindowsSandboxHelperPath(): Promise<string> {
  const candidatePaths = candidateHelperPaths();
  for (const candidate of candidatePaths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`OfficeAgent Windows sandbox helper was not found. Tried: ${candidatePaths.join(", ")}`);
}

function candidateHelperPaths(): string[] {
  const fileName = process.platform === "win32"
    ? "officeagent-windows-sandbox-helper.exe"
    : "officeagent-windows-sandbox-helper";
  const override = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_HELPER?.trim();
  return [
    ...(override ? [override] : []),
    path.join(process.resourcesPath, "windows-sandbox-helper", fileName),
    path.join(__dirname, "..", "..", "build", "native", "windows-sandbox-helper", fileName),
    path.join(process.cwd(), "build", "native", "windows-sandbox-helper", fileName),
  ];
}

function invokeHelperExecutable(
  helperPath: string,
  request: WindowsSandboxLaunchRequest | { readonly kind: "selfTest"; readonly requestId?: string },
): Promise<WindowsSandboxHelperResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout || "{}") as WindowsSandboxHelperResponse;
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid sandbox helper response: ${error instanceof Error ? error.message : String(error)}. stderr=${stderr}`));
      }
    });

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}
