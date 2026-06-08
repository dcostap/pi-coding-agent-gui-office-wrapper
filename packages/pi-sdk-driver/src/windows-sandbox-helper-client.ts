import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
  getOfficeAgentPythonRuntimeCurrentManifestPath,
  getOfficeAgentPythonRuntimeDir,
  getOfficeAgentPythonRuntimeRootDir,
  getOfficeAgentPythonRuntimeShimsDir,
  getOfficeAgentRealUserFolders,
  getOfficeAgentStagedGitBashCandidatePaths,
  getOfficeAgentStagedGitBashDir,
  getOfficeAgentUvRuntimeCurrentManifestPath,
  getOfficeAgentUvRuntimeDir,
  getOfficeAgentUvRuntimeRootDir,
  getOfficeAgentUvRuntimeShimsDir,
  OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME,
  OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME,
  OFFICE_AGENT_STAGED_GIT_BASH_DIR_ENV_NAME,
  OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME,
  type OfficeAgentManagedProjectStatePaths,
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
  readonly writablePaths?: readonly string[];
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
  readonly stdinContent?: string;
  readonly timeoutMs?: number;
}

export interface WindowsSandboxFileWriteRequest {
  readonly kind: "fileWrite";
  readonly requestId?: string;
  readonly managedRoot: string;
  readonly path: string;
  readonly content: string;
  readonly createParentDirs?: boolean;
}

export interface WindowsSandboxMkdirRequest {
  readonly kind: "mkdir";
  readonly requestId?: string;
  readonly managedRoot: string;
  readonly path: string;
}

export interface WindowsSandboxPrepareSetupRequest {
  readonly kind: "prepareSandboxSetup";
  readonly requestId?: string;
  readonly action?: "setup" | "reset";
  readonly managedRoot: string;
  readonly projectRoot?: string;
  readonly projectStateDir?: string;
  readonly sessionDir?: string;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
}

export interface WindowsSandboxCheckSetupRequest {
  readonly kind: "checkSandboxSetup";
  readonly requestId?: string;
  readonly managedRoot: string;
}

export interface WindowsSandboxRunnerSelfTestRequest {
  readonly kind: "sandboxRunnerSelfTest";
  readonly requestId?: string;
  readonly managedRoot: string;
}

export type WindowsSandboxHelperRequest =
  | WindowsSandboxLaunchRequest
  | WindowsSandboxFileWriteRequest
  | WindowsSandboxMkdirRequest
  | WindowsSandboxPrepareSetupRequest
  | WindowsSandboxCheckSetupRequest
  | WindowsSandboxRunnerSelfTestRequest
  | { readonly kind: "selfTest"; readonly requestId?: string };

export interface WindowsSandboxHelperResponse {
  readonly ok: boolean;
  readonly requestId?: string;
  readonly result?: Readonly<{
    readonly pid?: number;
    readonly exitCode?: number;
    readonly [key: string]: unknown;
  }>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly diagnosticCode?: string;
    readonly secondaryLogonLikelyBlocked?: boolean;
    readonly windowsErrorCodes?: Readonly<Record<string, string>>;
  };
}

export interface OfficeAgentSandboxBashOptions {
  readonly managedRootDir: string;
  readonly sessionPaths: OfficeAgentManagedSessionPaths;
  readonly projectStatePaths?: OfficeAgentManagedProjectStatePaths;
  readonly env: NodeJS.ProcessEnv;
  readonly shellConfig?: OfficeAgentSandboxShellConfig;
}

export type OfficeAgentSandboxShellBackend = "cmd" | "powershell" | "pwsh" | "git-bash";

export interface OfficeAgentManagedToolRuntimeConfig {
  readonly runtimeId: string;
  readonly runtimeDir: string;
  readonly executable: string;
  readonly pathEntries: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly version?: string;
}

export interface OfficeAgentSandboxShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  readonly inheritedHostPathEntries: readonly string[];
  readonly prependPathEntries: readonly string[];
  readonly backend: OfficeAgentSandboxShellBackend;
  readonly kind: "bash-path-override" | "staged-git-bash" | "cmd-fallback" | "windows-powershell" | "pwsh";
  readonly runtimeDir?: string;
  readonly pythonRuntime?: OfficeAgentManagedToolRuntimeConfig;
  readonly uvRuntime?: OfficeAgentManagedToolRuntimeConfig;
}

