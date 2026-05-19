import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OFFICE_AGENT_APP_NAME = "OfficeAgent";
export const OFFICE_AGENT_PROVIDER_ID = "CastrosuaIA";
export const OFFICE_AGENT_PROVIDER_LABEL = "Castrosua IA";
export const OFFICE_AGENT_LEGACY_PROVIDER_IDS = ["corp"] as const;
export const OFFICE_AGENT_SPARK_MODEL_ID = "assistant";
// Keep the gateway-facing model id as gpt-5.5 for compatibility with the current
// gateway route, but present it to users as GPT-5.4 until the deployed gateway
// dependency supports gpt-5.5.
export const OFFICE_AGENT_MODEL_ID = "gpt-5.5";
export const OFFICE_AGENT_MODEL_LABEL = "GPT-5.4";
export const OFFICE_AGENT_GATEWAY_URL_ENV_NAME = "OFFICE_AGENT_GATEWAY_URL";
export const OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME = "OFFICE_AGENT_GATEWAY_TOKEN";
export const OFFICE_AGENT_CLIENT_KIND_ENV_NAME = "OFFICE_AGENT_CLIENT_KIND";
export const OFFICE_AGENT_WINDOWS_USER_ENV_NAME = "OFFICE_AGENT_WINDOWS_USER";
export const OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME = "OFFICE_AGENT_WINDOWS_DOMAIN";
export const OFFICE_AGENT_WINDOWS_HOST_ENV_NAME = "OFFICE_AGENT_WINDOWS_HOST";
export const OFFICE_AGENT_DEFAULT_GATEWAY_URL = "http://172.16.1.124:8082/v1";
export const OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN = "d4e36536607aac0b45ff59b5c60c25574f1faf7ba7a6f9859a47fd1f51837ba4";
export const OFFICE_AGENT_MANAGED_PROJECTS_DIR_NAME = "projects";
export const OFFICE_AGENT_MANAGED_INTERNAL_DIR_NAME = ".officeagent";
export const OFFICE_AGENT_MANAGED_SESSIONS_DIR_NAME = "sessions";
export const OFFICE_AGENT_MANAGED_PROJECT_STATE_DIR_NAME = "project-state";
export const OFFICE_AGENT_MANAGED_SESSION_FILES_DIR_NAME = "workspace-files";
export const OFFICE_AGENT_MANAGED_SESSION_PROFILE_DIR_NAME = "profile";
export const OFFICE_AGENT_MANAGED_SESSION_TEMP_DIR_NAME = "temp";
export const OFFICE_AGENT_MANAGED_SESSION_NPM_CACHE_DIR_NAME = "npm-cache";
export const OFFICE_AGENT_MANAGED_SESSION_NPM_PREFIX_DIR_NAME = "npm-prefix";
export const OFFICE_AGENT_MANAGED_SESSION_PIP_CACHE_DIR_NAME = "pip-cache";
export const OFFICE_AGENT_MANAGED_SESSION_PYTHON_USER_BASE_DIR_NAME = "python-user-base";
export const OFFICE_AGENT_MANAGED_SESSION_UV_CACHE_DIR_NAME = "uv-cache";
export const OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_DIR_NAME = "uv-tools";
export const OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_BIN_DIR_NAME = "uv-tools-bin";
export const OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_INSTALL_DIR_NAME = "uv-python";
export const OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_BIN_DIR_NAME = "uv-python-bin";
export const OFFICE_AGENT_MANAGED_PROJECT_CACHE_DIR_NAME = "cache";
export const OFFICE_AGENT_MANAGED_PROJECT_CONFIG_DIR_NAME = "config";
export const OFFICE_AGENT_MANAGED_PROJECT_DATA_DIR_NAME = "data";
export const OFFICE_AGENT_MANAGED_PROJECT_TOOLS_DIR_NAME = "tools";
export const OFFICE_AGENT_MANAGED_PROJECT_BIN_DIR_NAME = "bin";
export const OFFICE_AGENT_MANAGED_SESSION_LOGS_DIR_NAME = "logs";
export const OFFICE_AGENT_MANAGED_RUNTIME_DIR_NAME = "runtime";
export const OFFICE_AGENT_STAGED_GIT_BASH_RUNTIME_NAME = "git-bash";
export const OFFICE_AGENT_STAGED_GIT_BASH_VERSION = "v1";
export const OFFICE_AGENT_STAGED_PYTHON_RUNTIME_NAME = "python";
export const OFFICE_AGENT_STAGED_UV_RUNTIME_NAME = "uv";
export const OFFICE_AGENT_PYTHON_RUNTIME_MANIFEST_NAME = "officeagent-python-runtime.json";
export const OFFICE_AGENT_UV_RUNTIME_MANIFEST_NAME = "officeagent-uv-runtime.json";
export const OFFICE_AGENT_STAGED_GIT_BASH_DIR_ENV_NAME = "OFFICE_AGENT_STAGED_GIT_BASH_DIR";
export const OFFICE_AGENT_SANDBOX_BASH_PATH_ENV_NAME = "OFFICE_AGENT_SANDBOX_BASH_PATH";
export const OFFICE_AGENT_REAL_USERPROFILE_ENV_NAME = "OFFICE_AGENT_REAL_USERPROFILE";
export const OFFICE_AGENT_REAL_DESKTOP_ENV_NAME = "OFFICE_AGENT_REAL_DESKTOP";
export const OFFICE_AGENT_REAL_DOCUMENTS_ENV_NAME = "OFFICE_AGENT_REAL_DOCUMENTS";
export const OFFICE_AGENT_REAL_DOWNLOADS_ENV_NAME = "OFFICE_AGENT_REAL_DOWNLOADS";
export const OFFICE_AGENT_REAL_PICTURES_ENV_NAME = "OFFICE_AGENT_REAL_PICTURES";
export const OFFICE_AGENT_REAL_VIDEOS_ENV_NAME = "OFFICE_AGENT_REAL_VIDEOS";
export const OFFICE_AGENT_REAL_MUSIC_ENV_NAME = "OFFICE_AGENT_REAL_MUSIC";
export const OFFICE_AGENT_SANDBOX_PROFILE_ENV_NAME = "OFFICE_AGENT_SANDBOX_PROFILE";
export const OFFICE_AGENT_MANAGED_ROOT_ENV_NAME = "OFFICE_AGENT_MANAGED_ROOT";
export const OFFICE_AGENT_ACTIVE_PROJECT_ENV_NAME = "OFFICE_AGENT_ACTIVE_PROJECT";
export const OFFICE_AGENT_PROJECT_STATE_ENV_NAME = "OFFICE_AGENT_PROJECT_STATE";
export const OFFICE_AGENT_PROJECT_CACHE_ENV_NAME = "OFFICE_AGENT_PROJECT_CACHE";
export const OFFICE_AGENT_PROJECT_TOOLS_ENV_NAME = "OFFICE_AGENT_PROJECT_TOOLS";

