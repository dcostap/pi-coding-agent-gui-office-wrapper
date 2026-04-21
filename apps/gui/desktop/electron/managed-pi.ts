import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MANAGED_SETTINGS = {
  defaultProvider: "corp",
  defaultModel: "assistant",
  enabledModels: ["corp/assistant"],
};

async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === content) return;
  } catch {
    // write below
  }
  await writeFile(filePath, content, "utf8");
}

export async function ensureManagedPiAgentDir(userDataDir: string): Promise<string> {
  const agentDir = path.join(userDataDir, "pi-agent");
  const extensionsDir = path.join(agentDir, "extensions");
  const sourceExtensionPath = path.join(__dirname, "..", "..", "resources", "managed", "corp-provider.ts");
  const targetExtensionPath = path.join(extensionsDir, "corp-provider.ts");
  const settingsPath = path.join(agentDir, "settings.json");

  await mkdir(extensionsDir, { recursive: true });

  const extensionContent = await readFile(sourceExtensionPath, "utf8");
  await writeFileIfChanged(targetExtensionPath, extensionContent);
  await writeFileIfChanged(settingsPath, `${JSON.stringify(MANAGED_SETTINGS, null, 2)}\n`);

  return agentDir;
}
