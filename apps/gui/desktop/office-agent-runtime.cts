import { existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import type { PiModule } from "./pi-module.cts";
import {
  ensureOfficeAgentManagedAgentDir,
  ensureOfficeAgentManagedProjectStateLayout,
  ensureOfficeAgentManagedRoot,
  ensureOfficeAgentManagedSessionLayout,
  findOfficeAgentManagedRootForPath,
  getOfficeAgentAgentDir,
  getOfficeAgentManagedEnv,
  getOfficeAgentManagedRootDir,
  getOfficeAgentManagedSessionEnv,
  getOfficeAgentProjectsDir,
  OFFICE_AGENT_MODEL_ID,
  OFFICE_AGENT_PROVIDER_ID,
  OFFICE_AGENT_PROVIDER_LABEL,
  getDefaultOfficeAgentEnabledModel,
  getOfficeAgentEnabledModel,
  normalizeOfficeAgentModelSelection,
  resolveOfficeAgentEnabledModelSelection,
} from "../../../packages/office-agent-runtime/src/index.ts";
export {
  OFFICE_AGENT_PROVIDER_ID,
  OFFICE_AGENT_PROVIDER_LABEL,
  getDefaultOfficeAgentEnabledModel,
  getOfficeAgentEnabledModel,
  normalizeOfficeAgentModelSelection,
  resolveOfficeAgentEnabledModelSelection,
  getOfficeAgentVirtualFsPromptContext,
  OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS,
};
import {
  getOfficeAgentArtifactPromptContexts,
  getOfficeAgentManagedAppPromptContexts,
} from "../../../packages/pi-sdk-driver/src/office-agent-prompt-context.ts";
import { expandOfficeAgentPathPlaceholders } from "../../../packages/pi-sdk-driver/src/office-agent-path-placeholders.ts";
import { createCopyFileIntoWorkspaceToolDefinition } from "../../../packages/pi-sdk-driver/src/office-agent-workspace-tools.ts";
import {
  createOfficeAgentVirtualFsClient,
  getOfficeAgentVirtualFsPromptContext,
  OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS,
} from "../../../packages/pi-sdk-driver/src/office-agent-virtual-fs.ts";
import {
  createOfficeAgentVirtualFindTool,
  createOfficeAgentVirtualGrepTool,
  createOfficeAgentVirtualLsTool,
  createOfficeAgentVirtualReadTool,
  withOfficeAgentVirtualBashAdvisory,
  withOfficeAgentVirtualEditGuard,
  withOfficeAgentVirtualWriteGuard,
} from "../../../packages/pi-sdk-driver/src/office-agent-virtual-fs-tools.ts";
import {
  createOfficeAgentSandboxBashOperations,
  ensureOfficeAgentSandboxShellConfig,
  ensureOfficeAgentWindowsSandboxV2Ready,
  getOfficeAgentSandboxShellPromptContext,
  mkdirWithOfficeAgentSandbox,
  writeFileWithOfficeAgentSandbox,
} from "../../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts";

const bundledRipgrepRuntimeId = "ripgrep-14.1.1-win-x64-officeagent-r1";
const defaultOfficeAgentModel = getDefaultOfficeAgentEnabledModel();

export const officeAgentModelSelection = {
  ...(defaultOfficeAgentModel ? { catalogId: defaultOfficeAgentModel.catalogId } : {}),
  provider: OFFICE_AGENT_PROVIDER_ID,
  id: OFFICE_AGENT_MODEL_ID,
} as const;

export function getOfficeAgentDefaultProjectLocation(): string {
  return getOfficeAgentProjectsDir(getOfficeAgentManagedRootDir());
}

export function isOfficeAgentManagedProjectPath(pathValue: string): boolean {
  return isPathWithin(getOfficeAgentDefaultProjectLocation(), pathValue);
}

export async function prepareOfficeAgentDesktopRuntime(): Promise<{
  readonly agentDir: string;
  readonly managedRootDir: string;
  readonly projectsDir: string;
}> {
  const agentDir = getOfficeAgentAgentDir();
  const managedRootDir = getOfficeAgentManagedRootDir();
  const projectsDir = getOfficeAgentProjectsDir(managedRootDir);

  Object.assign(
    process.env,
    getOfficeAgentManagedEnv(process.env, { agentDir, clientKind: "gui" }),
  );
  process.env.HOWCODE_REPO_ROOT = process.env.HOWCODE_REPO_ROOT?.trim() || projectsDir;
  defaultWindowsSandboxBackendToV2();
  setSandboxHelperEnvIfPresent();

  await ensureOfficeAgentManagedAgentDir(agentDir);
  await stageBundledRipgrepForPi(agentDir);
  await ensureOfficeAgentManagedRoot(managedRootDir);

  return { agentDir, managedRootDir, projectsDir };
}

function getOfficeAgentDefaultVirtualFsPromptContext(): string {
  return getOfficeAgentVirtualFsPromptContext(OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS);
}

type OfficeAgentPiToolFactories = Pick<
  PiModule,
  | "createBashToolDefinition"
  | "createEditToolDefinition"
  | "createFindToolDefinition"
  | "createGrepToolDefinition"
  | "createLsToolDefinition"
  | "createReadToolDefinition"
  | "createWriteToolDefinition"
>;

export function getOfficeAgentDesktopPromptContexts(options: {
  readonly cwd: string;
  readonly managedRootDir?: string;
  readonly sessionId?: string;
  readonly shellPromptContext?: string;
  readonly includeManagedWorkspace?: boolean;
}): string[] {
  const cwd = resolve(options.cwd);
  const includeManagedWorkspace = options.includeManagedWorkspace ?? true;
  const managedRootDir = includeManagedWorkspace
    ? (options.managedRootDir ?? resolveOfficeAgentManagedRootForPath(cwd))
    : null;
  if (includeManagedWorkspace && !managedRootDir) {
    throw new Error(`OfficeAgent project is outside managed AgentData: ${cwd}`);
  }

  if (!managedRootDir) {
    return getOfficeAgentArtifactPromptContexts();
  }

  return [
    ...getOfficeAgentManagedAppPromptContexts({
      cwd,
      managedRootDir,
      sessionId: options.sessionId,
    }),
    ...(options.shellPromptContext ? [options.shellPromptContext] : []),
    getOfficeAgentDefaultVirtualFsPromptContext(),
  ];
}

export async function createOfficeAgentManagedRuntimeContext(options: {
  readonly cwd: string;
  readonly sessionId: string;
  readonly agentDir: string;
  readonly pi: OfficeAgentPiToolFactories;
}): Promise<{
  readonly customTools: NonNullable<CreateAgentSessionOptions["customTools"]>;
  readonly promptContexts: string[];
  readonly managedRootDir: string;
}> {
  const cwd = resolve(options.cwd);
  const managedRootDir = resolveOfficeAgentManagedRootForPath(cwd);
  if (!managedRootDir) {
    throw new Error(`OfficeAgent project is outside managed AgentData: ${cwd}`);
  }

  const [sessionPaths, projectStatePaths] = await Promise.all([
    ensureOfficeAgentManagedSessionLayout(options.sessionId, managedRootDir),
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
  const shellPromptContext = getOfficeAgentSandboxShellPromptContext(shellConfig);
  const sessionEnv = getOfficeAgentManagedSessionEnv(options.sessionId, process.env, {
    managedRootDir,
    agentDir: options.agentDir,
    clientKind: "gui",
    activeProjectDir: cwd,
  });

  const sandboxCommandTool = options.pi.createBashToolDefinition(cwd, {
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
    "Run commands with OfficeAgent's write-contained Windows execution model for this managed project.",
    "Commands may modify only the OfficeAgent managed project/root; reads outside may succeed or fail according to Windows permissions.",
  ].join(" ");
  sandboxCommandTool.promptSnippet =
    "Execute Windows commands with OfficeAgent write containment for the current project.";
  sandboxCommandTool.promptGuidelines = [
    shellPromptContext,
    "Prefer commands that operate inside the current managed project.",
    "Before modifying, transforming, deeply inspecting, or running tools against a real user file, call copy_file_into_workspace and work on the returned workspace copy.",
    "Use %OFFICE_AGENT_SCRATCH% for temporary scripts/intermediate files; keep %OFFICE_AGENT_WORKSPACE% for user-facing files and final outputs.",
    "Use normal python, py, pip, python -m pip, and uv pip commands. OfficeAgent routes them to a hidden managed Python environment automatically; do not create pylibs or .venv folders in the visible workspace.",
    "Writes outside the OfficeAgent managed root should fail.",
  ];

  const virtualRoots = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS;
  const virtualFsClient = createOfficeAgentVirtualFsClient({ env: sessionEnv });
  const readTool = withOfficeAgentPathPlaceholderExpansion(
    createOfficeAgentVirtualReadTool(options.pi.createReadToolDefinition, {
      cwd,
      roots: virtualRoots,
      client: virtualFsClient,
    }),
    sessionEnv,
  );
  const lsTool = withOfficeAgentPathPlaceholderExpansion(
    createOfficeAgentVirtualLsTool(options.pi.createLsToolDefinition, {
      cwd,
      roots: virtualRoots,
      client: virtualFsClient,
    }),
    sessionEnv,
  );
  const findTool = withOfficeAgentPathPlaceholderExpansion(
    createOfficeAgentVirtualFindTool(options.pi.createFindToolDefinition, {
      cwd,
      roots: virtualRoots,
      client: virtualFsClient,
    }),
    sessionEnv,
  );
  const grepTool = withOfficeAgentPathPlaceholderExpansion(
    createOfficeAgentVirtualGrepTool(options.pi.createGrepToolDefinition, {
      cwd,
      roots: virtualRoots,
      client: virtualFsClient,
    }),
    sessionEnv,
  );
  const editTool = withOfficeAgentPathPlaceholderExpansion(
    withOfficeAgentVirtualEditGuard(
      options.pi.createEditToolDefinition(cwd, {
        operations: {
          access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
          readFile: (absolutePath: string) =>
            readFile(assertManagedPath(managedRootDir, absolutePath)),
          writeFile: async (absolutePath: string, content: string) => {
            const target = assertManagedPath(managedRootDir, absolutePath);
            await writeFileWithOfficeAgentSandbox(managedRootDir, target, content, {
              createParentDirs: true,
            });
          },
        },
      }),
      virtualRoots,
    ),
    sessionEnv,
  );
  const writeTool = withOfficeAgentPathPlaceholderExpansion(
    withOfficeAgentVirtualWriteGuard(
      options.pi.createWriteToolDefinition(cwd, {
        operations: {
          mkdir: (dir: string) =>
            mkdirWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, dir)),
          writeFile: (absolutePath: string, content: string) =>
            writeFileWithOfficeAgentSandbox(
              managedRootDir,
              assertManagedPath(managedRootDir, absolutePath),
              content,
            ),
        },
      }),
      virtualRoots,
    ),
    sessionEnv,
  );

  const customTools = [
    readTool,
    lsTool,
    findTool,
    grepTool,
    createCopyFileIntoWorkspaceToolDefinition({ cwd, managedRootDir, env: sessionEnv }),
    withOfficeAgentVirtualBashAdvisory(sandboxCommandTool, virtualRoots),
    editTool,
    writeTool,
  ] as NonNullable<CreateAgentSessionOptions["customTools"]>;

  return {
    customTools,
    promptContexts: getOfficeAgentDesktopPromptContexts({
      cwd,
      managedRootDir,
      sessionId: options.sessionId,
      shellPromptContext,
    }),
    managedRootDir,
  };
}

function getOfficeAgentSessionWritablePathsForSetup(
  paths: Awaited<ReturnType<typeof ensureOfficeAgentManagedSessionLayout>>,
): string[] {
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

function getOfficeAgentProjectStateWritablePathsForSetup(
  paths: Awaited<ReturnType<typeof ensureOfficeAgentManagedProjectStateLayout>>,
): string[] {
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

function withOfficeAgentPathPlaceholderExpansion<TTool>(
  tool: TTool,
  env: NodeJS.ProcessEnv,
): TTool {
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
  const rawPath =
    typeof mutableArgs.path === "string"
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

export function assertManagedPath(managedRootDir: string, pathValue: string): string {
  const absolutePath = resolve(pathValue);
  if (!isPathWithin(managedRootDir, absolutePath)) {
    throw new Error(`OfficeAgent blocked path outside managed root: ${absolutePath}`);
  }
  return absolutePath;
}

function resolveOfficeAgentManagedRootForPath(pathValue: string): string | undefined {
  const discoveredRoot = findOfficeAgentManagedRootForPath(pathValue);
  if (discoveredRoot) {
    return discoveredRoot;
  }

  const defaultManagedRoot = getOfficeAgentManagedRootDir();
  return isPathWithin(defaultManagedRoot, pathValue) ? defaultManagedRoot : undefined;
}

function isPathWithin(parent: string, candidate: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedCandidate = resolve(candidate);
  const rel = relative(normalizedParent, normalizedCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function defaultWindowsSandboxBackendToV2(): void {
  if (process.platform !== "win32") {
    return;
  }
  if (!process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND?.trim()) {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
  }
}

async function stageBundledRipgrepForPi(agentDir: string): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const source = resolveBundledRipgrepPath();
  if (!source) {
    return;
  }

  const binDir = join(agentDir, "bin");
  const target = join(binDir, "rg.exe");
  await mkdir(binDir, { recursive: true });
  await copyFile(source, target);

  const currentPath = process.env.PATH ?? "";
  const pathEntries = currentPath.split(delimiter).filter(Boolean);
  if (
    !pathEntries.some((entry) => resolve(entry).toLowerCase() === resolve(binDir).toLowerCase())
  ) {
    process.env.PATH = [binDir, currentPath].filter(Boolean).join(delimiter);
  }
}

function resolveBundledRipgrepPath(): string | undefined {
  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = typeof resourcesPathValue === "string" ? resourcesPathValue : undefined;
  const relativeRuntimePath = ["runtime", "tools", bundledRipgrepRuntimeId, "rg.exe"];
  const buildRuntimePath = ["apps", "gui", "desktop", "build", ...relativeRuntimePath];
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, ...relativeRuntimePath)] : []),
    resolve(process.cwd(), ...relativeRuntimePath),
    resolve(process.cwd(), ...buildRuntimePath),
    resolve(process.cwd(), "..", "..", ...buildRuntimePath),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function setSandboxHelperEnvIfPresent(): void {
  if (process.env.OFFICE_AGENT_WINDOWS_SANDBOX_HELPER?.trim()) {
    return;
  }

  const fileName = "officeagent-windows-sandbox-helper.exe";
  const resourcesPathValue = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourcesPath = typeof resourcesPathValue === "string" ? resourcesPathValue : undefined;
  const bundledHelperPath = [
    "apps",
    "gui",
    "desktop",
    "build",
    "native",
    "windows-sandbox-helper",
    fileName,
  ];
  const nativeReleaseHelperPath = [
    "native",
    "windows-sandbox-helper",
    "target",
    "release",
    fileName,
  ];
  const nativeDebugHelperPath = ["native", "windows-sandbox-helper", "target", "debug", fileName];
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, "windows-sandbox-helper", fileName)] : []),
    resolve(process.cwd(), "resources", "windows-sandbox-helper", fileName),
    resolve(process.cwd(), ...bundledHelperPath),
    resolve(process.cwd(), "..", "..", ...bundledHelperPath),
    resolve(process.cwd(), ...nativeReleaseHelperPath),
    resolve(process.cwd(), ...nativeDebugHelperPath),
    resolve(process.cwd(), "..", "..", ...nativeReleaseHelperPath),
    resolve(process.cwd(), "..", "..", ...nativeDebugHelperPath),
  ];
  const existingCandidate = candidates.find((candidate) => existsSync(candidate));
  if (existingCandidate) {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_HELPER = existingCandidate;
  }
}
