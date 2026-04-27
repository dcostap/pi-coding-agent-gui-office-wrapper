import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BashOperations } from "@mariozechner/pi-coding-agent";
import {
  getOfficeAgentStagedGitBashCandidatePaths,
  getOfficeAgentStagedGitBashDir,
  OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME,
  OFFICE_AGENT_STAGED_GIT_BASH_DIR_ENV_NAME,
  type OfficeAgentManagedSessionPaths,
} from "@office-agent/runtime";

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

export type OfficeAgentSandboxShellBackend = "cmd" | "powershell" | "git-bash";

export interface OfficeAgentSandboxShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  readonly readOnlyGrantPaths: readonly string[];
  readonly backend: OfficeAgentSandboxShellBackend;
  readonly kind: "bash-path-override" | "staged-git-bash" | "cmd-fallback";
  readonly runtimeDir?: string;
}

export function createOfficeAgentSandboxBashOperations(
  options: OfficeAgentSandboxBashOptions,
): BashOperations {
  return {
    exec: async (command, cwd, execOptions) => {
      if (process.platform !== "win32") {
        throw new Error("OfficeAgent sandboxed bash is currently only implemented on Windows.");
      }

      const shellConfig = await ensureOfficeAgentSandboxShellConfig(options.managedRootDir);
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
        env: createSandboxEnvironment(shellConfig, options.env, execOptions.env),
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

export async function ensureOfficeAgentSandboxShellConfig(managedRootDir: string): Promise<OfficeAgentSandboxShellConfig> {
  const current = resolveOfficeAgentSandboxShellConfig(managedRootDir);
  if (current.kind !== "cmd-fallback") {
    return current;
  }

  const bundledRuntimeDir = findBundledGitBashRuntimeDir();
  if (!bundledRuntimeDir) {
    return current;
  }

  const targetRuntimeDir = getOfficeAgentStagedGitBashDir(managedRootDir);
  await mkdir(dirname(targetRuntimeDir), { recursive: true });
  await cp(bundledRuntimeDir, targetRuntimeDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  return resolveOfficeAgentSandboxShellConfig(managedRootDir);
}

export function resolveOfficeAgentSandboxShellConfig(managedRootDir: string): OfficeAgentSandboxShellConfig {
  const directOverride = process.env[OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME]?.trim();
  if (directOverride) {
    const runtimeDir = inferRuntimeDirFromBashPath(directOverride);
    return {
      shell: directOverride,
      args: ["-c"],
      readOnlyGrantPaths: getRuntimeReadOnlyGrantPaths(directOverride),
      backend: "git-bash",
      kind: "bash-path-override",
      ...(runtimeDir ? { runtimeDir } : {}),
    };
  }

  const stagedGitBashEnabled = process.env.OFFICE_AGENT_ENABLE_STAGED_GIT_BASH === "1";
  const stagedOverrideDir = process.env[OFFICE_AGENT_STAGED_GIT_BASH_DIR_ENV_NAME]?.trim();
  if (stagedOverrideDir && stagedGitBashEnabled) {
    const stagedOverride = resolveStagedGitBashConfig(stagedOverrideDir);
    if (stagedOverride) {
      return stagedOverride;
    }
    throw new Error(
      `${OFFICE_AGENT_STAGED_GIT_BASH_DIR_ENV_NAME} is set but no bash.exe was found under ${stagedOverrideDir}`,
    );
  }

  if (stagedGitBashEnabled) {
    const defaultStagedDir = getOfficeAgentStagedGitBashDir(managedRootDir);
    const defaultStaged = resolveStagedGitBashConfig(defaultStagedDir);
    if (defaultStaged) {
      return defaultStaged;
    }
  }

  // Temporary development fallback. The product target is to stage OfficeAgent-controlled
  // Git Bash under the managed root so the model-facing `bash` tool is actually Bash.
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return {
    shell: join(systemRoot, "System32", "cmd.exe"),
    args: ["/d", "/s", "/c"],
    readOnlyGrantPaths: [],
    backend: "cmd",
    kind: "cmd-fallback",
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

function resolveStagedGitBashConfig(runtimeDir: string): OfficeAgentSandboxShellConfig | undefined {
  const shell = getOfficeAgentStagedGitBashCandidatePaths(runtimeDir).find((candidate) => existsSync(candidate));
  if (!shell) {
    return undefined;
  }
  return {
    shell,
    args: ["-c"],
    readOnlyGrantPaths: [runtimeDir],
    backend: "git-bash",
    kind: "staged-git-bash",
    runtimeDir,
  };
}

function findBundledGitBashRuntimeDir(): string | undefined {
  if (process.env.OFFICE_AGENT_ENABLE_STAGED_GIT_BASH !== "1") {
    return undefined;
  }
  const override = process.env.OFFICE_AGENT_BUNDLED_GIT_BASH_DIR?.trim();
  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = typeof resourcesPathValue === "string" ? resourcesPathValue : undefined;
  const candidates = [
    ...(override ? [override] : []),
    ...(resourcesPath ? [join(resourcesPath, "runtime", "git-bash", "v1")] : []),
    join(process.cwd(), "build", "runtime", "git-bash", "v1"),
    join(process.cwd(), "apps", "gui", "desktop", "build", "runtime", "git-bash", "v1"),
    resolve("apps", "gui", "desktop", "build", "runtime", "git-bash", "v1"),
  ];
  return candidates.find((candidate) => resolveStagedGitBashConfig(candidate) !== undefined);
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

function getRuntimeReadOnlyGrantPaths(shell: string): string[] {
  const runtimeDir = inferRuntimeDirFromBashPath(shell);
  return runtimeDir ? [runtimeDir] : [shell];
}

function inferRuntimeDirFromBashPath(shell: string): string | undefined {
  const normalized = shell.replaceAll("/", "\\");
  const lower = normalized.toLowerCase();
  for (const suffix of ["\\bin\\bash.exe", "\\usr\\bin\\bash.exe"]) {
    if (lower.endsWith(suffix)) {
      return normalized.slice(0, -suffix.length);
    }
  }
  return dirname(shell);
}

function createSandboxEnvironment(
  shellConfig: OfficeAgentSandboxShellConfig,
  sessionEnv: NodeJS.ProcessEnv,
  commandEnv: NodeJS.ProcessEnv | undefined,
): Record<string, string> {
  const systemRoot = firstDefined(process.env.SystemRoot, process.env.SYSTEMROOT, "C:\\Windows");
  const comSpec = firstDefined(process.env.ComSpec, process.env.COMSPEC, join(systemRoot, "System32", "cmd.exe"));
  const pathEntries = [
    ...(shellConfig.runtimeDir ? [join(shellConfig.runtimeDir, "bin"), join(shellConfig.runtimeDir, "usr", "bin")] : []),
    join(systemRoot, "System32"),
    systemRoot,
  ];

  const env: Record<string, string> = {
    SystemRoot: systemRoot,
    SYSTEMROOT: systemRoot,
    ComSpec: comSpec,
    COMSPEC: comSpec,
    PATHEXT: firstDefined(process.env.PATHEXT, ".COM;.EXE;.BAT;.CMD"),
    Path: pathEntries.join(";"),
    PATH: pathEntries.join(";"),
  };

  copyEnvKeys(env, sessionEnv, [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "npm_config_cache",
    "NPM_CONFIG_CACHE",
    "npm_config_prefix",
    "NPM_CONFIG_PREFIX",
    "PIP_CACHE_DIR",
    "PYTHONUSERBASE",
    "OFFICE_AGENT_SESSION_DIR",
    "OFFICE_AGENT_SESSION_LOGS_DIR",
  ]);
  copyEnvKeys(env, commandEnv, [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "npm_config_cache",
    "NPM_CONFIG_CACHE",
    "npm_config_prefix",
    "NPM_CONFIG_PREFIX",
    "PIP_CACHE_DIR",
    "PYTHONUSERBASE",
    "OFFICE_AGENT_SESSION_DIR",
    "OFFICE_AGENT_SESSION_LOGS_DIR",
  ]);
  return env;
}

function copyEnvKeys(target: Record<string, string>, source: NodeJS.ProcessEnv | undefined, keys: readonly string[]): void {
  if (!source) {
    return;
  }
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

function firstDefined(...values: Array<string | undefined>): string {
  const value = values.find((entry) => entry !== undefined && entry.length > 0);
  if (value === undefined) {
    throw new Error("Expected at least one defined value.");
  }
  return value;
}

async function readFileIfExists(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
