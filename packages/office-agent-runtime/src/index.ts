import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OFFICE_AGENT_APP_NAME = "OfficeAgent";
export const OFFICE_AGENT_PROVIDER_ID = "corp";
export const OFFICE_AGENT_MODEL_ID = "assistant";
export const OFFICE_AGENT_GATEWAY_URL_ENV_NAME = "OFFICE_AGENT_GATEWAY_URL";
export const OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME = "OFFICE_AGENT_GATEWAY_TOKEN";
export const OFFICE_AGENT_CLIENT_KIND_ENV_NAME = "OFFICE_AGENT_CLIENT_KIND";
export const OFFICE_AGENT_WINDOWS_USER_ENV_NAME = "OFFICE_AGENT_WINDOWS_USER";
export const OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME = "OFFICE_AGENT_WINDOWS_DOMAIN";
export const OFFICE_AGENT_WINDOWS_HOST_ENV_NAME = "OFFICE_AGENT_WINDOWS_HOST";
export const OFFICE_AGENT_DEFAULT_GATEWAY_URL = "http://10.0.7.234:8082/v1";
export const OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN = "officeagent-demo-2026";

export type OfficeAgentClientKind = "gui" | "tui" | "unknown";

export const OFFICE_AGENT_MANAGED_SETTINGS = {
  defaultProvider: OFFICE_AGENT_PROVIDER_ID,
  defaultModel: OFFICE_AGENT_MODEL_ID,
  enabledModels: [`${OFFICE_AGENT_PROVIDER_ID}/${OFFICE_AGENT_MODEL_ID}`],
} as const;

const OFFICE_AGENT_PROVIDER_EXTENSION_SOURCE = `import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

function normalizeClientKind(value: string | undefined): OfficeAgentClientKind | undefined {
  if (value === "gui" || value === "tui" || value === "unknown") {
    return value;
  }
  return undefined;
}
