import type {
  AgentSession,
  AgentSessionServices,
  AuthStorage,
  ModelRegistry,
  ResourceLoader,
  SessionShutdownEvent,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export function createServicesFromLoadedResourceLoader(options: {
  cwd: string;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  resourceLoader: ResourceLoader;
}): AgentSessionServices {
  const diagnostics: AgentSessionServices["diagnostics"] = [];
  const extensionsResult = options.resourceLoader.getExtensions();
  for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
    try {
      options.modelRegistry.registerProvider(name, config);
    } catch (error) {
      const message = `Provider registration failed: ${error instanceof Error ? error.message : String(error)}`;
      diagnostics.push({
        type: "error",
        message: `Extension "${extensionPath}" error: ${message}`,
      });
      extensionsResult.errors.push({
        path: extensionPath,
        error: message,
      });
    }
  }
  extensionsResult.runtime.pendingProviderRegistrations = [];
  return { ...options, diagnostics };
}

export async function disposeAgentSessionGracefully(
  session: AgentSession,
  reason: SessionShutdownEvent["reason"] = "quit",
): Promise<void> {
  try {
    if (session.extensionRunner.hasHandlers("session_shutdown")) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason });
    }
  } finally {
    session.dispose();
  }
}
