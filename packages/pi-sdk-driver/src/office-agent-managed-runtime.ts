import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  ensureOfficeAgentManagedProjectStateLayout,
  ensureOfficeAgentManagedSessionLayout,
  findOfficeAgentManagedRootForPath,
  getOfficeAgentManagedSessionEnv,
} from "@office-agent/runtime";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SettingsManager,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSessionRuntimeWithNpmFallback,
  type CreateAgentSessionRuntimePreparationOptions,
  type CreateAgentSessionRuntimeWithNpmFallbackOptions,
  type PreparedAgentSessionRuntimeOptions,
} from "./npm-package-fallback.js";
import { getOfficeAgentAppPromptContext } from "./office-agent-prompt-context.js";
import { expandOfficeAgentPathPlaceholders } from "./office-agent-path-placeholders.js";
import { createCopyFileIntoWorkspaceToolDefinition } from "./office-agent-workspace-tools.js";
import {
  createOfficeAgentVirtualFsClient,
  getOfficeAgentVirtualFsPromptContext,
  OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS,
} from "./office-agent-virtual-fs.js";
import {
  assertNoReservedOfficeAgentToolNames,
  createOfficeAgentVirtualFindTool,
  createOfficeAgentVirtualGrepTool,
  createOfficeAgentVirtualLsTool,
  createOfficeAgentVirtualReadTool,
  withOfficeAgentVirtualBashAdvisory,
  withOfficeAgentVirtualEditGuard,
  withOfficeAgentVirtualWriteGuard,
} from "./office-agent-virtual-fs-tools.js";
import {
  createOfficeAgentSandboxBashOperations,
  ensureOfficeAgentSandboxShellConfig,
  ensureOfficeAgentWindowsSandboxV2Ready,
  getOfficeAgentSandboxShellPromptContext,
  mkdirWithOfficeAgentSandbox,
  writeFileWithOfficeAgentSandbox,
} from "./windows-sandbox-helper-client.js";

/**
 * First OfficeAgent-controlled session startup path.
 *
 * This is not the final sandbox boundary. It prepares the same managed-root,
 * per-session env/tool shape that the Rust write-contained worker will consume.
 */
export async function createOfficeAgentManagedSessionRuntime(
  options: CreateAgentSessionOptions = {},
) {
  defaultWindowsSandboxBackendToV2();
  const cwd = resolve(options.cwd ?? process.cwd());
  const managedRootDir = findOfficeAgentManagedRootForPath(cwd);
  if (!managedRootDir) {
    if (process.env.OFFICE_AGENT_ALLOW_UNMANAGED_PI_RUNTIME === "1") {
      return createAgentSessionRuntimeWithNpmFallback(options);
    }
    throw new Error(
      [
        "OfficeAgent refused to start an unmanaged Pi runtime.",
        `cwd is outside the OfficeAgent managed AgentData tree: ${cwd}`,
        "Open or create a project inside OfficeAgent AgentData, or set OFFICE_AGENT_ALLOW_UNMANAGED_PI_RUNTIME=1 for explicit development/testing only.",
      ].join(" "),
    );
  }

  if (!options.sessionManager?.getSessionId()) {
    throw new Error("OfficeAgent managed runtime requires a session manager with a session id.");
  }

  const initialSessionId = options.sessionManager.getSessionId();
  const {
    customTools: baseCustomTools,
    noTools: _ignoredNoTools,
    resourceLoader: providedResourceLoader,
    settingsManager: providedSettingsManager,
    tools: _ignoredTools,
    ...baseOptions
  } = options;
  const runtimeOptions: CreateAgentSessionRuntimeWithNpmFallbackOptions = {
    ...baseOptions,
    cwd,
    prepareRuntimeOptions: (runtimePreparationOptions) =>
      createOfficeAgentManagedRuntimeOptions({
        baseCustomTools,
        baseOptions,
        initialCwd: cwd,
        initialSessionId,
        providedResourceLoader,
        providedSettingsManager,
        runtimeOptions: runtimePreparationOptions,
      }),
  };

  return createAgentSessionRuntimeWithNpmFallback(runtimeOptions);
}