export type OfficeAgentClientKind = "gui" | "tui" | "unknown";
export type OfficeAgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type OfficeAgentModelWorkflow = "chat" | "code" | "gitCommit" | "skillCreator";

export interface OfficeAgentEnabledModel {
  readonly catalogId: string;
  readonly provider: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly label: string;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly defaultThinkingLevel: OfficeAgentThinkingLevel;
  readonly enabledFor: readonly OfficeAgentModelWorkflow[];
}

export interface OfficeAgentModelSelection {
  readonly catalogId: string;
  readonly provider: string;
  readonly modelId: string;
}

export const OFFICE_AGENT_ENABLED_MODELS = [
  {
    catalogId: "castrosua/gpt-5.4",
    provider: OFFICE_AGENT_PROVIDER_ID,
    providerLabel: OFFICE_AGENT_PROVIDER_LABEL,
    modelId: OFFICE_AGENT_MODEL_ID,
    label: OFFICE_AGENT_MODEL_LABEL,
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 16384,
    defaultThinkingLevel: "medium",
    enabledFor: ["chat", "code", "gitCommit", "skillCreator"],
  },
] as const satisfies readonly OfficeAgentEnabledModel[];

export function getOfficeAgentEnabledModelByCatalogId(catalogId: string): OfficeAgentEnabledModel | null {
  return OFFICE_AGENT_ENABLED_MODELS.find((model) => model.catalogId === catalogId) ?? null;
}

export function getOfficeAgentEnabledModel(provider: string, modelId: string): OfficeAgentEnabledModel | null {
  return (
    OFFICE_AGENT_ENABLED_MODELS.find((model) => model.provider === provider && model.modelId === modelId) ??
    OFFICE_AGENT_ENABLED_MODELS.find(
      (model) =>
        model.modelId === modelId &&
        (OFFICE_AGENT_LEGACY_PROVIDER_IDS as readonly string[]).includes(provider),
    ) ??
    null
  );
}

