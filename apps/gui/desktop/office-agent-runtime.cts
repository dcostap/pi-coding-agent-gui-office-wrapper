import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
};
import {
  createOfficeAgentSandboxBashOperations,
  ensureOfficeAgentSandboxShellConfig,
  ensureOfficeAgentWindowsSandboxV2Ready,
  getOfficeAgentSandboxShellPromptContext,
  mkdirWithOfficeAgentSandbox,
  writeFileWithOfficeAgentSandbox,
} from "../../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts";

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

  Object.assign(process.env, getOfficeAgentManagedEnv(process.env, { agentDir, clientKind: "gui" }));
  process.env.HOWCODE_REPO_ROOT = process.env.HOWCODE_REPO_ROOT?.trim() || projectsDir;
  defaultWindowsSandboxBackendToV2();
  setSandboxHelperEnvIfPresent();

  await ensureOfficeAgentManagedAgentDir(agentDir);
  await ensureOfficeAgentManagedRoot(managedRootDir);

  return { agentDir, managedRootDir, projectsDir };
}

export async function createOfficeAgentManagedCustomTools(options: {
  readonly cwd: string;
  readonly sessionId: string;
  readonly agentDir: string;
  readonly pi: Pick<
    PiModule,
    | "createBashToolDefinition"
    | "createEditToolDefinition"
    | "createReadToolDefinition"
    | "createWriteToolDefinition"
  >;
}): Promise<NonNullable<CreateAgentSessionOptions["customTools"]>> {
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
  sandboxCommandTool.promptSnippet = "Execute Windows commands with OfficeAgent write containment for the current project.";
  sandboxCommandTool.promptGuidelines = [
    shellPromptContext,
    "Prefer commands that operate inside the current managed project.",
    "Writes outside the OfficeAgent managed root should fail.",
  ];

  return [
    options.pi.createReadToolDefinition(cwd),
    sandboxCommandTool,
    options.pi.createEditToolDefinition(cwd, {
      operations: {
        access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
        readFile: (absolutePath: string) => readFile(assertManagedPath(managedRootDir, absolutePath)),
        writeFile: async (absolutePath: string, content: string) => {
          const target = assertManagedPath(managedRootDir, absolutePath);
          await writeFileWithOfficeAgentSandbox(managedRootDir, target, content, { createParentDirs: true });
        },
      },
    }),
    options.pi.createWriteToolDefinition(cwd, {
      operations: {
        mkdir: (dir: string) => mkdirWithOfficeAgentSandbox(managedRootDir, assertManagedPath(managedRootDir, dir)),
        writeFile: (absolutePath: string, content: string) =>
          writeFileWithOfficeAgentSandbox(
            managedRootDir,
            assertManagedPath(managedRootDir, absolutePath),
            content,
          ),
      },
    }),
  ] as NonNullable<CreateAgentSessionOptions["customTools"]>;
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
  const nativeReleaseHelperPath = ["native", "windows-sandbox-helper", "target", "release", fileName];
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
