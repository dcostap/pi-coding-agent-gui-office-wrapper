import { join } from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type AgentSessionServices,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type CreateAgentSessionRuntimeResult,
  type CreateAgentSessionServicesOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

export type CreateAgentSessionWithNpmFallbackOptions = CreateAgentSessionOptions & {
  resourceLoaderOptions?: CreateAgentSessionServicesOptions["resourceLoaderOptions"];
};

export interface CreateAgentSessionRuntimePreparationOptions {
  readonly cwd: string;
  readonly agentDir: string;
  readonly sessionManager: SessionManager;
  readonly sessionStartEvent?: CreateAgentSessionOptions["sessionStartEvent"];
  readonly baseOptions: CreateAgentSessionWithNpmFallbackOptions;
}

export type PreparedAgentSessionRuntimeOptions = CreateAgentSessionWithNpmFallbackOptions & {
  processEnv?: NodeJS.ProcessEnv;
};

export type CreateAgentSessionRuntimeWithNpmFallbackOptions = CreateAgentSessionWithNpmFallbackOptions & {
  prepareRuntimeOptions?: (
    options: CreateAgentSessionRuntimePreparationOptions,
  ) => PreparedAgentSessionRuntimeOptions | Promise<PreparedAgentSessionRuntimeOptions>;
};

export function isGlobalNpmLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("npm root -g");
}

export function createSettingsManagerWithoutNpmPackages(current: SettingsManager): SettingsManager | null {
  const globalSettings = current.getGlobalSettings() as Record<string, unknown>;
  const projectSettings = current.getProjectSettings() as Record<string, unknown>;
  const nextGlobalPackages = filterOutNpmPackageSources(globalSettings.packages);
  const nextProjectPackages = filterOutNpmPackageSources(projectSettings.packages);

  const globalChanged = nextGlobalPackages !== globalSettings.packages;
  const projectChanged = nextProjectPackages !== projectSettings.packages;
  if (!globalChanged && !projectChanged) {
    return null;
  }

  const nextGlobalSettings = globalChanged ? { ...globalSettings, packages: nextGlobalPackages } : globalSettings;
  const nextProjectSettings = projectChanged ? { ...projectSettings, packages: nextProjectPackages } : projectSettings;
  return SettingsManager.fromStorage({
    withLock(scope, fn) {
      const currentJson =
        scope === "global"
          ? JSON.stringify(nextGlobalSettings)
          : JSON.stringify(nextProjectSettings);
      fn(currentJson);
    },
  });
}

export async function createAgentSessionWithNpmFallback(
  options: CreateAgentSessionWithNpmFallbackOptions = {},
): Promise<CreateAgentSessionResult> {
  const cwd = resolveSessionCwd(options);
  const agentDir = options.agentDir ?? getAgentDir();
  const sessionManager = options.sessionManager ?? SessionManager.create(cwd);
  const services = await createAgentSessionServicesWithNpmFallback(options, cwd, agentDir);

  return createAgentSessionFromServices({
    services,
    sessionManager,
    ...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    ...(options.scopedModels ? { scopedModels: options.scopedModels } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.noTools ? { noTools: options.noTools } : {}),
    ...(options.customTools ? { customTools: options.customTools } : {}),
  });
}

export async function createAgentSessionRuntimeWithNpmFallback(
  options: CreateAgentSessionRuntimeWithNpmFallbackOptions = {},
) {
  const cwd = resolveSessionCwd(options);
  const agentDir = options.agentDir ?? getAgentDir();
  const sessionManager = options.sessionManager ?? SessionManager.create(cwd);
  const { prepareRuntimeOptions: _prepareRuntimeOptions, processEnv: _ignoredProcessEnv, ...baseOptions } =
    options as CreateAgentSessionRuntimeWithNpmFallbackOptions & { processEnv?: NodeJS.ProcessEnv };

  const createRuntime = async (runtimeOptions: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: CreateAgentSessionOptions["sessionStartEvent"];
  }): Promise<CreateAgentSessionRuntimeResult> => {
    const hasExistingEntries = runtimeOptions.sessionManager.getEntries().length > 0;
    const defaultRuntimeOptions: CreateAgentSessionWithNpmFallbackOptions = {
      ...baseOptions,
      cwd: runtimeOptions.cwd,
      agentDir: runtimeOptions.agentDir,
      sessionManager: runtimeOptions.sessionManager,
      ...(runtimeOptions.sessionStartEvent ? { sessionStartEvent: runtimeOptions.sessionStartEvent } : {}),
    };
    const preparedOptions: PreparedAgentSessionRuntimeOptions = options.prepareRuntimeOptions
      ? await options.prepareRuntimeOptions({
          ...runtimeOptions,
          baseOptions: defaultRuntimeOptions,
        })
      : defaultRuntimeOptions;
    const { processEnv, ...sessionOptions } = preparedOptions;

    return withScopedProcessEnv(processEnv, async () => {
      const services = await createAgentSessionServicesWithNpmFallback(
        sessionOptions,
        runtimeOptions.cwd,
        runtimeOptions.agentDir,
      );
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: runtimeOptions.sessionManager,
        ...(runtimeOptions.sessionStartEvent ? { sessionStartEvent: runtimeOptions.sessionStartEvent } : {}),
        ...(!hasExistingEntries && sessionOptions.model ? { model: sessionOptions.model } : {}),
        ...(!hasExistingEntries && sessionOptions.thinkingLevel ? { thinkingLevel: sessionOptions.thinkingLevel } : {}),
        ...(sessionOptions.scopedModels ? { scopedModels: sessionOptions.scopedModels } : {}),
        ...(sessionOptions.tools ? { tools: sessionOptions.tools } : {}),
        ...(sessionOptions.noTools ? { noTools: sessionOptions.noTools } : {}),
        ...(sessionOptions.customTools ? { customTools: sessionOptions.customTools } : {}),
      });
      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      };
    });
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
    ...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
  });

  return {
    session: runtime.session,
    extensionsResult: runtime.session.resourceLoader.getExtensions(),
    ...(runtime.modelFallbackMessage ? { modelFallbackMessage: runtime.modelFallbackMessage } : {}),
    runtime,
  };
}

