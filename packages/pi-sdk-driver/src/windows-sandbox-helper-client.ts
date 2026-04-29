import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { BashOperations } from "@mariozechner/pi-coding-agent";
import {
  getOfficeAgentPythonRuntimeCurrentManifestPath,
  getOfficeAgentPythonRuntimeDir,
  getOfficeAgentPythonRuntimeRootDir,
  getOfficeAgentPythonRuntimeShimsDir,
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
  readonly optionalReadOnlyPaths?: readonly string[];
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

export interface OfficeAgentManagedToolRuntimeConfig {
  readonly runtimeId: string;
  readonly runtimeDir: string;
  readonly executable: string;
  readonly pathEntries: readonly string[];
  readonly readOnlyGrantPaths: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly version?: string;
}

export interface OfficeAgentSandboxShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  readonly readOnlyGrantPaths: readonly string[];
  readonly optionalReadOnlyGrantPaths: readonly string[];
  readonly inheritedHostPathEntries: readonly string[];
  readonly prependPathEntries: readonly string[];
  readonly backend: OfficeAgentSandboxShellBackend;
  readonly kind: "bash-path-override" | "staged-git-bash" | "cmd-fallback";
  readonly runtimeDir?: string;
  readonly pythonRuntime?: OfficeAgentManagedToolRuntimeConfig;
  readonly uvRuntime?: OfficeAgentManagedToolRuntimeConfig;
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
      const commandScriptPath = shellConfig.backend === "cmd"
        ? join(options.sessionPaths.sessionDir, `bash-${runId}.cmd`)
        : undefined;
      if (commandScriptPath) {
        await writeFile(commandScriptPath, `@echo off\r\n${rewriteCmdManagedCommands(command, shellConfig)}\r\n`, "utf8");
      }
      const launchArgs = commandScriptPath
        ? ["/d", "/q", "/c", commandScriptPath]
        : [...shellConfig.args, command];

      if (execOptions.signal?.aborted) {
        throw new Error("aborted");
      }

      const response = await invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: runId,
        executable: shellConfig.shell,
        args: launchArgs,
        cwd,
        managedRoot: options.managedRootDir,
        sessionDir: options.sessionPaths.sessionDir,
        env: createSandboxEnvironment(shellConfig, options.env, execOptions.env),
        readOnlyPaths: shellConfig.readOnlyGrantPaths,
        optionalReadOnlyPaths: shellConfig.optionalReadOnlyGrantPaths,
        writablePaths: [cwd, options.sessionPaths.sessionDir],
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

      const [rawStdout, rawStderr] = await Promise.all([
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

const MANAGED_CMD_COMMANDS = new Map<string, string>([
  ["dir", "dir"],
  ["where", "where"],
  ["copy", "copy"],
  ["move", "move"],
  ["del", "del"],
  ["erase", "del"],
  ["mkdir", "mkdir"],
  ["md", "mkdir"],
  ["rmdir", "rmdir"],
  ["rd", "rmdir"],
]);

function rewriteCmdManagedCommands(command: string, shellConfig: OfficeAgentSandboxShellConfig): string {
  if (shellConfig.backend !== "cmd" || !shellConfig.pythonRuntime) {
    return command;
  }
  const python = shellConfig.pythonRuntime.executable;
  const managedShim = shellConfig.pythonRuntime.environment?.OFFICE_AGENT_CMD_MANAGED_SHIM;
  if (!managedShim) {
    return command;
  }

  const lines = command.split(/(\r?\n)/);
  return lines.map((part) => part.includes("\n") ? part : rewriteCmdManagedCommandsInLine(part, python, managedShim)).join("");
}

function rewriteCmdManagedCommandsInLine(line: string, python: string, managedShim: string): string {
  let result = "";
  let index = 0;
  let atCommandStart = true;
  let quote: '"' | "'" | undefined;

  while (index < line.length) {
    const char = line[index] ?? "";
    if (quote) {
      result += char;
      if (char === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (atCommandStart) {
      const rewritten = tryRewriteManagedCommandAt(line, index, python, managedShim);
      if (rewritten) {
        result += rewritten.prefix;
        result += rewritten.replacement;
        index = rewritten.nextIndex;
        atCommandStart = false;
        continue;
      }
    }
    result += char;
    if (char === "&" || char === "|") {
      atCommandStart = true;
      if (line[index + 1] === char) {
        result += line[index + 1] ?? "";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    atCommandStart = atCommandStart && /\s/.test(char);
    index += 1;
  }
  return result;
}

function tryRewriteManagedCommandAt(
  line: string,
  startIndex: number,
  python: string,
  managedShim: string,
): { prefix: string; replacement: string; nextIndex: number } | undefined {
  let index = startIndex;
  let prefix = "";
  while (index < line.length && /\s/.test(line[index] ?? "")) {
    prefix += line[index] ?? "";
    index += 1;
  }
  if (line[index] === "@") {
    prefix += "@";
    index += 1;
    while (index < line.length && /\s/.test(line[index] ?? "")) {
      prefix += line[index] ?? "";
      index += 1;
    }
  }

  const wordStart = index;
  while (index < line.length && !/[\s&|<>()]/.test(line[index] ?? "")) {
    index += 1;
  }
  if (wordStart === index) {
    return undefined;
  }

  const commandWord = line.slice(wordStart, index);
  const managedCommand = MANAGED_CMD_COMMANDS.get(commandWord.toLowerCase());
  if (!managedCommand) {
    return undefined;
  }

  return {
    prefix,
    replacement: `"${python}" "${managedShim}" ${managedCommand}`,
    nextIndex: index,
  };
}

export function resolveOfficeAgentSandboxShellConfig(managedRootDir: string): OfficeAgentSandboxShellConfig {
  const inheritedHostPathEntries = getInheritedHostPathEntries();
  const directOverride = process.env[OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME]?.trim();
  if (directOverride) {
    const runtimeDir = inferRuntimeDirFromBashPath(directOverride);
    return withHostPathCompatibility({
      shell: directOverride,
      args: ["-c"],
      readOnlyGrantPaths: getRuntimeReadOnlyGrantPaths(directOverride),
      optionalReadOnlyGrantPaths: [],
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
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return withHostPathCompatibility({
    shell: join(systemRoot, "System32", "cmd.exe"),
    args: ["/d", "/s", "/c"],
    readOnlyGrantPaths: [],
    optionalReadOnlyGrantPaths: [],
    inheritedHostPathEntries,
    prependPathEntries: [],
    backend: "cmd",
    kind: "cmd-fallback",
  });
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
  return withHostPathCompatibility({
    shell,
    args: ["-c"],
    readOnlyGrantPaths: [runtimeDir],
    optionalReadOnlyGrantPaths: [],
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
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    const requestTimeoutMs = "timeoutMs" in request && typeof request.timeoutMs === "number"
      ? request.timeoutMs
      : 30_000;
    const watchdogMs = Math.max(30_000, requestTimeoutMs + 15_000);
    const watchdog = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      rejectPromise(new Error(`OfficeAgent sandbox helper did not respond within ${watchdogMs}ms. stderr=${stderr}`));
    }, watchdogMs);

    const reject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(watchdog);
      rejectPromise(error);
    };
    const resolve = (response: WindowsSandboxHelperResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(watchdog);
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

async function ensureOfficeAgentManagedToolRuntimes(
  config: OfficeAgentSandboxShellConfig,
  managedRootDir: string,
): Promise<OfficeAgentSandboxShellConfig> {
  const [pythonRuntime, uvRuntime] = await Promise.all([
    ensureOfficeAgentPythonRuntime(managedRootDir),
    ensureOfficeAgentUvRuntime(managedRootDir),
  ]);

  if (!pythonRuntime && process.env.OFFICE_AGENT_REQUIRE_BUNDLED_PYTHON === "1") {
    throw new Error("OfficeAgent bundled Python runtime is required but was not found.");
  }

  return withHostPathCompatibility({
    ...config,
    readOnlyGrantPaths: [
      ...config.readOnlyGrantPaths,
      ...(pythonRuntime?.readOnlyGrantPaths ?? []),
      ...(uvRuntime?.readOnlyGrantPaths ?? []),
    ],
    prependPathEntries: [
      ...(pythonRuntime?.pathEntries ?? []),
      ...(uvRuntime?.pathEntries ?? []),
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
  );
  if (!sourceDir) {
    return undefined;
  }

  const manifest = await readToolRuntimeManifest(sourceDir, OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME);
  const runtimeId = requiredManifestString(manifest.runtimeId, OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME, "runtimeId");
  const targetDir = getOfficeAgentPythonRuntimeDir(managedRootDir, runtimeId);
  const pythonRelativePath = manifest.executableRelativePath ?? "python.exe";
  const scriptsRelativePath = manifest.scriptsRelativePath ?? "Scripts";
  const pythonExe = join(targetDir, pythonRelativePath);
  const scriptsDir = join(targetDir, scriptsRelativePath);
  await ensureManagedRuntimeCopied(sourceDir, targetDir, pythonExe);

  const shimsDir = getOfficeAgentPythonRuntimeShimsDir(managedRootDir);
  await mkdir(shimsDir, { recursive: true });
  const pythonShim = join(shimsDir, "python-shim.py");
  const pipShim = join(shimsDir, "pip-shim.py");
  const managedCmdShim = join(shimsDir, "cmd-managed-shim.py");
  const siteCustomize = join(shimsDir, "sitecustomize.py");
  await Promise.all([
    writeCmdShim(join(shimsDir, "python.cmd"), `@echo off\r\n"${pythonExe}" "${pythonShim}" %*\r\n`),
    writeCmdShim(join(shimsDir, "python3.cmd"), `@echo off\r\n"${pythonExe}" "${pythonShim}" %*\r\n`),
    writeFile(
      pythonShim,
      [
        "import os",
        "import subprocess",
        "import sys",
        `PYTHON_EXE = r'''${pythonExe}'''`,
        "args = sys.argv[1:]",
        "def _run(argv):",
        "    raise SystemExit(subprocess.call(argv))",
        "if len(args) >= 2 and args[0] == '-m' and args[1] == 'venv' and '--without-pip' not in args[2:]:",
        "    venv_args = args[2:]",
        "    env_dirs = [arg for arg in venv_args if not arg.startswith('-')]",
        "    code = subprocess.call([PYTHON_EXE, '-m', 'venv', '--without-pip', *venv_args])",
        "    if code == 0:",
        "        for env_dir in env_dirs:",
        "            env_python = os.path.join(env_dir, 'Scripts', 'python.exe')",
        "            code = subprocess.call([env_python, '-m', 'ensurepip', '--upgrade', '--default-pip'])",
        "            if code != 0:",
        "                break",
        "    raise SystemExit(code)",
        "_run([PYTHON_EXE, *args])",
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      pipShim,
      [
        "import os",
        "import subprocess",
        "import sys",
        `PYTHON_EXE = r'''${pythonExe}'''`,
        "args = sys.argv[1:]",
        "if args[:1] == ['install'] and not os.environ.get('VIRTUAL_ENV'):",
        "    args = ['install', '--user', *args[1:]]",
        "raise SystemExit(subprocess.call([PYTHON_EXE, '-m', 'pip', *args]))",
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      managedCmdShim,
      [
        "import glob",
        "import os",
        "import shutil",
        "import sys",
        "",
        "COMMAND = (sys.argv[1:2] or [''])[0].lower()",
        "ARGS = sys.argv[2:]",
        "",
        "def _error(message, code=1):",
        "    print(message, file=sys.stderr)",
        "    raise SystemExit(code)",
        "",
        "def _expand(path):",
        "    return glob.glob(path) if any(ch in path for ch in '*?[') else [path]",
        "",
        "def _existing_matches(patterns):",
        "    matches = []",
        "    for pattern in patterns:",
        "        expanded = _expand(pattern)",
        "        if not expanded or (len(expanded) == 1 and any(ch in pattern for ch in '*?[') and not os.path.exists(expanded[0])):",
        "            continue",
        "        matches.extend(expanded)",
        "    return matches",
        "",
        "def _cmd_dir(args):",
        "    bare = False",
        "    targets = []",
        "    for arg in args:",
        "        lower = arg.lower()",
        "        if lower in ('/b', '-b'):",
        "            bare = True",
        "        elif lower.startswith('/a') or lower in ('/d', '/w'):",
        "            continue",
        "        else:",
        "            targets.append(arg)",
        "    targets = targets or ['.']",
        "    exit_code = 0",
        "    for target in targets:",
        "        matches = _expand(target)",
        "        if any(ch in target for ch in '*?['):",
        "            matches = [match for match in matches if os.path.exists(match)]",
        "        if not matches:",
        "            print(f'File Not Found: {target}', file=sys.stderr)",
        "            exit_code = 1",
        "            continue",
        "        for match in matches:",
        "            try:",
        "                if os.path.isdir(match):",
        "                    for name in os.listdir(match):",
        "                        print(name if bare else os.path.join(match, name))",
        "                elif os.path.exists(match):",
        "                    print(os.path.basename(match) if bare else match)",
        "                else:",
        "                    print(f'File Not Found: {match}', file=sys.stderr)",
        "                    exit_code = 1",
        "            except OSError as exc:",
        "                print(f'Access denied: {match}: {exc}', file=sys.stderr)",
        "                exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _cmd_where(args):",
        "    exit_code = 0",
        "    for name in args or ['']:",
        "        matches = []",
        "        for path_entry in os.environ.get('PATH', '').split(os.pathsep):",
        "            if not path_entry:",
        "                continue",
        "            found = shutil.which(name, path=path_entry)",
        "            if found and found not in matches:",
        "                matches.append(found)",
        "        if matches:",
        "            print('\\n'.join(matches))",
        "        else:",
        "            print(f'INFO: Could not find files for the given pattern(s): {name}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _cmd_mkdir(args):",
        "    if not args:",
        "        _error('The syntax of the command is incorrect.')",
        "    exit_code = 0",
        "    for path in args:",
        "        try:",
        "            os.makedirs(path, exist_ok=True)",
        "        except OSError as exc:",
        "            print(f'Access denied: {path}: {exc}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _cmd_rmdir(args):",
        "    recursive = False",
        "    targets = []",
        "    for arg in args:",
        "        lower = arg.lower()",
        "        if lower == '/s':",
        "            recursive = True",
        "        elif lower == '/q':",
        "            continue",
        "        else:",
        "            targets.append(arg)",
        "    if not targets:",
        "        _error('The syntax of the command is incorrect.')",
        "    exit_code = 0",
        "    for target in targets:",
        "        try:",
        "            if recursive:",
        "                shutil.rmtree(target)",
        "            else:",
        "                os.rmdir(target)",
        "        except OSError as exc:",
        "            print(f'Access denied: {target}: {exc}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _cmd_del(args):",
        "    targets = [arg for arg in args if not arg.startswith('/') and not arg.startswith('-')]",
        "    if not targets:",
        "        _error('The syntax of the command is incorrect.')",
        "    matches = _existing_matches(targets)",
        "    if not matches:",
        "        _error('File Not Found')",
        "    exit_code = 0",
        "    for target in matches:",
        "        try:",
        "            if os.path.isdir(target):",
        "                print(f'Access denied: {target}: is a directory', file=sys.stderr)",
        "                exit_code = 1",
        "            else:",
        "                os.unlink(target)",
        "        except OSError as exc:",
        "            print(f'Access denied: {target}: {exc}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _copy_one(src, dst):",
        "    if os.path.isdir(dst):",
        "        dst = os.path.join(dst, os.path.basename(src))",
        "    shutil.copy2(src, dst)",
        "    print(f'        1 file(s) copied.')",
        "",
        "def _cmd_copy(args):",
        "    filtered = [arg for arg in args if not arg.startswith('/') and not arg.startswith('-')]",
        "    if len(filtered) < 2:",
        "        _error('The syntax of the command is incorrect.')",
        "    sources = _existing_matches(filtered[:-1])",
        "    dest = filtered[-1]",
        "    if len(sources) > 1 and not os.path.isdir(dest):",
        "        _error('The destination must be a directory when copying multiple files.')",
        "    exit_code = 0",
        "    for src in sources:",
        "        try:",
        "            _copy_one(src, dest)",
        "        except OSError as exc:",
        "            print(f'Access denied: {src}: {exc}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "def _cmd_move(args):",
        "    filtered = [arg for arg in args if not arg.startswith('/') and not arg.startswith('-')]",
        "    if len(filtered) < 2:",
        "        _error('The syntax of the command is incorrect.')",
        "    sources = _existing_matches(filtered[:-1])",
        "    dest = filtered[-1]",
        "    if len(sources) > 1 and not os.path.isdir(dest):",
        "        _error('The destination must be a directory when moving multiple files.')",
        "    exit_code = 0",
        "    for src in sources:",
        "        try:",
        "            final_dest = os.path.join(dest, os.path.basename(src)) if os.path.isdir(dest) else dest",
        "            shutil.move(src, final_dest)",
        "            print(f'{src} -> {final_dest}')",
        "        except OSError as exc:",
        "            print(f'Access denied: {src}: {exc}', file=sys.stderr)",
        "            exit_code = 1",
        "    raise SystemExit(exit_code)",
        "",
        "if COMMAND == 'dir':",
        "    _cmd_dir(ARGS)",
        "elif COMMAND == 'where':",
        "    _cmd_where(ARGS)",
        "elif COMMAND == 'mkdir':",
        "    _cmd_mkdir(ARGS)",
        "elif COMMAND == 'rmdir':",
        "    _cmd_rmdir(ARGS)",
        "elif COMMAND == 'del':",
        "    _cmd_del(ARGS)",
        "elif COMMAND == 'copy':",
        "    _cmd_copy(ARGS)",
        "elif COMMAND == 'move':",
        "    _cmd_move(ARGS)",
        "else:",
        "    _error(f'OfficeAgent managed command is not supported: {COMMAND}')",
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      siteCustomize,
      [
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
        "    if dir_fd is None and isinstance(path, (str, bytes, os.PathLike)):",
        "        if _officeagent_cmd_mkdir(path):",
        "            return None",
        "    return _officeagent_orig_mkdir(path, mode, dir_fd=dir_fd) if dir_fd is not None else _officeagent_orig_mkdir(path, mode)",
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
        "            if _officeagent_cmd_mkdir(path):",
        "                return path",
        "        except OSError:",
        "            break",
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
        "            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)",
        "            file = os.fdopen(fd, mode, buffering=buffering, encoding=encoding, errors=errors, newline=newline)",
        "            return _OfficeAgentNamedTemporaryFile(file, path, delete=delete and delete_on_close)",
        "        except FileExistsError:",
        "            continue",
        "        except OSError:",
        "            break",
        "    return _officeagent_orig_named_temporary_file(mode=mode, buffering=buffering, encoding=encoding, newline=newline, suffix=suffix, prefix=prefix, dir=dir, delete=delete, errors=errors)",
        "tempfile.NamedTemporaryFile = _officeagent_named_temporary_file",
        "",
      ].join("\n"),
      "utf8",
    ),
    writeCmdShim(join(shimsDir, "pip.cmd"), `@echo off\r\n"${pythonExe}" "${pipShim}" %*\r\n`),
    writeCmdShim(join(shimsDir, "pip3.cmd"), `@echo off\r\n"${pythonExe}" "${pipShim}" %*\r\n`),
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
    pathEntries: [shimsDir, targetDir, scriptsDir],
    readOnlyGrantPaths: [targetDir, shimsDir],
    environment: {
      PYTHONPATH: shimsDir,
      OFFICE_AGENT_CMD_MANAGED_SHIM: managedCmdShim,
    },
    ...(version ? { version } : {}),
  };
}

async function ensureOfficeAgentUvRuntime(managedRootDir: string): Promise<OfficeAgentManagedToolRuntimeConfig | undefined> {
  const sourceDir = await findBundledToolRuntimeDir(
    OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME,
    "OFFICE_AGENT_BUNDLED_UV_RUNTIME_DIR",
    "uv",
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
    writeCmdShim(join(shimsDir, "uv.cmd"), `@echo off\r\nif "%~1"=="--version" (\r\n  "${uvExe}" %*\r\n  exit /b %ERRORLEVEL%\r\n)\r\nif "%~1"=="-V" (\r\n  "${uvExe}" %*\r\n  exit /b %ERRORLEVEL%\r\n)\r\nif "%~1"=="version" (\r\n  "${uvExe}" %*\r\n  exit /b %ERRORLEVEL%\r\n)\r\nif defined OFFICE_AGENT_PYTHON_EXE (\r\n  "%OFFICE_AGENT_PYTHON_EXE%" "${uvShim}" "${uvExe}" %*\r\n) else (\r\n  "${uvExe}" %*\r\n)\r\n`),
    writeCmdShim(join(shimsDir, "uvx.cmd"), `@echo off\r\nif defined OFFICE_AGENT_PYTHON_EXE (\r\n  "%OFFICE_AGENT_PYTHON_EXE%" "${uvShim}" "${uvExe}" tool run %*\r\n) else (\r\n  "${uvExe}" tool run %*\r\n)\r\n`),
    writeFile(
      uvShim,
      [
        "import os",
        "import subprocess",
        "import sys",
        "REAL_UV = sys.argv[1]",
        "ARGS = sys.argv[2:]",
        "PYTHON_EXE = os.environ.get('OFFICE_AGENT_PYTHON_EXE') or 'python'",
        "def _call(argv):",
        "    raise SystemExit(subprocess.call(argv))",
        "def _venv_python():",
        "    virtual_env = os.environ.get('VIRTUAL_ENV')",
        "    candidates = []",
        "    if virtual_env:",
        "        candidates.append(os.path.join(virtual_env, 'Scripts', 'python.exe'))",
        "    candidates.append(os.path.join(os.getcwd(), '.venv', 'Scripts', 'python.exe'))",
        "    for candidate in candidates:",
        "        if os.path.exists(candidate):",
        "            return candidate",
        "    return None",
        "def _run_venv(args):",
        "    env_dirs = [arg for arg in args if not arg.startswith('-')]",
        "    target_dirs = env_dirs or ['.venv']",
        "    code = 0",
        "    for target in target_dirs:",
        "        code = subprocess.call([PYTHON_EXE, '-m', 'venv', '--without-pip', target])",
        "        if code != 0:",
        "            return code",
        "        env_python = os.path.join(target, 'Scripts', 'python.exe')",
        "        code = subprocess.call([env_python, '-m', 'ensurepip', '--upgrade', '--default-pip'])",
        "        if code != 0:",
        "            return code",
        "    return code",
        "def _run(args):",
        "    if not args or args[0] in ('--version', '-V', 'version'):",
        "        _call([REAL_UV, *args])",
        "    if args[:2] == ['python', 'find']:",
        "        print(PYTHON_EXE)",
        "        raise SystemExit(0)",
        "    if args and args[0] == 'venv':",
        "        raise SystemExit(_run_venv(args[1:]))",
        "    if args and args[0] == 'pip':",
        "        python = _venv_python() or PYTHON_EXE",
        "        _call([python, '-m', 'pip', *args[1:]])",
        "    if args and args[0] == 'run':",
        "        rest = args[1:]",
        "        if rest and rest[0] == 'python':",
        "            _call([_venv_python() or PYTHON_EXE, *rest[1:]])",
        "    print('OfficeAgent sandbox supports a managed uv subset: uv --version, uv python find, uv venv, uv pip ..., and uv run python ...', file=sys.stderr)",
        "    print('This uv subcommand is not enabled in the strict AppContainer sandbox yet.', file=sys.stderr)",
        "    raise SystemExit(2)",
        "_run(ARGS)",
        "",
      ].join("\n"),
      "utf8",
    ),
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
    pathEntries: [shimsDir, targetDir],
    readOnlyGrantPaths: [targetDir, shimsDir],
    ...(version ? { version } : {}),
  };
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
  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = typeof resourcesPathValue === "string" ? resourcesPathValue : undefined;
  return uniquePaths([
    ...(resourcesPath ? [join(resourcesPath, "runtime", runtimeName)] : []),
    join(process.cwd(), "build", "runtime", runtimeName),
    join(process.cwd(), "apps", "gui", "desktop", "build", "runtime", runtimeName),
    resolve("apps", "gui", "desktop", "build", "runtime", runtimeName),
  ]);
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

async function writeCurrentRuntimeManifest(pathValue: string, manifest: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function withHostPathCompatibility(config: OfficeAgentSandboxShellConfig): OfficeAgentSandboxShellConfig {
  const required = uniquePaths(config.readOnlyGrantPaths);
  return {
    ...config,
    readOnlyGrantPaths: required,
    optionalReadOnlyGrantPaths: uniquePaths([
      ...config.optionalReadOnlyGrantPaths,
      ...config.inheritedHostPathEntries,
    ]).filter((path) => !containsPath(required, path)),
  };
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

function containsPath(paths: readonly string[], candidate: string): boolean {
  const candidateKey = normalize(candidate).toLowerCase();
  return paths.some((path) => normalize(path).toLowerCase() === candidateKey);
}

function getEnvCaseInsensitive(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = source[key];
  if (direct !== undefined) {
    return direct;
  }
  const actualKey = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actualKey ? source[actualKey] : undefined;
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
  const systemRoot = firstDefined(getEnvCaseInsensitive(process.env, "SystemRoot"), "C:\\Windows");
  const comSpec = firstDefined(getEnvCaseInsensitive(process.env, "ComSpec"), join(systemRoot, "System32", "cmd.exe"));
  const env: Record<string, string> = {
    SystemRoot: systemRoot,
    SYSTEMROOT: systemRoot,
    ComSpec: comSpec,
    COMSPEC: comSpec,
    PATHEXT: firstDefined(getEnvCaseInsensitive(process.env, "PATHEXT"), ".COM;.EXE;.BAT;.CMD"),
    PYTHONUTF8: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
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

  copyEnvKeys(env, sessionEnv, [
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
    "PYTHONUSERBASE",
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
  ]);
  copyEnvKeys(env, commandEnv, [
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
    "PYTHONUSERBASE",
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
  ]);

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

function getMutableToolPathEntries(
  env: Readonly<Record<string, string>>,
  shellConfig: OfficeAgentSandboxShellConfig,
): string[] {
  const entries: string[] = [];
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
