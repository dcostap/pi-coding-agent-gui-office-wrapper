import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OFFICE_AGENT_APP_NAME = "OfficeAgent";
export const OFFICE_AGENT_PROVIDER_ID = "corp";
export const OFFICE_AGENT_MODEL_ID = "assistant";
export const OFFICE_AGENT_GATEWAY_URL_ENV_NAME = "OFFICE_AGENT_GATEWAY_URL";
export const OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME = "OFFICE_AGENT_GATEWAY_TOKEN";
export const OFFICE_AGENT_DEFAULT_GATEWAY_URL = "http://127.0.0.1:8082/v1";
export const OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN = "dev-gateway-token";

export const OFFICE_AGENT_MANAGED_SETTINGS = {
  defaultProvider: OFFICE_AGENT_PROVIDER_ID,
  defaultModel: OFFICE_AGENT_MODEL_ID,
  enabledModels: [`${OFFICE_AGENT_PROVIDER_ID}/${OFFICE_AGENT_MODEL_ID}`],
} as const;

const OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE = `import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const gatewayUrl = process.env.${OFFICE_AGENT_GATEWAY_URL_ENV_NAME} || "${OFFICE_AGENT_DEFAULT_GATEWAY_URL}";
const gatewayToken = process.env.${OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME} || "${OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN}";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("${OFFICE_AGENT_PROVIDER_ID}", {
    baseUrl: gatewayUrl,
    api: "openai-completions",
    apiKey: gatewayToken,
    authHeader: true,
    models: [
      {
        id: "${OFFICE_AGENT_MODEL_ID}",
        name: "Assistant",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
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

export function getOfficeAgentProviderExtensionPath(agentDir: string = getOfficeAgentAgentDir()): string {
  return path.join(agentDir, "extensions", "corp-provider.ts");
}

export function getOfficeAgentManagedEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    agentDir?: string;
    gatewayUrl?: string;
    gatewayToken?: string;
  } = {},
): NodeJS.ProcessEnv {
  const agentDir = options.agentDir ?? env.PI_CODING_AGENT_DIR ?? getOfficeAgentAgentDir();
  const gatewayUrl = options.gatewayUrl ?? env[OFFICE_AGENT_GATEWAY_URL_ENV_NAME] ?? OFFICE_AGENT_DEFAULT_GATEWAY_URL;
  const gatewayToken =
    options.gatewayToken ?? env[OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME] ?? OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN;

  return {
    ...env,
    PI_CODING_AGENT_DIR: agentDir,
    [OFFICE_AGENT_GATEWAY_URL_ENV_NAME]: gatewayUrl,
    [OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME]: gatewayToken,
  };
}

export async function ensureOfficeAgentManagedAgentDir(agentDir: string = getOfficeAgentAgentDir()): Promise<string> {
  const extensionsDir = path.join(agentDir, "extensions");
  const settingsPath = path.join(agentDir, "settings.json");
  const extensionPath = path.join(extensionsDir, "corp-provider.ts");

  await mkdir(extensionsDir, { recursive: true });
  await writeFileIfChanged(extensionPath, OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE);
  await writeFileIfChanged(settingsPath, `${JSON.stringify(OFFICE_AGENT_MANAGED_SETTINGS, null, 2)}\n`);

  return agentDir;
}

export function getOfficeAgentProviderExtensionSource(): string {
  return OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE;
}

function getLocalAppDataDir(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}