export function isOfficeAgentEnabledModel(provider: string, modelId: string): boolean {
  const model = getOfficeAgentEnabledModel(provider, modelId);
  return Boolean(model && model.provider === provider);
}

export function toOfficeAgentModelSelection(model: OfficeAgentEnabledModel): OfficeAgentModelSelection {
  return {
    catalogId: model.catalogId,
    provider: model.provider,
    modelId: model.modelId,
  };
}

export function resolveOfficeAgentEnabledModelSelection(
  provider: string,
  modelId: string,
): OfficeAgentModelSelection | null {
  const normalized = normalizeOfficeAgentModelSelection({ provider, modelId });
  const model = getOfficeAgentEnabledModel(normalized.provider, normalized.modelId);
  return model ? toOfficeAgentModelSelection(model) : null;
}

export function getDefaultOfficeAgentEnabledModel(
  workflow?: OfficeAgentModelWorkflow,
): OfficeAgentEnabledModel | null {
  if (workflow) {
    return OFFICE_AGENT_ENABLED_MODELS.find((model) => model.enabledFor.includes(workflow)) ?? null;
  }
  return OFFICE_AGENT_ENABLED_MODELS[0] ?? null;
}

export function normalizeOfficeAgentModelSelection<T extends { provider: string; id?: string; modelId?: string }>(
  selection: T,
): T {
  const selectedModelId = selection.modelId ?? selection.id;
  const enabledModel = selectedModelId
    ? getOfficeAgentEnabledModel(selection.provider, selectedModelId)
    : null;
  if (!enabledModel || selection.provider === enabledModel.provider) {
    return selection;
  }

  return {
    ...selection,
    provider: enabledModel.provider,
  };
}

function toOfficeAgentModelPattern(model: OfficeAgentEnabledModel) {
  return `${model.provider}/${model.modelId}`;
}