export function createOfficeAgentSandboxBashOperations(
  options: OfficeAgentSandboxBashOptions,
): BashOperations {
  let managedPythonSelfTest: Promise<void> | undefined;
  return {
    exec: async (command, cwd, execOptions) => {
      if (process.platform !== "win32") {
        throw new Error("OfficeAgent sandboxed bash is currently only implemented on Windows.");
      }

      const shellConfig = options.shellConfig ?? await ensureOfficeAgentSandboxShellConfig(options.managedRootDir);
      const runId = randomUUID();
      await mkdirWithOfficeAgentSandbox(options.managedRootDir, options.sessionPaths.logsDir);
      const stdoutPath = join(options.sessionPaths.logsDir, `bash-${runId}.stdout.log`);
      const stderrPath = join(options.sessionPaths.logsDir, `bash-${runId}.stderr.log`);
      const timeoutMs = execOptions.timeout && execOptions.timeout > 0
        ? Math.ceil(execOptions.timeout * 1000)
        : undefined;
      const pythonCompatDir = await ensureOfficeAgentSessionPythonCompat(options.managedRootDir, options.sessionPaths);
      const sandboxEnv = createSandboxEnvironment(shellConfig, options.env, execOptions.env, cwd);
      prependPathLikeEnv(sandboxEnv, "PYTHONPATH", pythonCompatDir);

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      if (shellConfig.pythonRuntime && commandMayUseManagedPython(command)) {
        managedPythonSelfTest ??= runOfficeAgentManagedPythonSelfTest({
          managedRootDir: options.managedRootDir,
          sessionPaths: options.sessionPaths,
          ...(options.projectStatePaths ? { projectStatePaths: options.projectStatePaths } : {}),
          shellConfig,
          env: sandboxEnv,
          cwd,
          ...(execOptions.signal ? { signal: execOptions.signal } : {}),
        });
        try {
          await managedPythonSelfTest;
        } catch (error) {
          managedPythonSelfTest = undefined;
          throw error;
        }
      }

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      const commandLaunch = await prepareSandboxCommandLaunch(command, shellConfig, options.managedRootDir, options.sessionPaths.sessionDir, runId);

      const response = await invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: runId,
        executable: shellConfig.shell,
        args: commandLaunch.args,
        cwd,
        managedRoot: options.managedRootDir,
        sessionDir: options.sessionPaths.sessionDir,
        env: sandboxEnv,
        writablePaths: [
          cwd,
          ...getOfficeAgentSessionWritablePaths(options.sessionPaths),
          ...(options.projectStatePaths ? getOfficeAgentProjectStateWritablePaths(options.projectStatePaths) : []),
          ...getOfficeAgentToolRuntimeWritablePaths(shellConfig),
          ...commandLaunch.writableScriptPaths,
        ],
        stdoutPath,
        stderrPath,
        ...(timeoutMs ? { timeoutMs } : {}),
      }, execOptions.signal ? { signal: execOptions.signal } : undefined);

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      if (!response.ok) {
        throw new Error(formatWindowsSandboxHelperError(response, "OfficeAgent sandbox helper launch failed."));
      }

      const responseStdout = typeof response.result?.stdout === "string" ? Buffer.from(response.result.stdout) : undefined;
      const responseStderr = typeof response.result?.stderr === "string" ? Buffer.from(response.result.stderr) : undefined;
      const [rawStdout, rawStderr] = responseStdout !== undefined || responseStderr !== undefined
        ? [responseStdout ?? Buffer.alloc(0), responseStderr ?? Buffer.alloc(0)]
        : await Promise.all([
          readFileIfExists(stdoutPath),
          readFileIfExists(stderrPath),
        ]);
      const stdout = filterSandboxOutputBuffer(rawStdout);
      const stderr = filterSandboxOutputBuffer(rawStderr);
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

function commandMayUseManagedPython(command: string): boolean {
  return /(^|[\s&|()<>])(?:python3?|py|pip3?|uvx?)(?:\.exe|\.cmd)?(?=$|[\s&|()<>])/i.test(command);
}

function getOfficeAgentSessionWritablePaths(paths: OfficeAgentManagedSessionPaths): string[] {
  return [
    paths.sessionDir,
    paths.profileDir,
    paths.appDataDir,
    paths.localAppDataDir,
    paths.tempDir,
    paths.scratchDir,
    paths.logsDir,
    getOfficeAgentSessionPythonCompatDir(paths),
  ];
}

function getOfficeAgentToolRuntimeWritablePaths(shellConfig: OfficeAgentSandboxShellConfig): string[] {
  // The v2 helper applies launch-time ACLs only to writable paths. Include hidden,
  // OfficeAgent-owned runtime paths so the sandbox account can read/execute shims
  // and bundled executables created after initial setup.
  return [
    ...(shellConfig.pythonRuntime
      ? [shellConfig.pythonRuntime.runtimeDir, ...shellConfig.pythonRuntime.pathEntries]
      : []),
    ...(shellConfig.uvRuntime
      ? [shellConfig.uvRuntime.runtimeDir, ...shellConfig.uvRuntime.pathEntries]
      : []),
  ];
}

function getOfficeAgentProjectStateWritablePaths(paths: OfficeAgentManagedProjectStatePaths): string[] {
  return [
    paths.projectStateDir,
    paths.cacheDir,
    paths.configDir,
    paths.dataDir,
    paths.toolsDir,
    paths.binDir,
    paths.scratchDir,
    paths.npmCacheDir,
    paths.npmPrefixDir,
    paths.pipCacheDir,
    paths.pipConfigPath,
    paths.pythonUserBaseDir,
    paths.pythonEnvDir,
    paths.uvCacheDir,
    paths.uvToolDir,
    paths.uvToolBinDir,
    paths.uvPythonInstallDir,
    paths.uvPythonBinDir,
  ];
}

function getOfficeAgentSessionPythonCompatDir(paths: OfficeAgentManagedSessionPaths): string {
  return join(paths.sessionDir, "python-compat");
}

function getOfficeAgentPythonSiteCustomizeSource(): string {
  return [
    "import os",
    "import subprocess",
    "import tempfile",
    "import uuid",
    "_officeagent_tmp = os.environ.get('TMPDIR') or os.environ.get('TEMP') or os.environ.get('TMP')",
    "_officeagent_orig_mkdir = os.mkdir",
    "_officeagent_orig_mkdtemp = tempfile.mkdtemp",
    "_officeagent_orig_named_temporary_file = tempfile.NamedTemporaryFile",
    "def _officeagent_cmd_mkdir(path):",
    "    cmd = os.environ.get('COMSPEC') or os.environ.get('ComSpec') or 'cmd.exe'",
    "    completed = subprocess.run([cmd, '/d', '/q', '/c', 'mkdir', os.fspath(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)",
    "    return completed.returncode == 0",
    "def _officeagent_mkdir(path, mode=0o777, *, dir_fd=None):",
    "    # Python 3.12+ maps mode=0o700 on Windows to an owner-only DACL. That breaks",
    "    # OfficeAgent's write-restricted token because the token also needs the managed",
    "    # restricting SID to be present on created temp directories. Use an inheritable",
    "    # mode for sandbox-created directories so children keep the parent OfficeAgent ACE.",
    "    create_mode = 0o777 if mode == 0o700 else mode",
    "    try:",
    "        return _officeagent_orig_mkdir(path, create_mode, dir_fd=dir_fd) if dir_fd is not None else _officeagent_orig_mkdir(path, create_mode)",
    "    except OSError:",
    "        if dir_fd is None and isinstance(path, (str, bytes, os.PathLike)):",
    "            if _officeagent_cmd_mkdir(path):",
    "                return None",
    "        raise",
    "os.mkdir = _officeagent_mkdir",
    "if _officeagent_tmp:",
    "    try:",
    "        os.makedirs(_officeagent_tmp, exist_ok=True)",
    "        tempfile.tempdir = _officeagent_tmp",
    "    except OSError:",
    "        pass",
    "def _officeagent_mkdtemp(suffix=None, prefix=None, dir=None):",
    "    suffix = '' if suffix is None else suffix",
    "    prefix = 'tmp' if prefix is None else prefix",
    "    dir = tempfile.gettempdir() if dir is None else dir",
    "    for _ in range(100):",
    "        path = os.path.join(dir, prefix + uuid.uuid4().hex[:8] + suffix)",
    "        if os.path.exists(path):",
    "            continue",
    "        try:",
    "            _officeagent_orig_mkdir(path, 0o777)",
    "            return path",
    "        except FileExistsError:",
    "            continue",
    "        except OSError:",
    "            try:",
    "                if _officeagent_cmd_mkdir(path):",
    "                    return path",
    "            except OSError:",
    "                break",
    "    return _officeagent_orig_mkdtemp(suffix=suffix, prefix=prefix, dir=dir)",
    "tempfile.mkdtemp = _officeagent_mkdtemp",
    "class _OfficeAgentNamedTemporaryFile:",
    "    def __init__(self, file, name, delete=True):",
    "        self.file = file",
    "        self.name = name",
    "        self.delete = delete",
    "        self._closed = False",
    "    def __getattr__(self, name):",
    "        return getattr(self.file, name)",
    "    def __enter__(self):",
    "        self.file.__enter__()",
    "        return self",
    "    def __exit__(self, exc_type, exc, tb):",
    "        try:",
    "            return self.file.__exit__(exc_type, exc, tb)",
    "        finally:",
    "            self._delete_if_needed()",
    "    def close(self):",
    "        try:",
    "            return self.file.close()",
    "        finally:",
    "            self._delete_if_needed()",
    "    def _delete_if_needed(self):",
    "        if self.delete and not self._closed:",
    "            self._closed = True",
    "            try:",
    "                os.unlink(self.name)",
    "            except OSError:",
    "                pass",
    "def _officeagent_named_temporary_file(mode='w+b', buffering=-1, encoding=None, newline=None, suffix=None, prefix=None, dir=None, delete=True, errors=None, delete_on_close=True):",
    "    suffix = '' if suffix is None else suffix",
    "    prefix = 'tmp' if prefix is None else prefix",
    "    dir = tempfile.gettempdir() if dir is None else dir",
    "    for _ in range(100):",
    "        path = os.path.join(dir, prefix + uuid.uuid4().hex[:8] + suffix)",
    "        if os.path.exists(path):",
    "            continue",
    "        try:",
    "            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o666)",
    "            file = os.fdopen(fd, mode, buffering=buffering, encoding=encoding, errors=errors, newline=newline)",
    "            return _OfficeAgentNamedTemporaryFile(file, path, delete=delete and delete_on_close)",
    "        except FileExistsError:",
    "            continue",
    "        except OSError:",
    "            break",
    "    return _officeagent_orig_named_temporary_file(mode=mode, buffering=buffering, encoding=encoding, newline=newline, suffix=suffix, prefix=prefix, dir=dir, delete=delete, errors=errors)",
    "tempfile.NamedTemporaryFile = _officeagent_named_temporary_file",
    "",
  ].join("\n");
}

async function ensureOfficeAgentSessionPythonCompat(
  managedRootDir: string,
  paths: OfficeAgentManagedSessionPaths,
): Promise<string> {
  const pythonCompatDir = getOfficeAgentSessionPythonCompatDir(paths);
  await mkdirWithOfficeAgentSandbox(managedRootDir, pythonCompatDir);
  await writeFileWithOfficeAgentSandbox(
    managedRootDir,
    join(pythonCompatDir, "sitecustomize.py"),
    getOfficeAgentPythonSiteCustomizeSource(),
    { createParentDirs: true },
  );
  return pythonCompatDir;
}

function prependPathLikeEnv(env: Record<string, string>, key: string, entry: string): void {
  const existing = env[key];
  env[key] = existing && existing.length > 0 ? `${entry}${delimiter}${existing}` : entry;
}

export async function ensureOfficeAgentSandboxShellConfig(managedRootDir: string): Promise<OfficeAgentSandboxShellConfig> {
  let current = resolveOfficeAgentSandboxShellConfig(managedRootDir);

  if (current.kind === "cmd-fallback") {
    const bundledRuntimeDir = findBundledGitBashRuntimeDir();
    if (bundledRuntimeDir) {
      const targetRuntimeDir = getOfficeAgentStagedGitBashDir(managedRootDir);
      await mkdir(dirname(targetRuntimeDir), { recursive: true });
      await cp(bundledRuntimeDir, targetRuntimeDir, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
      current = resolveOfficeAgentSandboxShellConfig(managedRootDir);
    }
  }

  return ensureOfficeAgentManagedToolRuntimes(current, managedRootDir);
}

async function prepareSandboxCommandLaunch(
  command: string,
  shellConfig: OfficeAgentSandboxShellConfig,
  managedRootDir: string,
  sessionDir: string,
  runId: string,
): Promise<{ args: string[]; writableScriptPaths: string[] }> {
  if (shellConfig.backend === "cmd") {
    const commandScriptPath = join(sessionDir, `bash-${runId}.cmd`);
    await writeFileWithOfficeAgentSandbox(managedRootDir, commandScriptPath, `@echo off\r\n${command}\r\n`, { createParentDirs: true });
    return { args: ["/d", "/q", "/c", commandScriptPath], writableScriptPaths: [commandScriptPath] };
  }

  if (shellConfig.backend === "powershell" || shellConfig.backend === "pwsh") {
    const commandScriptPath = join(sessionDir, `bash-${runId}.ps1`);
    await writeFileWithOfficeAgentSandbox(managedRootDir, commandScriptPath, `${command}\r\n`, { createParentDirs: true });
    return { args: [...shellConfig.args, commandScriptPath], writableScriptPaths: [commandScriptPath] };
  }

  return { args: [...shellConfig.args, command], writableScriptPaths: [] };
}

async function runOfficeAgentManagedPythonSelfTest(options: {
  readonly managedRootDir: string;
  readonly sessionPaths: OfficeAgentManagedSessionPaths;
  readonly projectStatePaths?: OfficeAgentManagedProjectStatePaths;
  readonly shellConfig: OfficeAgentSandboxShellConfig;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  if (!options.shellConfig.pythonRuntime) {
    if (process.env.OFFICE_AGENT_ALLOW_HOST_PYTHON_FALLBACK === "1") {
      return;
    }
    throw new Error("OfficeAgent Python runtime unavailable; refusing to run commands with host Python fallback.");
  }

  const pythonEnv = options.env.OFFICE_AGENT_PYTHON_ENV ?? options.env.VIRTUAL_ENV;
  if (!pythonEnv) {
    throw new Error("OfficeAgent managed Python environment is not configured for this session.");
  }

  const runId = `python-selftest-${randomUUID()}`;
  const stdoutPath = join(options.sessionPaths.logsDir, `${runId}.stdout.log`);
  const stderrPath = join(options.sessionPaths.logsDir, `${runId}.stderr.log`);
  const pythonProbe = [
    "import os,sys",
    "env=os.environ.get('OFFICE_AGENT_PYTHON_ENV') or os.environ.get('VIRTUAL_ENV')",
    "expected=os.path.normcase(os.path.abspath(os.path.join(env,'Scripts','python.exe')))",
    "actual=os.path.normcase(os.path.abspath(sys.executable))",
    "print(sys.executable)",
    "raise SystemExit(0 if actual == expected else 73)",
  ].join("; ");
  const commands = [
    `python -c ${quoteWindowsCmdArgument(pythonProbe)}`,
    "pip --version",
    "python -m pip --version",
    "py -m pip --version",
    ...(options.shellConfig.uvRuntime ? ["uv python find"] : []),
  ];
  const commandScriptPath = join(options.sessionPaths.sessionDir, `${runId}.cmd`);
  await writeFileWithOfficeAgentSandbox(
    options.managedRootDir,
    commandScriptPath,
    [
      "@echo off",
      ...commands.flatMap((selfTestCommand) => [
        selfTestCommand,
        "if errorlevel 1 exit /b %ERRORLEVEL%",
      ]),
      "",
    ].join("\r\n"),
    { createParentDirs: true },
  );
  const systemRoot = firstDefined(getEnvCaseInsensitive(process.env, "SystemRoot"), "C:\\Windows");
  const cmdExe = firstDefined(getEnvCaseInsensitive(process.env, "ComSpec"), join(systemRoot, "System32", "cmd.exe"));
  const response = await invokeWindowsSandboxHelper({
    kind: "launch",
    requestId: runId,
    executable: cmdExe,
    args: ["/d", "/q", "/c", commandScriptPath],
    cwd: options.cwd,
    managedRoot: options.managedRootDir,
    sessionDir: options.sessionPaths.sessionDir,
    env: options.env,
    writablePaths: [
      options.cwd,
      ...getOfficeAgentSessionWritablePaths(options.sessionPaths),
      ...(options.projectStatePaths ? getOfficeAgentProjectStateWritablePaths(options.projectStatePaths) : []),
      ...getOfficeAgentToolRuntimeWritablePaths(options.shellConfig),
    ],
    stdoutPath,
    stderrPath,
    timeoutMs: 180_000,
  }, options.signal ? { signal: options.signal } : undefined);

  const [stdout, stderr] = await Promise.all([
    readFileIfExists(stdoutPath),
    readFileIfExists(stderrPath),
  ]);
  const fileOutput = filterSandboxOutputBuffer(Buffer.concat([stdout, stderr])).toString("utf8").trim();
  const responseOutput = filterSandboxOutputBuffer(
    Buffer.from(`${response.result?.stdout ?? ""}${response.result?.stderr ?? ""}`, "utf8"),
  ).toString("utf8").trim();
  const output = fileOutput || responseOutput;
  if (!response.ok || response.result?.exitCode !== 0) {
    const detail = response.error
      ? formatWindowsSandboxHelperError(response, output)
      : output;
    throw new Error([
      "OfficeAgent managed Python startup self-test failed.",
      `Expected python/pip/py to resolve to the hidden managed environment: ${pythonEnv}`,
      ...(detail ? [`Details: ${detail}`] : []),
    ].join("\n"));
  }
}

function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function resolveOfficeAgentSandboxShellConfig(managedRootDir: string): OfficeAgentSandboxShellConfig {
  const inheritedHostPathEntries = getInheritedHostPathEntries();
  const defaultShell = process.env.OFFICE_AGENT_SANDBOX_DEFAULT_SHELL?.trim().toLowerCase();
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const windowsPowerShellPath = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const pwshOnPath = findExecutableOnPath("pwsh.exe");

  if (defaultShell === "powershell" || defaultShell === "windows-powershell") {
    return createWindowsPowerShellShellConfig(windowsPowerShellPath, inheritedHostPathEntries);
  }

  if (defaultShell === "pwsh") {
    return createPwshShellConfig(resolvePwshPath(), inheritedHostPathEntries);
  }

  if (defaultShell === "cmd") {
    return createCmdShellConfig(systemRoot, inheritedHostPathEntries);
  }

  if (process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND?.trim().toLowerCase() === "codex-v2") {
    // Phase 2 v2 currently launches reliably through cmd. PowerShell under the
    // dedicated sandbox identity can hang on some machines until the named-pipe
    // runner path is complete, so prefer cmd unless explicitly overridden.
    return createCmdShellConfig(systemRoot, inheritedHostPathEntries);
  }

  if (pwshOnPath) {
    return createPwshShellConfig(pwshOnPath, inheritedHostPathEntries);
  }

  if (existsSync(windowsPowerShellPath)) {
    return createWindowsPowerShellShellConfig(windowsPowerShellPath, inheritedHostPathEntries);
  }

  const directOverride = process.env[OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME]?.trim();
  if (directOverride) {
    const runtimeDir = inferRuntimeDirFromBashPath(directOverride);
    return withHostPathCompatibility({
      shell: directOverride,
      args: ["-c"],
      inheritedHostPathEntries,
      prependPathEntries: [],
      backend: "git-bash",
      kind: "bash-path-override",
      ...(runtimeDir ? { runtimeDir } : {}),
    });
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
  return createCmdShellConfig(systemRoot, inheritedHostPathEntries);
}

function createPwshShellConfig(shell: string, inheritedHostPathEntries: readonly string[]): OfficeAgentSandboxShellConfig {
  return withHostPathCompatibility({
    shell,
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"],
    inheritedHostPathEntries,
    prependPathEntries: [],
    backend: "pwsh",
    kind: "pwsh",
  });
}

function createWindowsPowerShellShellConfig(shell: string, inheritedHostPathEntries: readonly string[]): OfficeAgentSandboxShellConfig {
  return withHostPathCompatibility({
    shell,
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"],
    inheritedHostPathEntries,
    prependPathEntries: [],
    backend: "powershell",
    kind: "windows-powershell",
  });
}

function createCmdShellConfig(systemRoot: string, inheritedHostPathEntries: readonly string[]): OfficeAgentSandboxShellConfig {
  return withHostPathCompatibility({
    shell: join(systemRoot, "System32", "cmd.exe"),
    args: ["/d", "/q", "/c"],
    inheritedHostPathEntries,
    prependPathEntries: [],
    backend: "cmd",
    kind: "cmd-fallback",
  });
}

export function getOfficeAgentSandboxShellPromptContext(shellConfig: OfficeAgentSandboxShellConfig): string {
  const shellDisplay = `${shellConfig.backend} (${shellConfig.shell})`;
  const invocation = shellConfig.backend === "cmd"
    ? `cmd.exe /d /q /c <script.cmd>`
    : shellConfig.backend === "powershell"
      ? `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script.ps1>`
      : shellConfig.backend === "pwsh"
        ? `pwsh.exe -NoLogo -NoProfile -NonInteractive -File <script.ps1>`
        : `${shellConfig.shell} ${shellConfig.args.join(" ")} <command>`;
  const syntax = shellConfig.backend === "cmd"
    ? "Use cmd.exe syntax by default. PowerShell is still callable explicitly with powershell.exe or pwsh.exe when available. Bare PowerShell aliases such as pwd/ls are not native to cmd.exe."
    : shellConfig.backend === "powershell" || shellConfig.backend === "pwsh"
      ? "Use PowerShell syntax by default. Bare pwd/ls/Get-ChildItem work in this shell. Use cmd.exe /d /q /c \"...\" when you specifically need cmd semantics."
      : "Use Bash syntax by default for this Git Bash backend. PowerShell and cmd.exe may still be callable explicitly when available.";
  return [
    "## OfficeAgent Windows command runtime",
    `The tool named \`bash\` is currently OfficeAgent Windows shell exec, not necessarily GNU Bash. Actual backend: ${shellDisplay}.`,
    `Commands are launched as: ${invocation}.`,
    syntax,
    "Commands run as real Windows processes with OfficeAgent write containment. They can modify only the OfficeAgent AgentData/managed project tree. Standard user folders (Desktop, Documents, Downloads, Pictures, Videos, Music, Temp) are intended to be readable after sandbox setup; other outside reads may fail according to Windows permissions.",
    "USERPROFILE/HOME/APPDATA/LOCALAPPDATA are sandbox-private per-session locations. For the active workspace, use %OFFICE_AGENT_WORKSPACE% in commands. Use %OFFICE_AGENT_TOOL_FILES% for files produced/materialized by tools and %OFFICE_AGENT_SCRATCH% for hidden temporary scripts/intermediate files. For user-facing folders, use OFFICE_AGENT_REAL_USER_DESKTOP, OFFICE_AGENT_REAL_USER_DOWNLOADS, OFFICE_AGENT_REAL_USER_DOCUMENTS, OFFICE_AGENT_REAL_USER_PICTURES, OFFICE_AGENT_REAL_USER_VIDEOS, OFFICE_AGENT_REAL_USER_MUSIC, and OFFICE_AGENT_REAL_USER_TEMP.",
    "Python commands are routed through OfficeAgent's hidden managed Python environment. Use normal python/py/pip/python -m pip/uv pip commands; do not create pylibs or .venv folders in the visible workspace.",
  ].join("\n");
}

export async function invokeWindowsSandboxHelper(
  request: WindowsSandboxHelperRequest,
  options?: { readonly signal?: AbortSignal },
): Promise<WindowsSandboxHelperResponse> {
  const helperPath = await resolveWindowsSandboxHelperPath();
  return invokeHelperExecutable(helperPath, request, options);
}

function formatWindowsSandboxHelperError(response: WindowsSandboxHelperResponse, fallback: string): string {
  const error = response.error;
  if (!error) {
    return fallback;
  }
  const details = [error.message || fallback];
  if (error.code && !details[0]?.includes(error.code)) {
    details.push(`Error code: ${error.code}`);
  }
  if (error.diagnosticCode && error.diagnosticCode !== error.code && !details[0]?.includes(error.diagnosticCode)) {
    details.push(`Diagnostic code: ${error.diagnosticCode}`);
  }
  if (error.secondaryLogonLikelyBlocked === true) {
    details.push("Secondary Logon likely blocked: true");
  }
  const windowsErrorCodes = error.windowsErrorCodes ? Object.entries(error.windowsErrorCodes) : [];
  if (windowsErrorCodes.length > 0) {
    details.push(`Windows error codes: ${windowsErrorCodes.map(([key, value]) => `${key}=${value}`).join(", ")}`);
  }
  return details.join("\n");
}

export async function writeFileWithOfficeAgentSandbox(
  managedRootDir: string,
  path: string,
  content: string,
  options?: { readonly createParentDirs?: boolean },
): Promise<void> {
  const response = await invokeWindowsSandboxHelper({
    kind: "fileWrite",
    requestId: randomUUID(),
    managedRoot: managedRootDir,
    path,
    content,
    createParentDirs: options?.createParentDirs ?? false,
  });
  if (!response.ok) {
    throw new Error(response.error?.message ?? "OfficeAgent sandbox helper file write failed.");
  }
}

export async function mkdirWithOfficeAgentSandbox(managedRootDir: string, path: string): Promise<void> {
  const response = await invokeWindowsSandboxHelper({
    kind: "mkdir",
    requestId: randomUUID(),
    managedRoot: managedRootDir,
    path,
  });
  if (!response.ok) {
    throw new Error(response.error?.message ?? "OfficeAgent sandbox helper mkdir failed.");
  }
}

export async function checkOfficeAgentWindowsSandboxSetup(
  managedRootDir: string,
): Promise<WindowsSandboxHelperResponse> {
  return invokeWindowsSandboxHelper({
    kind: "checkSandboxSetup",
    requestId: randomUUID(),
    managedRoot: managedRootDir,
  });
}

export async function prepareOfficeAgentWindowsSandboxSetup(
  request: Omit<WindowsSandboxPrepareSetupRequest, "kind" | "requestId" | "action"> & {
    readonly action?: "setup" | "reset";
    readonly requestId?: string;
  },
): Promise<WindowsSandboxHelperResponse> {
  return invokeWindowsSandboxHelper({
    kind: "prepareSandboxSetup",
    requestId: request.requestId ?? randomUUID(),
    action: request.action ?? "setup",
    managedRoot: request.managedRoot,
    ...(request.projectRoot ? { projectRoot: request.projectRoot } : {}),
    ...(request.projectStateDir ? { projectStateDir: request.projectStateDir } : {}),
    ...(request.sessionDir ? { sessionDir: request.sessionDir } : {}),
    ...(request.readRoots ? { readRoots: request.readRoots } : {}),
    ...(request.writeRoots ? { writeRoots: request.writeRoots } : {}),
  });
}

export async function prepareOfficeAgentWindowsSandboxReset(
  managedRootDir: string,
): Promise<WindowsSandboxHelperResponse> {
  return prepareOfficeAgentWindowsSandboxSetup({
    action: "reset",
    managedRoot: managedRootDir,
  });
}

export async function runOfficeAgentWindowsSandboxRunnerSelfTest(
  managedRootDir: string,
): Promise<WindowsSandboxHelperResponse> {
  return invokeWindowsSandboxHelper({
    kind: "sandboxRunnerSelfTest",
    requestId: randomUUID(),
    managedRoot: managedRootDir,
  });
}

export async function ensureOfficeAgentWindowsSandboxV2Ready(options: {
  readonly managedRootDir: string;
  readonly projectRoot?: string;
  readonly projectStateDir?: string;
  readonly sessionDir?: string;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
}): Promise<void> {
  if (!isOfficeAgentWindowsSandboxV2Enabled()) {
    return;
  }
  const check = await checkOfficeAgentWindowsSandboxSetup(options.managedRootDir);
  if (check.ok && check.result?.ready === true) {
    return;
  }
  const setupReadRoots = options.readRoots ?? getOfficeAgentStandardReadableRoots();
  const setup = await prepareOfficeAgentWindowsSandboxSetup({
    managedRoot: options.managedRootDir,
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    ...(options.projectStateDir ? { projectStateDir: options.projectStateDir } : {}),
    ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
    ...(setupReadRoots.length > 0 ? { readRoots: setupReadRoots } : {}),
    ...(options.writeRoots ? { writeRoots: options.writeRoots } : {}),
  });
  const issues = Array.isArray(check.result?.issues) ? check.result.issues.join("; ") : check.error?.message;
  const setupCommand = typeof setup.result?.setupCommand === "string" ? setup.result.setupCommand : undefined;
  throw new Error([
    "OfficeAgent Windows sandbox v2 setup is required before commands can run.",
    ...(issues ? [`Readiness issues: ${issues}`] : []),
    ...(setupCommand ? [`Run this command elevated, then retry: ${setupCommand}`] : []),
  ].join("\n"));
}

function isOfficeAgentWindowsSandboxV2Enabled(): boolean {
  return process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND?.trim().toLowerCase() === "codex-v2";
}

export function getOfficeAgentStandardReadableRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform !== "win32") {
    return [];
  }
  const folders = getOfficeAgentRealUserFolders(env);
  return uniqueExistingDirectories([
    folders.desktop,
    folders.documents,
    folders.downloads,
    folders.pictures,
    folders.videos,
    folders.music,
    folders.temp,
  ]);
}

function uniqueExistingDirectories(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pathValue of paths) {
    const resolved = resolve(pathValue);
    const key = normalize(resolved).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      if (statSync(resolved).isDirectory()) {
        result.push(resolved);
      }
    } catch {
      // Missing redirected/disabled known folders are simply not granted.
    }
  }
  return result;
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

function resolvePwshPath(): string {
  const override = process.env.OFFICE_AGENT_SANDBOX_PWSH_PATH?.trim();
  if (override) {
    return override;
  }
  return findExecutableOnPath("pwsh.exe") ?? "pwsh.exe";
}

function findExecutableOnPath(fileName: string): string | undefined {
  for (const pathEntry of getInheritedHostPathEntries()) {
    const candidate = join(pathEntry, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveStagedGitBashConfig(runtimeDir: string): OfficeAgentSandboxShellConfig | undefined {
  const shell = getOfficeAgentStagedGitBashCandidatePaths(runtimeDir).find((candidate) => existsSync(candidate));
  if (!shell) {
    return undefined;
  }
  return withHostPathCompatibility({
    shell,
    args: ["-c"],
    inheritedHostPathEntries: getInheritedHostPathEntries(),
    prependPathEntries: [],
    backend: "git-bash",
    kind: "staged-git-bash",
    runtimeDir,
  });
}

function findBundledGitBashRuntimeDir(): string | undefined {
  if (process.env.OFFICE_AGENT_ENABLE_STAGED_GIT_BASH !== "1") {
    return undefined;
  }
  const override = process.env.OFFICE_AGENT_BUNDLED_GIT_BASH_DIR?.trim();
  const resourcesPath = getElectronResourcesPath();
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
  const resourcesPath = getElectronResourcesPath();
  return [
    ...(override ? [override] : []),
    ...(resourcesPath ? [join(resourcesPath, "windows-sandbox-helper", fileName)] : []),
    join(process.cwd(), "build", "native", "windows-sandbox-helper", fileName),
    join(process.cwd(), "apps", "gui", "desktop", "build", "native", "windows-sandbox-helper", fileName),
    resolve("apps", "gui", "desktop", "build", "native", "windows-sandbox-helper", fileName),
    resolve("native", "windows-sandbox-helper", "target", "debug", fileName),
    resolve("native", "windows-sandbox-helper", "target", "release", fileName),
    resolve("..", "..", "native", "windows-sandbox-helper", "target", "debug", fileName),
    resolve("..", "..", "native", "windows-sandbox-helper", "target", "release", fileName),
  ];
}

function invokeHelperExecutable(
  helperPath: string,
  request: WindowsSandboxHelperRequest,
  options?: { readonly signal?: AbortSignal },
): Promise<WindowsSandboxHelperResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (options?.signal?.aborted) {
      rejectPromise(new Error("aborted"));
      return;
    }

    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    const watchdogMs = getHelperWatchdogMs(request);
    const watchdog = watchdogMs === undefined
      ? undefined
      : setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          cleanupAbortListener();
          child.kill();
          rejectPromise(new Error(`OfficeAgent sandbox helper did not respond within ${watchdogMs}ms. stderr=${stderr}`));
        }, watchdogMs);

    const cleanupAbortListener = () => {
      options?.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      cleanupAbortListener();
      child.kill();
      rejectPromise(new Error("aborted"));
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    const reject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      cleanupAbortListener();
      rejectPromise(error);
    };
    const resolve = (response: WindowsSandboxHelperResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      cleanupAbortListener();
      resolvePromise(response);
    };

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
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid sandbox helper response: ${error instanceof Error ? error.message : String(error)}. stderr=${stderr}`));
      }
    });

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function getHelperWatchdogMs(request: WindowsSandboxHelperRequest): number | undefined {
  if (request.kind === "launch") {
    return typeof request.timeoutMs === "number"
      ? Math.max(30_000, request.timeoutMs + 15_000)
      : undefined;
  }
  return 30_000;
}

async function ensureOfficeAgentManagedToolRuntimes(
  config: OfficeAgentSandboxShellConfig,
  managedRootDir: string,
): Promise<OfficeAgentSandboxShellConfig> {
  // TODO(runtime): Add an OfficeAgent-bundled Node.js/npm runtime here, staged under
  // `.officeagent/runtime/node`, so agent `node`/`npm`/`npx` behavior is reproducible
  // and does not depend on the host machine's PATH installation.
  const [pythonRuntime, uvRuntime] = await Promise.all([
    ensureOfficeAgentPythonRuntime(managedRootDir),
    ensureOfficeAgentUvRuntime(managedRootDir),
  ]);

  const uvPathEntries = uvRuntime?.pathEntries ?? await ensureOfficeAgentUvUnavailablePathEntries(managedRootDir);
  const pythonPathEntries = pythonRuntime?.pathEntries
    ?? await ensureOfficeAgentPythonUnavailablePathEntries(managedRootDir);

  return withHostPathCompatibility({
    ...config,
    prependPathEntries: [
      ...pythonPathEntries,
      ...uvPathEntries,
      ...config.prependPathEntries,
    ],
    ...(pythonRuntime ? { pythonRuntime } : {}),
    ...(uvRuntime ? { uvRuntime } : {}),
  });
}

interface OfficeAgentBundledRuntimeManifest {
  readonly kind?: string;
  readonly runtimeId?: string;
  readonly version?: string;
  readonly pythonVersion?: string;
  readonly uvVersion?: string;
  readonly executableRelativePath?: string;
  readonly scriptsRelativePath?: string;
}

async function ensureOfficeAgentPythonRuntime(managedRootDir: string): Promise<OfficeAgentManagedToolRuntimeConfig | undefined> {
  const sourceDir = await findBundledToolRuntimeDir(
    OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME,
    "OFFICE_AGENT_BUNDLED_PYTHON_RUNTIME_DIR",
    "python",
  ) ?? await findManagedToolRuntimeDir(
    getOfficeAgentPythonRuntimeRootDir(managedRootDir),
    OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME,
  );
  if (!sourceDir) {
    return undefined;
  }

  const manifest = await readToolRuntimeManifest(sourceDir, OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME);
  const runtimeId = requiredManifestString(manifest.runtimeId, OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME, "runtimeId");
  const targetDir = getOfficeAgentPythonRuntimeDir(managedRootDir, runtimeId);
  const pythonRelativePath = manifest.executableRelativePath ?? "python.exe";
  const pythonExe = join(targetDir, pythonRelativePath);
  await ensureManagedRuntimeCopied(sourceDir, targetDir, pythonExe);

  const shimsDir = getOfficeAgentPythonRuntimeShimsDir(managedRootDir);
  await mkdir(shimsDir, { recursive: true });
  const pythonShim = join(shimsDir, "python-shim.py");
  const pipShim = join(shimsDir, "pip-shim.py");
  const siteCustomize = join(shimsDir, "sitecustomize.py");
  await Promise.all([
    writeCmdShim(join(shimsDir, "python.cmd"), `@echo off\r\n"${pythonExe}" "${pythonShim}" %*\r\n`),
    writeCmdShim(join(shimsDir, "python3.cmd"), `@echo off\r\n"${pythonExe}" "${pythonShim}" %*\r\n`),
    writeCmdShim(join(shimsDir, "py.cmd"), `@echo off\r\n"${pythonExe}" "${pythonShim}" %*\r\n`),
    writePosixShim(join(shimsDir, "python"), [pythonExe, pythonShim]),
    writePosixShim(join(shimsDir, "python3"), [pythonExe, pythonShim]),
    writePosixShim(join(shimsDir, "py"), [pythonExe, pythonShim]),
    writeFile(pythonShim, getOfficeAgentPythonShimSource(pythonExe), "utf8"),
    writeFile(pipShim, getOfficeAgentPipShimSource(pythonExe), "utf8"),
    writeFile(siteCustomize, getOfficeAgentPythonSiteCustomizeSource(), "utf8"),
    writeCmdShim(join(shimsDir, "pip.cmd"), `@echo off\r\n"${pythonExe}" "${pipShim}" %*\r\n`),
    writeCmdShim(join(shimsDir, "pip3.cmd"), `@echo off\r\n"${pythonExe}" "${pipShim}" %*\r\n`),
    writePosixShim(join(shimsDir, "pip"), [pythonExe, pipShim]),
    writePosixShim(join(shimsDir, "pip3"), [pythonExe, pipShim]),
  ]);

  await writeCurrentRuntimeManifest(getOfficeAgentPythonRuntimeCurrentManifestPath(managedRootDir), {
    ...manifest,
    runtimeId,
    runtimeDir: targetDir,
    executable: pythonExe,
  });

  const version = manifest.pythonVersion ?? manifest.version;
  return {
    runtimeId,
    runtimeDir: targetDir,
    executable: pythonExe,
    pathEntries: [shimsDir],
    environment: {
      PYTHONPATH: shimsDir,
    },
    ...(version ? { version } : {}),
  };
}

async function ensureOfficeAgentPythonUnavailablePathEntries(managedRootDir: string): Promise<readonly string[]> {
  if (process.env.OFFICE_AGENT_ALLOW_HOST_PYTHON_FALLBACK === "1") {
    return [];
  }

  const shimsDir = getOfficeAgentPythonRuntimeShimsDir(managedRootDir);
  await mkdir(shimsDir, { recursive: true });
  const message = [
    "OfficeAgent Python runtime unavailable.",
    "Reinstall OfficeAgent or run the runtime preparation step so officeagent-python-runtime.json is packaged.",
    "Host Python fallback is disabled to keep packages out of the Windows profile and visible workspace.",
  ].join(" ");
  await Promise.all([
    writeCmdShim(join(shimsDir, "python.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeCmdShim(join(shimsDir, "python3.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeCmdShim(join(shimsDir, "py.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeCmdShim(join(shimsDir, "pip.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeCmdShim(join(shimsDir, "pip3.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeUnavailablePosixShim(join(shimsDir, "python"), message),
    writeUnavailablePosixShim(join(shimsDir, "python3"), message),
    writeUnavailablePosixShim(join(shimsDir, "py"), message),
    writeUnavailablePosixShim(join(shimsDir, "pip"), message),
    writeUnavailablePosixShim(join(shimsDir, "pip3"), message),
  ]);
  return [shimsDir];
}

function getOfficeAgentPythonShimSource(pythonExe: string): string {
  return [
    "import os",
    "import subprocess",
    "import sys",
    `PYTHON_EXE = r'''${pythonExe}'''`,
    ...getOfficeAgentManagedPythonSupportSource(),
    "raw_args = sys.argv[1:]",
    "args = _strip_py_launcher_version_args(raw_args)",
    "if len(args) >= 2 and args[0] == '-m' and args[1] == 'pip':",
    "    env_python = _ensure_managed_env(required=True)",
    "    _run([env_python, '-m', 'pip', *_normalize_pip_args(args[2:])])",
    "if len(args) >= 2 and args[0] == '-m' and args[1] == 'venv':",
    "    _ensure_managed_env(required=True)",
    "    print(f'OfficeAgent already maintains a hidden Python environment for this workspace at {MANAGED_ENV}', file=sys.stderr)",
    "    print('Visible virtualenv creation is disabled to keep dependency files out of the workspace. Use normal python and pip commands; they already use the hidden environment.', file=sys.stderr)",
    "    raise SystemExit(2)",
    "env_python = _ensure_managed_env(required=True)",
    "_run([env_python, *args])",
    "",
  ].join("\n");
}

function getOfficeAgentPipShimSource(pythonExe: string): string {
  return [
    "import os",
    "import subprocess",
    "import sys",
    `PYTHON_EXE = r'''${pythonExe}'''`,
    ...getOfficeAgentManagedPythonSupportSource(),
    "args = _normalize_pip_args(sys.argv[1:])",
    "env_python = _ensure_managed_env(required=True)",
    "_run([env_python, '-m', 'pip', *args])",
    "",
  ].join("\n");
}

function getOfficeAgentManagedPythonSupportSource(): string[] {
  return [
    "MANAGED_ENV = os.environ.get('OFFICE_AGENT_PYTHON_ENV') or os.environ.get('VIRTUAL_ENV')",
    "def _run(argv):",
    "    raise SystemExit(subprocess.call(argv))",
    "def _strip_py_launcher_version_args(values):",
    "    args = list(values)",
    "    while args and len(args[0]) >= 2 and args[0][0] == '-' and args[0][1].isdigit():",
    "        args.pop(0)",
    "    return args",
    "def _managed_env_python_path():",
    "    if not MANAGED_ENV:",
    "        return None",
    "    return os.path.join(MANAGED_ENV, 'Scripts', 'python.exe')",
    "def _ensure_managed_env(required=False):",
    "    env_python = _managed_env_python_path()",
    "    if not env_python:",
    "        if required:",
    "            print('OfficeAgent managed Python environment is not configured (OFFICE_AGENT_PYTHON_ENV is missing).', file=sys.stderr)",
    "            raise SystemExit(1)",
    "        return None",
    "    if os.path.exists(env_python):",
    "        return env_python",
    "    os.makedirs(MANAGED_ENV, exist_ok=True)",
    "    code = subprocess.call([PYTHON_EXE, '-m', 'venv', '--without-pip', MANAGED_ENV])",
    "    if code == 0:",
    "        code = subprocess.call([env_python, '-m', 'ensurepip', '--upgrade', '--default-pip'])",
    "    if code != 0:",
    "        if required:",
    "            print(f'OfficeAgent could not create managed Python environment at {MANAGED_ENV}', file=sys.stderr)",
    "            raise SystemExit(code or 1)",
    "        return None",
    "    return env_python",
    "def _normalize_pip_args(values):",
    "    args = []",
    "    iterator = iter(values)",
    "    for arg in iterator:",
    "        if arg in ('--user', '--no-user'):",
    "            continue",
    "        if arg in ('--target', '-t', '--prefix', '--root', '--python'):",
    "            next(iterator, None)",
    "            print(f'OfficeAgent installs Python packages into the hidden managed environment; pip {arg} is disabled. Use plain pip install <package>.', file=sys.stderr)",
    "            raise SystemExit(2)",
    "        if arg.startswith('--target=') or arg.startswith('--prefix=') or arg.startswith('--root=') or arg.startswith('--python='):",
    "            print('OfficeAgent installs Python packages into the hidden managed environment; pip target/prefix/root/python overrides are disabled. Use plain pip install <package>.', file=sys.stderr)",
    "            raise SystemExit(2)",
    "        args.append(arg)",
    "    return args",
  ];
}

async function ensureOfficeAgentUvRuntime(managedRootDir: string): Promise<OfficeAgentManagedToolRuntimeConfig | undefined> {
  const sourceDir = await findBundledToolRuntimeDir(
    OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME,
    "OFFICE_AGENT_BUNDLED_UV_RUNTIME_DIR",
    "uv",
  ) ?? await findManagedToolRuntimeDir(
    getOfficeAgentUvRuntimeRootDir(managedRootDir),
    OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME,
  );
  if (!sourceDir) {
    return undefined;
  }

  const manifest = await readToolRuntimeManifest(sourceDir, OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME);
  const runtimeId = requiredManifestString(manifest.runtimeId, OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME, "runtimeId");
  const targetDir = getOfficeAgentUvRuntimeDir(managedRootDir, runtimeId);
  const uvRelativePath = manifest.executableRelativePath ?? "uv.exe";
  const uvExe = join(targetDir, uvRelativePath);
  await ensureManagedRuntimeCopied(sourceDir, targetDir, uvExe);

  const shimsDir = getOfficeAgentUvRuntimeShimsDir(managedRootDir);
  const uvShim = join(shimsDir, "uv-shim.py");
  await mkdir(shimsDir, { recursive: true });
  await Promise.all([
    writeCmdShim(join(shimsDir, "uv.cmd"), `@echo off\r\nif defined OFFICE_AGENT_PYTHON_EXE (\r\n  "%OFFICE_AGENT_PYTHON_EXE%" "${uvShim}" "${uvExe}" %*\r\n) else (\r\n  "${uvExe}" %*\r\n)\r\n`),
    writeCmdShim(join(shimsDir, "uvx.cmd"), `@echo off\r\nif defined OFFICE_AGENT_PYTHON_EXE (\r\n  "%OFFICE_AGENT_PYTHON_EXE%" "${uvShim}" "${uvExe}" tool run %*\r\n) else (\r\n  "${uvExe}" tool run %*\r\n)\r\n`),
    writePosixShim(join(shimsDir, "uv"), ["python", uvShim, uvExe]),
    writePosixShim(join(shimsDir, "uvx"), ["python", uvShim, uvExe, "tool", "run"]),
    writeFile(uvShim, getOfficeAgentUvShimSource(), "utf8"),
  ]);

  await writeCurrentRuntimeManifest(getOfficeAgentUvRuntimeCurrentManifestPath(managedRootDir), {
    ...manifest,
    runtimeId,
    runtimeDir: targetDir,
    executable: uvExe,
  });

  const version = manifest.uvVersion ?? manifest.version;
  return {
    runtimeId,
    runtimeDir: targetDir,
    executable: uvExe,
    pathEntries: [shimsDir],
    ...(version ? { version } : {}),
  };
}

async function ensureOfficeAgentUvUnavailablePathEntries(managedRootDir: string): Promise<readonly string[]> {
  if (process.env.OFFICE_AGENT_ALLOW_HOST_UV_FALLBACK === "1") {
    return [];
  }

  const shimsDir = getOfficeAgentUvRuntimeShimsDir(managedRootDir);
  await mkdir(shimsDir, { recursive: true });
  const message = "OfficeAgent uv runtime unavailable. Use pip/python, or bundle uv with officeagent-uv-runtime.json.";
  await Promise.all([
    writeCmdShim(join(shimsDir, "uv.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeCmdShim(join(shimsDir, "uvx.cmd"), `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n`),
    writeUnavailablePosixShim(join(shimsDir, "uv"), message),
    writeUnavailablePosixShim(join(shimsDir, "uvx"), message),
  ]);
  return [shimsDir];
}

function getOfficeAgentUvShimSource(): string {
  return [
    "import os",
    "import subprocess",
    "import sys",
    "REAL_UV = sys.argv[1]",
    "ARGS = sys.argv[2:]",
    "PYTHON_EXE = os.environ.get('OFFICE_AGENT_PYTHON_EXE') or 'python'",
    ...getOfficeAgentManagedPythonSupportSource(),
    "def _call(argv):",
    "    raise SystemExit(subprocess.call(argv))",
    "def _venv_python(required=False):",
    "    return _ensure_managed_env(required=required)",
    "def _run(args):",
    "    if not args or args[0] in ('--version', '-V', 'version'):",
    "        _call([REAL_UV, *args])",
    "    if args[:2] == ['python', 'find']:",
    "        print(_venv_python(required=True))",
    "        raise SystemExit(0)",
    "    if args and args[0] == 'venv':",
    "        _venv_python(required=True)",
    "        print(f'OfficeAgent already maintains a hidden Python environment for this workspace at {MANAGED_ENV}', file=sys.stderr)",
    "        print('Visible virtualenv creation is disabled to keep dependency files out of the workspace. Use normal python and pip commands; they already use the hidden environment.', file=sys.stderr)",
    "        raise SystemExit(2)",
    "    if args and args[0] == 'pip':",
    "        python = _venv_python(required=True)",
    "        _call([python, '-m', 'pip', *_normalize_pip_args(args[1:])])",
    "    if args and args[0] == 'run':",
    "        rest = args[1:]",
    "        if rest and rest[0] == 'python':",
    "            _call([_venv_python(required=True), *rest[1:]])",
    "    print('OfficeAgent sandbox supports a managed uv subset: uv --version, uv python find, uv venv, uv pip ..., and uv run python ...', file=sys.stderr)",
    "    print('This uv subcommand is not enabled in the OfficeAgent managed runtime yet.', file=sys.stderr)",
    "    raise SystemExit(2)",
    "_run(ARGS)",
    "",
  ].join("\n");
}

async function findManagedToolRuntimeDir(rootDir: string, manifestName: string): Promise<string | undefined> {
  if (existsSync(join(rootDir, manifestName))) {
    return rootDir;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(rootDir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const candidate = join(rootDir, entry);
    if (directoryExists(candidate) && existsSync(join(candidate, manifestName))) {
      return candidate;
    }
  }
  return undefined;
}

async function findBundledToolRuntimeDir(
  manifestName: string,
  overrideEnvName: string,
  runtimeName: "python" | "uv",
): Promise<string | undefined> {
  const override = process.env[overrideEnvName]?.trim();
  if (override) {
    if (existsSync(join(override, manifestName))) {
      return override;
    }
    throw new Error(`${overrideEnvName} is set but ${manifestName} was not found under ${override}`);
  }

  for (const root of bundledRuntimeRootCandidates(runtimeName)) {
    const directManifest = join(root, manifestName);
    if (existsSync(directManifest)) {
      return root;
    }
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = join(root, entry);
      if (directoryExists(candidate) && existsSync(join(candidate, manifestName))) {
        return candidate;
      }
    }
  }
  return undefined;
}

function bundledRuntimeRootCandidates(runtimeName: "python" | "uv"): string[] {
  const resourcesPath = getElectronResourcesPath();
  return uniquePaths([
    ...(resourcesPath ? [join(resourcesPath, "runtime", runtimeName)] : []),
    join(process.cwd(), "build", "runtime", runtimeName),
    join(process.cwd(), "desktop", "build", "runtime", runtimeName),
    join(process.cwd(), "apps", "gui", "desktop", "build", "runtime", runtimeName),
    resolve("apps", "gui", "desktop", "build", "runtime", runtimeName),
  ]);
}

function getElectronResourcesPath(): string | undefined {
  // Runtime-host workers are plain Node child processes, so Electron's
  // process.resourcesPath is not available there. The Electron parent passes
  // this env var so packaged resources/runtime/* can still be discovered.
  const envResourcesPath = process.env.HOWCODE_ELECTRON_RESOURCES_PATH?.trim();
  if (envResourcesPath) {
    return envResourcesPath;
  }

  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPathValue === "string" && resourcesPathValue.trim().length > 0
    ? resourcesPathValue
    : undefined;
}

async function readToolRuntimeManifest(sourceDir: string, manifestName: string): Promise<OfficeAgentBundledRuntimeManifest> {
  const raw = await readFile(join(sourceDir, manifestName), "utf8");
  return JSON.parse(raw) as OfficeAgentBundledRuntimeManifest;
}

function requiredManifestString(value: string | undefined, manifestName: string, field: string): string {
  if (!value) {
    throw new Error(`${manifestName} is missing required field ${field}`);
  }
  return value;
}

async function ensureManagedRuntimeCopied(sourceDir: string, targetDir: string, executablePath: string): Promise<void> {
  if (existsSync(executablePath)) {
    return;
  }

  const rootDir = dirname(targetDir);
  const stagingDir = join(rootDir, ".staging", `${basenameSafe(targetDir)}-${randomUUID()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(dirname(stagingDir), { recursive: true });
  await cp(sourceDir, stagingDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  await rm(targetDir, { recursive: true, force: true });
  await rename(stagingDir, targetDir);

  if (!existsSync(executablePath)) {
    throw new Error(`Managed runtime copy did not create expected executable: ${executablePath}`);
  }
}

function basenameSafe(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "runtime";
}

async function writeCmdShim(pathValue: string, content: string): Promise<void> {
  await writeFile(pathValue, content, "utf8");
}

async function writePosixShim(pathValue: string, argv: readonly string[]): Promise<void> {
  const command = argv.map(quotePosixShellArg).join(" ");
  await writeFile(pathValue, `#!/usr/bin/env sh\nexec ${command} "$@"\n`, { encoding: "utf8", mode: 0o755 });
}

async function writeUnavailablePosixShim(pathValue: string, message: string): Promise<void> {
  await writeFile(
    pathValue,
    `#!/usr/bin/env sh\necho ${quotePosixShellArg(message)} >&2\nexit 1\n`,
    { encoding: "utf8", mode: 0o755 },
  );
}

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function writeCurrentRuntimeManifest(pathValue: string, manifest: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function withHostPathCompatibility(config: OfficeAgentSandboxShellConfig): OfficeAgentSandboxShellConfig {
  return config;
}

function getInheritedHostPathEntries(): string[] {
  if (process.env.OFFICE_AGENT_SANDBOX_INHERIT_HOST_PATH === "0") {
    return [];
  }

  const hostPath = getEnvCaseInsensitive(process.env, "PATH");
  if (!hostPath) {
    return [];
  }

  return uniquePaths(
    hostPath
      .split(process.platform === "win32" ? ";" : delimiter)
      .map(cleanHostPathEntry)
      .filter((entry): entry is string => entry !== undefined && directoryExists(entry)),
  );
}

function cleanHostPathEntry(entry: string): string | undefined {
  let cleaned = entry.trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"'))
    || (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = expandWindowsEnvReferences(cleaned).trim();
  if (!isAbsolute(cleaned)) {
    return undefined;
  }
  return normalize(cleaned);
}

function expandWindowsEnvReferences(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, key: string) => getEnvCaseInsensitive(process.env, key) ?? match);
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const normalized = normalize(entry.trim());
    if (normalized.length === 0) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function getEnvCaseInsensitive(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = source[key];
  if (direct !== undefined) {
    return direct;
  }
  const actualKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actualKey ? source[actualKey] : undefined;
}

const OFFICE_AGENT_SANDBOX_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "npm_config_cache",
  "NPM_CONFIG_CACHE",
  "npm_config_prefix",
  "NPM_CONFIG_PREFIX",
  "PIP_CACHE_DIR",
  "PIP_CONFIG_FILE",
  "PYTHONUSERBASE",
  "OFFICE_AGENT_PYTHON_ENV",
  "VIRTUAL_ENV",
  "OFFICE_AGENT_SCRATCH",
  "OFFICE_AGENT_TOOL_FILES",
  "UV_CACHE_DIR",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "UV_PYTHON_INSTALL_DIR",
  "UV_PYTHON_BIN_DIR",
  "UV_PYTHON_NO_REGISTRY",
  "UV_PYTHON_DOWNLOADS",
  "UV_LINK_MODE",
  "UV_NO_MODIFY_PATH",
  "OFFICE_AGENT_SESSION_DIR",
  "OFFICE_AGENT_SESSION_LOGS_DIR",
  "OFFICE_AGENT_REAL_USER_PROFILE",
  "OFFICE_AGENT_REAL_USER_DESKTOP",
  "OFFICE_AGENT_REAL_USER_DOCUMENTS",
  "OFFICE_AGENT_REAL_USER_DOWNLOADS",
  "OFFICE_AGENT_REAL_USER_PICTURES",
  "OFFICE_AGENT_REAL_USER_VIDEOS",
  "OFFICE_AGENT_REAL_USER_MUSIC",
  "OFFICE_AGENT_REAL_USER_TEMP",
  "OFFICE_AGENT_SANDBOX_PROFILE",
  "OFFICE_AGENT_MANAGED_ROOT",
  "OFFICE_AGENT_WORKSPACE",
  "OFFICE_AGENT_PROJECT_STATE",
  "OFFICE_AGENT_PROJECT_CACHE",
  "OFFICE_AGENT_PROJECT_TOOLS",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

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
  cwd: string,
): Record<string, string> {
  const systemRoot = firstDefined(getEnvCaseInsensitive(process.env, "SystemRoot"), "C:\\Windows");
  const comSpec = firstDefined(getEnvCaseInsensitive(process.env, "ComSpec"), join(systemRoot, "System32", "cmd.exe"));
  const cwdDrive = getWindowsDrivePrefix(cwd);
  const env: Record<string, string> = {
    ...(cwdDrive ? { SystemDrive: cwdDrive, SYSTEMDRIVE: cwdDrive, [`=${cwdDrive}`]: cwd } : {}),
    SystemRoot: systemRoot,
    SYSTEMROOT: systemRoot,
    ComSpec: comSpec,
    COMSPEC: comSpec,
    PATHEXT: getOfficeAgentSandboxPathExt(),
    PYTHONUTF8: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    NODE_OPTIONS: "--preserve-symlinks --preserve-symlinks-main",
    ...(shellConfig.pythonRuntime?.environment ?? {}),
    ...(shellConfig.uvRuntime?.environment ?? {}),
    ...(shellConfig.pythonRuntime
      ? {
        OFFICE_AGENT_PYTHON_RUNTIME_DIR: shellConfig.pythonRuntime.runtimeDir,
        OFFICE_AGENT_PYTHON_EXE: shellConfig.pythonRuntime.executable,
        UV_PYTHON: shellConfig.pythonRuntime.executable,
      }
      : {}),
    ...(shellConfig.uvRuntime
      ? {
        OFFICE_AGENT_UV_RUNTIME_DIR: shellConfig.uvRuntime.runtimeDir,
        OFFICE_AGENT_UV_EXE: shellConfig.uvRuntime.executable,
      }
      : {}),
  };

  copyEnvKeys(env, sessionEnv, OFFICE_AGENT_SANDBOX_ENV_KEYS);
  copyEnvKeys(env, commandEnv, OFFICE_AGENT_SANDBOX_ENV_KEYS);

  const pathEntries = uniquePaths([
    ...(shellConfig.runtimeDir ? [join(shellConfig.runtimeDir, "bin"), join(shellConfig.runtimeDir, "usr", "bin")] : []),
    ...shellConfig.prependPathEntries,
    ...getMutableToolPathEntries(env, shellConfig),
    ...shellConfig.inheritedHostPathEntries,
    join(systemRoot, "System32"),
    systemRoot,
  ]);
  env.Path = pathEntries.join(";");
  env.PATH = pathEntries.join(";");
  return env;
}

function getWindowsDrivePrefix(pathValue: string): string | undefined {
  const match = /^([A-Za-z]):/.exec(pathValue);
  return match ? `${match[1]?.toUpperCase()}:` : undefined;
}

function getMutableToolPathEntries(
  env: Readonly<Record<string, string>>,
  shellConfig: OfficeAgentSandboxShellConfig,
): string[] {
  const entries: string[] = [];
  const virtualEnv = env.OFFICE_AGENT_PYTHON_ENV ?? env.VIRTUAL_ENV;
  if (virtualEnv) {
    entries.push(join(virtualEnv, "Scripts"));
  }
  const pythonUserBase = env.PYTHONUSERBASE;
  if (pythonUserBase) {
    const pythonVersionTag = getPythonWindowsUserScriptsVersionTag(shellConfig.pythonRuntime?.version);
    if (pythonVersionTag) {
      entries.push(join(pythonUserBase, pythonVersionTag, "Scripts"));
    }
    entries.push(join(pythonUserBase, "Scripts"));
  }
  const uvToolBinDir = env.UV_TOOL_BIN_DIR;
  if (uvToolBinDir) {
    entries.push(uvToolBinDir);
  }
  const uvPythonBinDir = env.UV_PYTHON_BIN_DIR;
  if (uvPythonBinDir) {
    entries.push(uvPythonBinDir);
  }
  const npmPrefix = env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix;
  if (npmPrefix) {
    entries.push(npmPrefix, join(npmPrefix, "node_modules", ".bin"));
  }
  return entries;
}

function getPythonWindowsUserScriptsVersionTag(version: string | undefined): string | undefined {
  const match = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) {
    return undefined;
  }
  return `Python${match[1]}${match[2]}`;
}

function getOfficeAgentSandboxPathExt(): string {
  const inherited = firstDefined(getEnvCaseInsensitive(process.env, "PATHEXT"), ".COM;.EXE;.BAT;.CMD");
  const entries = [".CMD", ...inherited.split(";")]
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0);
  return [...new Set(entries)].join(";");
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

function filterSandboxOutputBuffer(buffer: Buffer): Buffer {
  if (buffer.length === 0) {
    return buffer;
  }
  const filtered = buffer
    .toString("utf8")
    .split(/(?<=\n)/)
    .filter((line) => !/^Failed to find real location of .*\\python\.exe\r?\n?$/i.test(line.trimEnd()))
    .join("");
  return Buffer.from(filtered, "utf8");
}

async function readFileIfExists(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