async function createAgentSessionServicesWithNpmFallback(
  options: CreateAgentSessionWithNpmFallbackOptions,
  cwd: string,
  agentDir: string,
): Promise<AgentSessionServices> {
  try {
    return await createAgentSessionServicesFromOptions(options, cwd, agentDir);
  } catch (error) {
    if (!isGlobalNpmLookupError(error)) {
      throw error;
    }

    const currentSettingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const fallbackSettingsManager = createSettingsManagerWithoutNpmPackages(currentSettingsManager);
    if (!fallbackSettingsManager) {
      throw error;
    }

    console.warn(
      `[pi-gui] Falling back to session resource loading without npm package sources for ${cwd}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    const { resourceLoader: _ignoredResourceLoader, ...fallbackOptions } = options;
    return createAgentSessionServicesFromOptions(
      {
        ...fallbackOptions,
        settingsManager: fallbackSettingsManager,
      },
      cwd,
      agentDir,
    );
  }
}

async function createAgentSessionServicesFromOptions(
  options: CreateAgentSessionWithNpmFallbackOptions,
  cwd: string,
  agentDir: string,
): Promise<AgentSessionServices> {
  if (options.resourceLoader) {
    const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
    const authStorage = options.authStorage ?? options.modelRegistry?.authStorage ?? AuthStorage.create(join(agentDir, "auth.json"));
    const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
    const diagnostics = applyPendingProviderRegistrations(options.resourceLoader, modelRegistry);
    return {
      cwd,
      agentDir,
      authStorage,
      settingsManager,
      modelRegistry,
      resourceLoader: options.resourceLoader,
      diagnostics,
    };
  }

  return createAgentSessionServices({
    cwd,
    agentDir,
    ...(options.authStorage ? { authStorage: options.authStorage } : {}),
    ...(options.settingsManager ? { settingsManager: options.settingsManager } : {}),
    ...(options.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
    ...(options.resourceLoaderOptions ? { resourceLoaderOptions: options.resourceLoaderOptions } : {}),
  });
}

function applyPendingProviderRegistrations(
  resourceLoader: ResourceLoader,
  modelRegistry: ModelRegistry,
): AgentSessionServices["diagnostics"] {
  const diagnostics: AgentSessionServices["diagnostics"] = [];
  const extensionsResult = resourceLoader.getExtensions();
  for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
    try {
      modelRegistry.registerProvider(name, config);
    } catch (error) {
      diagnostics.push({
        type: "error",
        message: `Extension "${extensionPath}" error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  extensionsResult.runtime.pendingProviderRegistrations = [];
  return diagnostics;
}

function resolveSessionCwd(options: CreateAgentSessionOptions): string {
  return options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd();
}

function filterOutNpmPackageSources(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const filtered = value.filter((entry) => !isNpmPackageSource(entry));
  return filtered.length === value.length ? value : filtered;
}

function isNpmPackageSource(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().startsWith("npm:");
  }

  if (typeof value !== "object" || value === null || !("source" in value)) {
    return false;
  }

  return typeof value.source === "string" && value.source.trim().startsWith("npm:");
}

async function withScopedProcessEnv<T>(env: NodeJS.ProcessEnv | undefined, fn: () => Promise<T>): Promise<T> {
  if (!env) {
    return fn();
  }

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