function toProviderModelDefinition(model: OfficeAgentEnabledModel) {
  return {
    id: model.modelId,
    name: model.label,
    reasoning: model.reasoning,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export interface OfficeAgentManagedSessionPaths {
  readonly sessionDir: string;
  readonly profileDir: string;
  readonly appDataDir: string;
  readonly localAppDataDir: string;
  readonly tempDir: string;
  readonly npmCacheDir: string;
  readonly npmPrefixDir: string;
  readonly pipCacheDir: string;
  readonly pythonUserBaseDir: string;
  readonly uvCacheDir: string;
  readonly uvToolDir: string;
  readonly uvToolBinDir: string;
  readonly uvPythonInstallDir: string;
  readonly uvPythonBinDir: string;
  readonly logsDir: string;
}

export interface OfficeAgentManagedProjectStatePaths {
  readonly projectStateDir: string;
  readonly cacheDir: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly toolsDir: string;
  readonly binDir: string;
  readonly npmCacheDir: string;
  readonly npmPrefixDir: string;
  readonly pipCacheDir: string;
  readonly pythonUserBaseDir: string;
  readonly uvCacheDir: string;
  readonly uvToolDir: string;
  readonly uvToolBinDir: string;
  readonly uvPythonInstallDir: string;
  readonly uvPythonBinDir: string;
}

export const OFFICE_AGENT_MANAGED_SETTINGS = {
  defaultProvider: OFFICE_AGENT_PROVIDER_ID,
  defaultModel: OFFICE_AGENT_MODEL_ID,
  enabledModels: OFFICE_AGENT_ENABLED_MODELS.map(toOfficeAgentModelPattern),
} as const;

const OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const gatewayUrl = process.env.${OFFICE_AGENT_GATEWAY_URL_ENV_NAME} || "${OFFICE_AGENT_DEFAULT_GATEWAY_URL}";
const gatewayToken = process.env.${OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME} || "${OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN}";
const clientKind = process.env.${OFFICE_AGENT_CLIENT_KIND_ENV_NAME} || "unknown";
const windowsUser = process.env.${OFFICE_AGENT_WINDOWS_USER_ENV_NAME} || process.env.USERNAME || process.env.USER || "unknown-user";
const windowsDomain = process.env.${OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME} || process.env.USERDOMAIN || "";
const windowsHost = process.env.${OFFICE_AGENT_WINDOWS_HOST_ENV_NAME} || process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown-host";
const identity = windowsDomain && windowsUser ? windowsDomain + "\\\\" + windowsUser : windowsUser;

export default function (pi: ExtensionAPI) {
  pi.registerProvider("${OFFICE_AGENT_PROVIDER_ID}", {
    baseUrl: gatewayUrl,
    api: "openai-completions",
    apiKey: gatewayToken,
    authHeader: true,
    headers: {
      "X-OfficeAgent-Client": clientKind,
      "X-OfficeAgent-User": windowsUser,
      "X-OfficeAgent-Domain": windowsDomain,
      "X-OfficeAgent-Host": windowsHost,
      "X-OfficeAgent-Identity": identity,
    },
    models: ${JSON.stringify(OFFICE_AGENT_ENABLED_MODELS.map(toProviderModelDefinition), null, 6)},
  });
}
`;

async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === content) return;
  } catch {
    // write below
  }
  await writeFile(filePath, content, "utf8");
}

export function getOfficeAgentAppDataDir(localAppData: string = getLocalAppDataDir()): string {
  return path.join(localAppData, OFFICE_AGENT_APP_NAME);
}

export function getOfficeAgentAgentDir(appDataDir: string = getOfficeAgentAppDataDir()): string {
  return path.join(appDataDir, "pi-agent");
}

export function getOfficeAgentManagedRootDir(appDataDir: string = getOfficeAgentAppDataDir()): string {
  return path.join(appDataDir, "AgentData");
}

export function getOfficeAgentProjectsDir(managedRootDir: string = getOfficeAgentManagedRootDir()): string {
  return path.join(managedRootDir, OFFICE_AGENT_MANAGED_PROJECTS_DIR_NAME);
}

export function getOfficeAgentInternalDir(managedRootDir: string = getOfficeAgentManagedRootDir()): string {
  return path.join(managedRootDir, OFFICE_AGENT_MANAGED_INTERNAL_DIR_NAME);
}

export function getOfficeAgentSessionsDir(managedRootDir: string = getOfficeAgentManagedRootDir()): string {
  return path.join(getOfficeAgentInternalDir(managedRootDir), OFFICE_AGENT_MANAGED_SESSIONS_DIR_NAME);
}

export function getOfficeAgentProjectStateRootDir(managedRootDir: string = getOfficeAgentManagedRootDir()): string {
  return path.join(getOfficeAgentInternalDir(managedRootDir), OFFICE_AGENT_MANAGED_PROJECT_STATE_DIR_NAME);
}

export function getOfficeAgentProjectStateDir(
  projectPath: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentProjectStateRootDir(managedRootDir), encodeOfficeAgentPathSegment(path.resolve(projectPath)));
}

export function getOfficeAgentManagedProjectStatePaths(
  projectPath: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): OfficeAgentManagedProjectStatePaths {
  const projectStateDir = getOfficeAgentProjectStateDir(projectPath, managedRootDir);
  return {
    projectStateDir,
    cacheDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_PROJECT_CACHE_DIR_NAME),
    configDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_PROJECT_CONFIG_DIR_NAME),
    dataDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_PROJECT_DATA_DIR_NAME),
    toolsDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_PROJECT_TOOLS_DIR_NAME),
    binDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_PROJECT_BIN_DIR_NAME),
    npmCacheDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_NPM_CACHE_DIR_NAME),
    npmPrefixDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_NPM_PREFIX_DIR_NAME),
    pipCacheDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_PIP_CACHE_DIR_NAME),
    pythonUserBaseDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_PYTHON_USER_BASE_DIR_NAME),
    uvCacheDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_UV_CACHE_DIR_NAME),
    uvToolDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_DIR_NAME),
    uvToolBinDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_BIN_DIR_NAME),
    uvPythonInstallDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_INSTALL_DIR_NAME),
    uvPythonBinDir: path.join(projectStateDir, OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_BIN_DIR_NAME),
  };
}

export function getOfficeAgentRuntimeDir(managedRootDir: string = getOfficeAgentManagedRootDir()): string {
  return path.join(getOfficeAgentInternalDir(managedRootDir), OFFICE_AGENT_MANAGED_RUNTIME_DIR_NAME);
}

export function getOfficeAgentStagedGitBashDir(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
  version: string = OFFICE_AGENT_STAGED_GIT_BASH_VERSION,
): string {
  return path.join(getOfficeAgentRuntimeDir(managedRootDir), OFFICE_AGENT_STAGED_GIT_BASH_RUNTIME_NAME, version);
}

export function getOfficeAgentStagedBashPath(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
  version: string = OFFICE_AGENT_STAGED_GIT_BASH_VERSION,
): string {
  return path.join(getOfficeAgentStagedGitBashDir(managedRootDir, version), "bin", "bash.exe");
}

export function getOfficeAgentStagedGitBashCandidatePaths(gitBashDir: string): readonly string[] {
  return [
    path.join(gitBashDir, "bin", "bash.exe"),
    path.join(gitBashDir, "usr", "bin", "bash.exe"),
    path.join(gitBashDir, "bash.exe"),
  ];
}

export function getOfficeAgentPythonRuntimeRootDir(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentRuntimeDir(managedRootDir), OFFICE_AGENT_STAGED_PYTHON_RUNTIME_NAME);
}

export function getOfficeAgentPythonRuntimeDir(
  managedRootDir: string,
  runtimeId: string,
): string {
  return path.join(getOfficeAgentPythonRuntimeRootDir(managedRootDir), runtimeId);
}

export function getOfficeAgentPythonRuntimeShimsDir(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentPythonRuntimeRootDir(managedRootDir), "shims");
}

export function getOfficeAgentPythonRuntimeCurrentManifestPath(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentPythonRuntimeRootDir(managedRootDir), "current.json");
}

export function getOfficeAgentUvRuntimeRootDir(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentRuntimeDir(managedRootDir), OFFICE_AGENT_STAGED_UV_RUNTIME_NAME);
}

export function getOfficeAgentUvRuntimeDir(
  managedRootDir: string,
  runtimeId: string,
): string {
  return path.join(getOfficeAgentUvRuntimeRootDir(managedRootDir), runtimeId);
}

export function getOfficeAgentUvRuntimeShimsDir(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentUvRuntimeRootDir(managedRootDir), "shims");
}

export function getOfficeAgentUvRuntimeCurrentManifestPath(
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentUvRuntimeRootDir(managedRootDir), "current.json");
}

export function getOfficeAgentWorkspaceSessionFilesDir(
  workspacePath: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(
    getOfficeAgentSessionsDir(managedRootDir),
    OFFICE_AGENT_MANAGED_SESSION_FILES_DIR_NAME,
    encodeOfficeAgentPathSegment(path.resolve(workspacePath)),
  );
}

export function getOfficeAgentSessionDir(
  sessionId: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): string {
  return path.join(getOfficeAgentSessionsDir(managedRootDir), sessionId);
}

export function getOfficeAgentManagedSessionPaths(
  sessionId: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): OfficeAgentManagedSessionPaths {
  const sessionDir = getOfficeAgentSessionDir(sessionId, managedRootDir);
  const profileDir = path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_PROFILE_DIR_NAME);
  const appDataDir = path.join(profileDir, "AppData", "Roaming");
  const localAppDataDir = path.join(profileDir, "AppData", "Local");
  return {
    sessionDir,
    profileDir,
    appDataDir,
    localAppDataDir,
    tempDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_TEMP_DIR_NAME),
    npmCacheDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_NPM_CACHE_DIR_NAME),
    npmPrefixDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_NPM_PREFIX_DIR_NAME),
    pipCacheDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_PIP_CACHE_DIR_NAME),
    pythonUserBaseDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_PYTHON_USER_BASE_DIR_NAME),
    uvCacheDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_UV_CACHE_DIR_NAME),
    uvToolDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_DIR_NAME),
    uvToolBinDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_UV_TOOL_BIN_DIR_NAME),
    uvPythonInstallDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_INSTALL_DIR_NAME),
    uvPythonBinDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_UV_PYTHON_BIN_DIR_NAME),
    logsDir: path.join(sessionDir, OFFICE_AGENT_MANAGED_SESSION_LOGS_DIR_NAME),
  };
}

export function getOfficeAgentProviderExtensionPath(agentDir: string = getOfficeAgentAgentDir()): string {
  return path.join(agentDir, "extensions", "castrosua-ia-provider.ts");
}

export function getOfficeAgentManagedEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    agentDir?: string;
    gatewayUrl?: string;
    gatewayToken?: string;
    clientKind?: OfficeAgentClientKind;
    windowsUser?: string;
    windowsDomain?: string;
    windowsHost?: string;
  } = {},
): NodeJS.ProcessEnv {
  const agentDir = options.agentDir ?? env.PI_CODING_AGENT_DIR ?? getOfficeAgentAgentDir();
  const gatewayUrl = options.gatewayUrl ?? env[OFFICE_AGENT_GATEWAY_URL_ENV_NAME] ?? OFFICE_AGENT_DEFAULT_GATEWAY_URL;
  const gatewayToken =
    options.gatewayToken ?? env[OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME] ?? OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN;
  const clientKind = options.clientKind ?? normalizeClientKind(env[OFFICE_AGENT_CLIENT_KIND_ENV_NAME]) ?? "unknown";
  const windowsUser =
    options.windowsUser ?? env[OFFICE_AGENT_WINDOWS_USER_ENV_NAME] ?? env.USERNAME ?? env.USER ?? "unknown-user";
  const windowsDomain = options.windowsDomain ?? env[OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME] ?? env.USERDOMAIN ?? "";
  const windowsHost =
    options.windowsHost ?? env[OFFICE_AGENT_WINDOWS_HOST_ENV_NAME] ?? env.COMPUTERNAME ?? env.HOSTNAME ?? "unknown-host";

  return {
    ...env,
    PI_CODING_AGENT_DIR: agentDir,
    [OFFICE_AGENT_GATEWAY_URL_ENV_NAME]: gatewayUrl,
    [OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME]: gatewayToken,
    [OFFICE_AGENT_CLIENT_KIND_ENV_NAME]: clientKind,
    [OFFICE_AGENT_WINDOWS_USER_ENV_NAME]: windowsUser,
    [OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME]: windowsDomain,
    [OFFICE_AGENT_WINDOWS_HOST_ENV_NAME]: windowsHost,
  };
}

export async function ensureOfficeAgentManagedAgentDir(agentDir: string = getOfficeAgentAgentDir()): Promise<string> {
  const extensionsDir = path.join(agentDir, "extensions");
  const settingsPath = path.join(agentDir, "settings.json");
  const extensionPath = path.join(extensionsDir, "castrosua-ia-provider.ts");
  const legacyExtensionPath = path.join(extensionsDir, "corp-provider.ts");

  await mkdir(extensionsDir, { recursive: true });
  await writeFileIfChanged(extensionPath, OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE);
  await rm(legacyExtensionPath, { force: true });
  await writeFileIfChanged(settingsPath, `${JSON.stringify(OFFICE_AGENT_MANAGED_SETTINGS, null, 2)}\n`);

  return agentDir;
}

export async function ensureOfficeAgentManagedRoot(managedRootDir: string = getOfficeAgentManagedRootDir()): Promise<string> {
  await mkdir(getOfficeAgentProjectsDir(managedRootDir), { recursive: true });
  await mkdir(getOfficeAgentInternalDir(managedRootDir), { recursive: true });
  await mkdir(getOfficeAgentSessionsDir(managedRootDir), { recursive: true });
  await mkdir(getOfficeAgentProjectStateRootDir(managedRootDir), { recursive: true });
  await mkdir(getOfficeAgentRuntimeDir(managedRootDir), { recursive: true });
  return managedRootDir;
}

export async function ensureOfficeAgentManagedSessionLayout(
  sessionId: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): Promise<OfficeAgentManagedSessionPaths> {
  await ensureOfficeAgentManagedRoot(managedRootDir);
  const paths = getOfficeAgentManagedSessionPaths(sessionId, managedRootDir);
  await mkdir(paths.sessionDir, { recursive: true });
  await mkdir(paths.profileDir, { recursive: true });
  await mkdir(paths.appDataDir, { recursive: true });
  await mkdir(paths.localAppDataDir, { recursive: true });
  await mkdir(paths.tempDir, { recursive: true });
  await mkdir(paths.npmCacheDir, { recursive: true });
  await mkdir(paths.npmPrefixDir, { recursive: true });
  await mkdir(paths.pipCacheDir, { recursive: true });
  await mkdir(paths.pythonUserBaseDir, { recursive: true });
  await mkdir(paths.uvCacheDir, { recursive: true });
  await mkdir(paths.uvToolDir, { recursive: true });
  await mkdir(paths.uvToolBinDir, { recursive: true });
  await mkdir(paths.uvPythonInstallDir, { recursive: true });
  await mkdir(paths.uvPythonBinDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  return paths;
}

export async function ensureOfficeAgentManagedProjectStateLayout(
  projectPath: string,
  managedRootDir: string = getOfficeAgentManagedRootDir(),
): Promise<OfficeAgentManagedProjectStatePaths> {
  await ensureOfficeAgentManagedRoot(managedRootDir);
  const paths = getOfficeAgentManagedProjectStatePaths(projectPath, managedRootDir);
  await mkdir(paths.projectStateDir, { recursive: true });
  await mkdir(paths.cacheDir, { recursive: true });
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.toolsDir, { recursive: true });
  await mkdir(paths.binDir, { recursive: true });
  await mkdir(paths.npmCacheDir, { recursive: true });
  await mkdir(paths.npmPrefixDir, { recursive: true });
  await mkdir(paths.pipCacheDir, { recursive: true });
  await mkdir(paths.pythonUserBaseDir, { recursive: true });
  await mkdir(paths.uvCacheDir, { recursive: true });
  await mkdir(paths.uvToolDir, { recursive: true });
  await mkdir(paths.uvToolBinDir, { recursive: true });
  await mkdir(paths.uvPythonInstallDir, { recursive: true });
  await mkdir(paths.uvPythonBinDir, { recursive: true });
  return paths;
}

export function getOfficeAgentManagedSessionEnv(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    managedRootDir?: string;
    agentDir?: string;
    gatewayUrl?: string;
    gatewayToken?: string;
    clientKind?: OfficeAgentClientKind;
    windowsUser?: string;
    windowsDomain?: string;
    windowsHost?: string;
    activeProjectDir?: string;
  } = {},
): NodeJS.ProcessEnv {
  const managedEnv = getOfficeAgentManagedEnv(env, options);
  const managedRootDir = options.managedRootDir ?? getOfficeAgentManagedRootDir();
  const paths = getOfficeAgentManagedSessionPaths(sessionId, managedRootDir);
  const projectStatePaths = options.activeProjectDir
    ? getOfficeAgentManagedProjectStatePaths(options.activeProjectDir, managedRootDir)
    : undefined;
  const packageStatePaths = projectStatePaths ?? paths;
  const realUserFolders = getOfficeAgentRealUserFolders(env);
  return {
    ...managedEnv,
    HOME: paths.profileDir,
    USERPROFILE: paths.profileDir,
    APPDATA: paths.appDataDir,
    LOCALAPPDATA: paths.localAppDataDir,
    [OFFICE_AGENT_REAL_USERPROFILE_ENV_NAME]: realUserFolders.userProfile,
    [OFFICE_AGENT_REAL_DESKTOP_ENV_NAME]: realUserFolders.desktop,
    [OFFICE_AGENT_REAL_DOCUMENTS_ENV_NAME]: realUserFolders.documents,
    [OFFICE_AGENT_REAL_DOWNLOADS_ENV_NAME]: realUserFolders.downloads,
    [OFFICE_AGENT_REAL_PICTURES_ENV_NAME]: realUserFolders.pictures,
    [OFFICE_AGENT_REAL_VIDEOS_ENV_NAME]: realUserFolders.videos,
    [OFFICE_AGENT_REAL_MUSIC_ENV_NAME]: realUserFolders.music,
    [OFFICE_AGENT_SANDBOX_PROFILE_ENV_NAME]: paths.profileDir,
    [OFFICE_AGENT_MANAGED_ROOT_ENV_NAME]: managedRootDir,
    ...(options.activeProjectDir ? { [OFFICE_AGENT_ACTIVE_PROJECT_ENV_NAME]: options.activeProjectDir } : {}),
    ...(projectStatePaths
      ? {
          [OFFICE_AGENT_PROJECT_STATE_ENV_NAME]: projectStatePaths.projectStateDir,
          [OFFICE_AGENT_PROJECT_CACHE_ENV_NAME]: projectStatePaths.cacheDir,
          [OFFICE_AGENT_PROJECT_TOOLS_ENV_NAME]: projectStatePaths.toolsDir,
          XDG_CACHE_HOME: projectStatePaths.cacheDir,
          XDG_CONFIG_HOME: projectStatePaths.configDir,
          XDG_DATA_HOME: projectStatePaths.dataDir,
        }
      : {}),
    TEMP: paths.tempDir,
    TMP: paths.tempDir,
    TMPDIR: paths.tempDir,
    npm_config_cache: packageStatePaths.npmCacheDir,
    NPM_CONFIG_CACHE: packageStatePaths.npmCacheDir,
    npm_config_prefix: packageStatePaths.npmPrefixDir,
    NPM_CONFIG_PREFIX: packageStatePaths.npmPrefixDir,
    PIP_CACHE_DIR: packageStatePaths.pipCacheDir,
    PYTHONUSERBASE: packageStatePaths.pythonUserBaseDir,
    UV_CACHE_DIR: packageStatePaths.uvCacheDir,
    UV_TOOL_DIR: packageStatePaths.uvToolDir,
    UV_TOOL_BIN_DIR: packageStatePaths.uvToolBinDir,
    UV_PYTHON_INSTALL_DIR: packageStatePaths.uvPythonInstallDir,
    UV_PYTHON_BIN_DIR: packageStatePaths.uvPythonBinDir,
    UV_PYTHON_NO_REGISTRY: "1",
    UV_PYTHON_DOWNLOADS: "manual",
    UV_LINK_MODE: "copy",
    UV_NO_MODIFY_PATH: "1",
    OFFICE_AGENT_SESSION_DIR: paths.sessionDir,
    OFFICE_AGENT_SESSION_LOGS_DIR: paths.logsDir,
  };
}

export interface OfficeAgentRealUserFolders {
  readonly userProfile: string;
  readonly desktop: string;
  readonly documents: string;
  readonly downloads: string;
  readonly pictures: string;
  readonly videos: string;
  readonly music: string;
}

export function getOfficeAgentRealUserFolders(env: NodeJS.ProcessEnv = process.env): OfficeAgentRealUserFolders {
  const userProfile =
    env[OFFICE_AGENT_REAL_USERPROFILE_ENV_NAME]
    ?? env.USERPROFILE
    ?? (env.HOMEDRIVE && env.HOMEPATH ? path.join(env.HOMEDRIVE, env.HOMEPATH) : undefined)
    ?? os.homedir();

  return {
    userProfile,
    desktop: env[OFFICE_AGENT_REAL_DESKTOP_ENV_NAME] ?? path.join(userProfile, "Desktop"),
    documents: env[OFFICE_AGENT_REAL_DOCUMENTS_ENV_NAME] ?? path.join(userProfile, "Documents"),
    downloads: env[OFFICE_AGENT_REAL_DOWNLOADS_ENV_NAME] ?? path.join(userProfile, "Downloads"),
    pictures: env[OFFICE_AGENT_REAL_PICTURES_ENV_NAME] ?? path.join(userProfile, "Pictures"),
    videos: env[OFFICE_AGENT_REAL_VIDEOS_ENV_NAME] ?? path.join(userProfile, "Videos"),
    music: env[OFFICE_AGENT_REAL_MUSIC_ENV_NAME] ?? path.join(userProfile, "Music"),
  };
}

export function findOfficeAgentManagedRootForPath(pathValue: string): string | undefined {
  let current = path.resolve(pathValue);

  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    if (path.basename(parent) === OFFICE_AGENT_MANAGED_PROJECTS_DIR_NAME) {
      return path.dirname(parent);
    }
    current = parent;
  }
}

export async function getAvailableOfficeAgentProjectName(
  managedRootDir: string,
  projectName: string,
): Promise<string> {
  const normalizedName = normalizeOfficeAgentProjectName(projectName);
  if (!normalizedName) {
    throw new Error("Project name cannot be empty.");
  }

  await ensureOfficeAgentManagedRoot(managedRootDir);
  let candidate = normalizedName;
  let suffix = 2;

  while (await officeAgentPathExists(path.join(getOfficeAgentProjectsDir(managedRootDir), candidate))) {
    candidate = `${normalizedName}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export async function createOfficeAgentProject(
  managedRootDir: string,
  projectName: string,
  options: { readonly onExists?: "error" | "suffix" } = {},
): Promise<{ readonly projectName: string; readonly projectPath: string }> {
  const normalizedName =
    options.onExists === "suffix"
      ? await getAvailableOfficeAgentProjectName(managedRootDir, projectName)
      : normalizeOfficeAgentProjectName(projectName);
  if (!normalizedName) {
    throw new Error("Project name cannot be empty.");
  }

  await ensureOfficeAgentManagedRoot(managedRootDir);
  const projectPath = path.join(getOfficeAgentProjectsDir(managedRootDir), normalizedName);

  try {
    const existing = await stat(projectPath);
    if (existing.isDirectory()) {
      throw new Error(`Project already exists: ${normalizedName}`);
    }
    throw new Error(`A file already exists at ${projectPath}`);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  await mkdir(projectPath, { recursive: false });
  return {
    projectName: normalizedName,
    projectPath,
  };
}

export function normalizeOfficeAgentProjectName(projectName: string): string {
  return projectName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ");
}

export function getOfficeAgentProviderExtensionSource(): string {
  return OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE;
}

function encodeOfficeAgentPathSegment(value: string): string {
  return encodeURIComponent(value.replace(/\\/g, "/"));
}

function getLocalAppDataDir(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}


async function officeAgentPathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function normalizeClientKind(value: string | undefined): OfficeAgentClientKind | undefined {
  if (value === "gui" || value === "tui" || value === "unknown") {
    return value;
  }
  return undefined;
}