async function createOfficeAgentManagedRuntimeOptions(options: {
  readonly baseCustomTools?: CreateAgentSessionOptions["customTools"];
  readonly baseOptions: Omit<
    CreateAgentSessionOptions,
    "customTools" | "noTools" | "resourceLoader" | "settingsManager" | "tools"
  >;
  readonly initialCwd: string;
  readonly initialSessionId: string;
  readonly providedResourceLoader?: CreateAgentSessionOptions["resourceLoader"];
  readonly providedSettingsManager?: CreateAgentSessionOptions["settingsManager"];
  readonly runtimeOptions: CreateAgentSessionRuntimePreparationOptions;
}): Promise<PreparedAgentSessionRuntimeOptions> {
  const cwd = resolve(options.runtimeOptions.cwd);
  const managedRootDir = findOfficeAgentManagedRootForPath(cwd);
  if (!managedRootDir) {
    throw new Error(`OfficeAgent refused to switch to an unmanaged Pi runtime cwd: ${cwd}`);
  }

  const sessionManager = options.runtimeOptions.sessionManager;
  const sessionId = sessionManager.getSessionId();
  if (!sessionId) {
    throw new Error("OfficeAgent managed runtime requires a session manager with a session id.");
  }

  const agentDir = options.runtimeOptions.agentDir;
  const [sessionPaths, projectStatePaths] = await Promise.all([
    ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir),
    ensureOfficeAgentManagedProjectStateLayout(cwd, managedRootDir),
  ]);
  await ensureOfficeAgentWindowsSandboxV2Ready({
    managedRootDir,
    projectRoot: cwd,
    projectStateDir: projectStatePaths.projectStateDir,
    sessionDir: sessionPaths.sessionDir,
    writeRoots: [
      cwd,
      ...getOfficeAgentSessionWritablePathsForSetup(sessionPaths),
      ...getOfficeAgentProjectStateWritablePathsForSetup(projectStatePaths),
    ],
  });

  const shellConfig = await ensureOfficeAgentSandboxShellConfig(managedRootDir);
  const appPromptContext = getOfficeAgentAppPromptContext({ cwd, managedRootDir, sessionId });
  const shellPromptContext = getOfficeAgentSandboxShellPromptContext(shellConfig);
  const virtualRoots = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS;
  const virtualFsPromptContext = getOfficeAgentVirtualFsPromptContext(virtualRoots);
  const promptContexts = [appPromptContext, shellPromptContext, virtualFsPromptContext];
  const settingsManager =
    options.providedSettingsManager && resolve(options.initialCwd) === cwd
      ? options.providedSettingsManager
      : SettingsManager.create(cwd, agentDir);
  const sessionEnv = getOfficeAgentManagedSessionEnv(sessionId, process.env, {
    managedRootDir,
    activeProjectDir: cwd,
    agentDir,
  });

  assertNoReservedOfficeAgentToolNames(options.baseCustomTools);

  const sandboxCommandTool = createBashToolDefinition(cwd, {
    operations: createOfficeAgentSandboxBashOperations({
      managedRootDir,
      sessionPaths,
      projectStatePaths,
      env: sessionEnv,
      shellConfig,
    }),
    spawnHook: (context) => ({
      ...context,
      cwd: assertManagedPath(managedRootDir, context.cwd),
      env: {
        ...context.env,
        ...sessionEnv,
      },
    }),
  });
  sandboxCommandTool.label = "OfficeAgent Windows sandbox exec";
  sandboxCommandTool.description = [
    "Run a command with OfficeAgent's Windows write-contained execution model for the current project. OfficeAgent launches real Windows processes; it does not provide a fake shell command language.",
    "You may use normal Windows commands and tools such as cmd.exe, powershell.exe, pwsh.exe, npm, npx, node, python, pip, uv, git, cargo, dotnet, and package scripts when they are available.",
    "The OS enforces write containment. Commands can modify the OfficeAgent managed project/root; reads outside the root may succeed or fail according to normal Windows permissions.",
    "Python is managed by OfficeAgent: use normal python/pip/py/uv commands; packages install into the hidden managed environment, not into the visible workspace.",
    "For complex logic, write temporary .cmd, .ps1, .js, or .py files under %OFFICE_AGENT_SCRATCH%; save only user-facing inputs/outputs in %OFFICE_AGENT_WORKSPACE%.",
    "Host tools visible on PATH may be tried when available. Prefer OfficeAgent-staged/project-local tools for reproducibility.",
  ].join(" ");
  sandboxCommandTool.promptSnippet = "Execute normal Windows commands with OfficeAgent write containment for the current project.";
  sandboxCommandTool.promptGuidelines = [
    shellPromptContext,
    "You may use cmd.exe, powershell.exe, pwsh.exe, direct project/toolchain commands, and package scripts. OfficeAgent should not be treated as a fake shell with its own command vocabulary.",
    "Prefer commands that operate within the current project/managed root. Writes outside the managed root should fail; reads outside may succeed or fail according to Windows permissions.",
    "Use normal python, py, pip, python -m pip, and uv pip commands. OfficeAgent routes them to a hidden per-workspace Python environment automatically; do not create pylibs, .venv, or package folders in the visible workspace.",
    "For multi-step or complex logic, write temporary .cmd, .ps1, .js, or .py scripts under %OFFICE_AGENT_SCRATCH% and execute them. Keep %OFFICE_AGENT_WORKSPACE% for user-visible files and final results.",
    "Host tools on PATH may be tried when available. Prefer npm scripts, node, python, pip, uv, git, cargo, dotnet, and other project-local/staged tools over host-specific assumptions.",
  ];

  const virtualFsClient = createOfficeAgentVirtualFsClient({ env: sessionEnv });
  const readTool = withOfficeAgentPathPlaceholderExpansion(createOfficeAgentVirtualReadTool(createReadToolDefinition, {
    cwd,
    roots: virtualRoots,
    client: virtualFsClient,
  }), sessionEnv);
  const lsTool = withOfficeAgentPathPlaceholderExpansion(createOfficeAgentVirtualLsTool(createLsToolDefinition, {
    cwd,
    roots: virtualRoots,
    client: virtualFsClient,
  }), sessionEnv);
  const findTool = withOfficeAgentPathPlaceholderExpansion(createOfficeAgentVirtualFindTool(createFindToolDefinition, {
    cwd,
    roots: virtualRoots,
    client: virtualFsClient,
  }), sessionEnv);
  const grepTool = withOfficeAgentPathPlaceholderExpansion(createOfficeAgentVirtualGrepTool(createGrepToolDefinition, {
    cwd,
    roots: virtualRoots,
    client: virtualFsClient,
  }), sessionEnv);
  const editTool = withOfficeAgentPathPlaceholderExpansion(withOfficeAgentVirtualEditGuard(createEditToolDefinition(cwd, {
    operations: {
      access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
      readFile: (absolutePath: string) => readFile(assertManagedPath(managedRootDir, absolutePath)),
      writeFile: async (absolutePath: string, content: string) => {
        const target = assertManagedPath(managedRootDir, absolutePath);
        await writeFileWithOfficeAgentSandbox(managedRootDir, target, content, { createParentDirs: true });
      },
    },
  }), virtualRoots), sessionEnv);
  const writeTool = withOfficeAgentPathPlaceholderExpansion(withOfficeAgentVirtualWriteGuard(createWriteToolDefinition(cwd, {
    operations: {
      mkdir: (dir: string) => mkdirWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, dir)),
      writeFile: (absolutePath: string, content: string) =>
        writeFileWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, absolutePath), content),
    },
  }), virtualRoots), sessionEnv);

  const customTools = [
    readTool,
    lsTool,
    findTool,
    grepTool,
    createCopyFileIntoWorkspaceToolDefinition({ cwd, managedRootDir, env: sessionEnv }),
    withOfficeAgentVirtualBashAdvisory(sandboxCommandTool, virtualRoots),
    editTool,
    writeTool,
    ...(options.baseCustomTools ?? []),
  ] as unknown as NonNullable<CreateAgentSessionOptions["customTools"]>;

  return {
    ...options.baseOptions,
    cwd,
    agentDir,
    sessionManager,
    ...(options.runtimeOptions.sessionStartEvent
      ? { sessionStartEvent: options.runtimeOptions.sessionStartEvent }
      : {}),
    settingsManager,
    ...(options.providedResourceLoader && resolve(options.initialCwd) === cwd && options.initialSessionId === sessionId
      ? { resourceLoader: options.providedResourceLoader }
      : { resourceLoaderOptions: { appendSystemPromptOverride: (base) => [...base, ...promptContexts] } }),
    noTools: "builtin",
    customTools,
    processEnv: sessionEnv,
  };
}

