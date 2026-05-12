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
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  SettingsManager,
  type CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import {
  createAgentSessionRuntimeWithNpmFallback,
  createSettingsManagerWithoutNpmPackages,
  isGlobalNpmLookupError,
} from "./npm-package-fallback.js";
import { getOfficeAgentAppPromptContext } from "./office-agent-prompt-context.js";
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

  const sessionId = options.sessionManager?.getSessionId();
  if (!sessionId) {
    throw new Error("OfficeAgent managed runtime requires a session manager with a session id.");
  }

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
  const promptContexts = [appPromptContext, shellPromptContext];
  const agentDir = options.agentDir;
  const resourceSetup = options.resourceLoader
    ? { resourceLoader: options.resourceLoader, settingsManager: options.settingsManager }
    : await createOfficeAgentResourceLoader(cwd, agentDir, promptContexts, options.settingsManager);
  const sessionEnv = getOfficeAgentManagedSessionEnv(sessionId, process.env, {
    managedRootDir,
    activeProjectDir: cwd,
    ...(agentDir ? { agentDir } : {}),
  });

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
    "Host tools visible on PATH may be tried when available. Prefer OfficeAgent-staged/project-local tools for reproducibility.",
    "For complex logic, write a temporary .cmd, .ps1, .js, or .py file inside the project and run it.",
  ].join(" ");
  sandboxCommandTool.promptSnippet = "Execute normal Windows commands with OfficeAgent write containment for the current project.";
  sandboxCommandTool.promptGuidelines = [
    shellPromptContext,
    "You may use cmd.exe, powershell.exe, pwsh.exe, direct project/toolchain commands, and package scripts. OfficeAgent should not be treated as a fake shell with its own command vocabulary.",
    "Prefer commands that operate within the current project/managed root. Writes outside the managed root should fail; reads outside may succeed or fail according to Windows permissions.",
    "Host tools on PATH may be tried when available. Prefer npm scripts, node, python, pip, uv, git, cargo, dotnet, and other project-local/staged tools over host-specific assumptions.",
    "For multi-step or complex logic, write a temporary .cmd, .ps1, .js, or .py script inside the project and execute it.",
  ];

  const customTools = [
      createReadToolDefinition(cwd),
      sandboxCommandTool,
      createEditToolDefinition(cwd, {
        operations: {
          access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
          readFile: (absolutePath: string) => readFile(assertManagedPath(managedRootDir, absolutePath)),
          writeFile: async (absolutePath: string, content: string) => {
            const target = assertManagedPath(managedRootDir, absolutePath);
            await writeFileWithOfficeAgentSandbox(managedRootDir, target, content, { createParentDirs: true });
          },
        },
      }),
      createWriteToolDefinition(cwd, {
        operations: {
          mkdir: (dir: string) => mkdirWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, dir)),
          writeFile: (absolutePath: string, content: string) => writeFileWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, absolutePath), content),
        },
      }),
      ...(options.customTools ?? []),
    ] as unknown as NonNullable<CreateAgentSessionOptions["customTools"]>;

  const managedOptions: CreateAgentSessionOptions = {
    ...options,
    cwd,
    ...(resourceSetup.settingsManager ? { settingsManager: resourceSetup.settingsManager } : {}),
    resourceLoader: resourceSetup.resourceLoader,
    tools: [],
    customTools,
  };

  return withScopedProcessEnv(sessionEnv, () => createAgentSessionRuntimeWithNpmFallback(managedOptions));
}

function getOfficeAgentSessionWritablePathsForSetup(paths: Awaited<ReturnType<typeof ensureOfficeAgentManagedSessionLayout>>): string[] {
  return [
    paths.sessionDir,
    paths.profileDir,
    paths.appDataDir,
    paths.localAppDataDir,
    paths.tempDir,
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
    paths.npmCacheDir,
    paths.npmPrefixDir,
    paths.pipCacheDir,
    paths.pythonUserBaseDir,
    paths.uvCacheDir,
    paths.uvToolDir,
    paths.uvToolBinDir,
    paths.uvPythonInstallDir,
    paths.uvPythonBinDir,
  ];
}

function defaultWindowsSandboxBackendToV2(): void {
  if (process.platform !== "win32") {
    return;
  }
  if (!process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND?.trim()) {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
  }
}

async function createOfficeAgentResourceLoader(
  cwd: string,
  agentDir: string | undefined,
  promptContexts: readonly string[],
  providedSettingsManager: SettingsManager | undefined,
): Promise<{ resourceLoader: DefaultResourceLoader; settingsManager: SettingsManager }> {
  const settingsManager = providedSettingsManager ?? SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    ...(agentDir ? { agentDir } : {}),
    settingsManager,
    appendSystemPromptOverride: (base) => [...base, ...promptContexts],
  });
  try {
    await resourceLoader.reload();
    return { resourceLoader, settingsManager };
  } catch (error) {
    if (!isGlobalNpmLookupError(error)) {
      throw error;
    }
    const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(settingsManager);
    if (!fallbackSettingsManager) {
      throw error;
    }
    const fallbackResourceLoader = new DefaultResourceLoader({
      cwd,
      ...(agentDir ? { agentDir } : {}),
      settingsManager: fallbackSettingsManager,
      appendSystemPromptOverride: (base) => [...base, ...promptContexts],
    });
    await fallbackResourceLoader.reload();
    return { resourceLoader: fallbackResourceLoader, settingsManager: fallbackSettingsManager };
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

async function withScopedProcessEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
