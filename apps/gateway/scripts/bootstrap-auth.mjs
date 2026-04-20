import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const defaultSource = path.join(os.homedir(), ".pi", "agent", "auth.json");
const defaultDest = path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");

const sourcePath = process.env.SOURCE_AUTH_PATH || defaultSource;
const destPath = process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || defaultDest;
const providers = (process.env.BOOTSTRAP_PROVIDERS || "openai-codex")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error && typeof error === "object" && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

const source = await readJson(sourcePath);
const dest = await readJson(destPath, {});

const copied = [];
for (const provider of providers) {
  if (!source[provider]) {
    console.warn(`[bootstrap-auth] provider not found in source auth: ${provider}`);
    continue;
  }
  dest[provider] = source[provider];
  copied.push(provider);
}

if (copied.length === 0) {
  console.error("[bootstrap-auth] nothing copied");
  process.exit(1);
}

await mkdir(path.dirname(destPath), { recursive: true });
await writeFile(destPath, JSON.stringify(dest, null, 2), "utf8");

console.log(`[bootstrap-auth] source: ${sourcePath}`);
console.log(`[bootstrap-auth] dest:   ${destPath}`);
console.log(`[bootstrap-auth] copied providers: ${copied.join(", ")}`);
