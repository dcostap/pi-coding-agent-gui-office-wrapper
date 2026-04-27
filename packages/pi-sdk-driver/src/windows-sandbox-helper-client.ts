import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BashOperations } from "@mariozechner/pi-coding-agent";
import type { OfficeAgentManagedSessionPaths } from "@office-agent/runtime";

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

export interface OfficeAgentSandboxBashOptions {
  readonly managedRootDir: string;
  readonly sessionPaths: OfficeAgentManagedSessionPaths;
  readonly env: NodeJS.ProcessEnv;
}

export function createOfficeAgentSandboxBashOperations(
  options: OfficeAgentSandboxBashOptions,
): BashOperations {
  return {
    exec: async (command, cwd, execOptions) => {
      if (process.platform !== "win32") {
        throw new Error("OfficeAgent sandboxed bash is currently only implemented on Windows.");
      }

      const shellConfig = getWindowsSandboxShellConfig();
      const runId = randomUUID();
      await mkdir(options.sessionPaths.logsDir, { recursive: true });
      const stdoutPath = join(options.sessionPaths.logsDir, `bash-${runId}.stdout.log`);
      const stderrPath = join(options.sessionPaths.logsDir, `bash-${runId}.stderr.log`);
      const timeoutMs = execOptions.timeout && execOptions.timeout > 0
        ? Math.ceil(execOptions.timeout * 1000)
        : undefined;

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      const response = await invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: runId,
        executable: shellConfig.shell,
        args: [...shellConfig.args, command],
        cwd,
        managedRoot: options.managedRootDir,
        sessionDir: options.sessionPaths.sessionDir,
        env: normalizeEnv({
          ...process.env,
          ...options.env,
          ...execOptions.env,
        }),
        readOnlyPaths: shellConfig.readOnlyGrantPaths,
        writablePaths: [options.managedRootDir, options.sessionPaths.sessionDir],
        stdoutPath,
        stderrPath,
        ...(timeoutMs ? { timeoutMs } : {}),
      });

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      if (!response.ok) {
        throw new Error(response.error?.message ?? "OfficeAgent sandbox helper launch failed.");
      }

      const [stdout, stderr] = await Promise.all([
        readFileIfExists(stdoutPath),
        readFileIfExists(stderrPath),
      ]);
      if (stdout.length > 0) {
        execOptions.onData(stdout);
      }
      if (stderr.length > 0) {
        execOptions.onData(stderr);
      }

      return { exitCode: response.result?.exitCode ?? null };
    },
  };
}

export async function invokeWindowsSandboxHelper(
  request: WindowsSandboxLaunchRequest | { readonly kind: "selfTest"; readonly requestId?: string },
): Promise<WindowsSandboxHelperResponse> {
  const helperPath = await resolveWindowsSandboxHelperPath();
  return invokeHelperExecutable(helperPath, request);
}

export async function resolveWindowsSandboxHelperPath(): Promise<string> {
  const candidates = candidateHelperPaths();
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`OfficeAgent Windows sandbox helper was not found. Tried: ${candidates.join(", ")}`);
}

function candidateHelperPaths(): string[] {
  const fileName = "officeagent-windows-sandbox-helper.exe";
  const override = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_HELPER?.trim();
  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = typeof resourcesPathValue === "string" ? resourcesPathValue : undefined;
  return [
    ...(override ? [override] : []),
    ...(resourcesPath ? [join(resourcesPath, "windows-sandbox-helper", fileName)] : []),
    join(process.cwd(), "build", "native", "windows-sandbox-helper", fileName),
    join(process.cwd(), "apps", "gui", "desktop", "build", "native", "windows-sandbox-helper", fileName),
    resolve("apps", "gui", "desktop", "build", "native", "windows-sandbox-helper", fileName),
  ];
}

function invokeHelperExecutable(
  helperPath: string,
  request: WindowsSandboxLaunchRequest | { readonly kind: "selfTest"; readonly requestId?: string },
): Promise<WindowsSandboxHelperResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout || "{}") as WindowsSandboxHelperResponse;
        resolvePromise(parsed);
      } catch (error) {
        reject(new Error(`Invalid sandbox helper response: ${error instanceof Error ? error.message : String(error)}. stderr=${stderr}`));
      }
    });

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function getWindowsSandboxShellConfig(): {
  readonly shell: string;
  readonly args: readonly string[];
  readonly readOnlyGrantPaths: readonly string[];
} {
  const override = process.env.OFFICE_AGENT_SANDBOX_BASH_PATH?.trim();
  if (override) {
    return { shell: override, args: ["-c"], readOnlyGrantPaths: getRuntimeReadOnlyGrantPaths(override) };
  }

  // First bridge: use the Windows system shell because it is AppContainer-compatible on
  // stock Windows. Git Bash in Program Files currently fails under AppContainer on
  // developer machines where OfficeAgent cannot grant ACLs to its installation tree.
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return {
    shell: join(systemRoot, "System32", "cmd.exe"),
    args: ["/d", "/s", "/c"],
    readOnlyGrantPaths: [],
  };
}

function getRuntimeReadOnlyGrantPaths(shell: string): string[] {
  const normalized = shell.replaceAll("/", "\\");
  const gitBinSuffix = "\\Git\\bin\\bash.exe";
  const lower = normalized.toLowerCase();
  if (lower.endsWith(gitBinSuffix.toLowerCase())) {
    return [normalized.slice(0, -gitBinSuffix.length + "\\Git".length)];
  }
  return [shell];
}

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function readFileIfExists(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