function getOfficeAgentSessionWritablePathsForSetup(paths: Awaited<ReturnType<typeof ensureOfficeAgentManagedSessionLayout>>): string[] {
  return [
    paths.sessionDir,
    paths.profileDir,
    paths.appDataDir,
    paths.localAppDataDir,
    paths.tempDir,
    paths.scratchDir,
    paths.logsDir,
  ];
}

function getOfficeAgentProjectStateWritablePathsForSetup(paths: Awaited<ReturnType<typeof ensureOfficeAgentManagedProjectStateLayout>>): string[] {
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

type ToolWithPrepareArguments = {
  prepareArguments?: (args: unknown) => unknown;
};

function withOfficeAgentPathPlaceholderExpansion<TTool>(tool: TTool, env: NodeJS.ProcessEnv): TTool {
  const mutableTool = tool as ToolWithPrepareArguments;
  const previousPrepareArguments = mutableTool.prepareArguments;
  mutableTool.prepareArguments = (args: unknown) => {
    const preparedArgs = previousPrepareArguments ? previousPrepareArguments(args) : args;
    return expandToolPathArguments(preparedArgs, env);
  };
  return tool;
}

function expandToolPathArguments(args: unknown, env: NodeJS.ProcessEnv): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }
  const mutableArgs = { ...(args as Record<string, unknown>) };
  const rawPath = typeof mutableArgs.path === "string"
    ? mutableArgs.path
    : typeof mutableArgs.file_path === "string"
      ? mutableArgs.file_path
      : undefined;
  if (rawPath !== undefined) {
    mutableArgs.path = expandOfficeAgentPathPlaceholders(rawPath, env);
    mutableArgs.file_path = undefined;
  }
  return mutableArgs;
}

function defaultWindowsSandboxBackendToV2(): void {
  if (process.platform !== "win32") {
    return;
  }
  if (!process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND?.trim()) {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
  }
}

function assertManagedPath(managedRootDir: string, pathValue: string): string {
  const absolutePath = resolve(pathValue);
  if (!isPathWithin(managedRootDir, absolutePath)) {
    throw new Error(`OfficeAgent blocked path outside managed root: ${absolutePath}`);
  }
  return absolutePath;
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
