import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(__dirname, "..");
const piMainUrl = await import.meta.resolve("@mariozechner/pi-coding-agent");
const piMainPath = fileURLToPath(piMainUrl);
const piPackageRoot = path.resolve(path.dirname(piMainPath), "..");
const cliPath = path.join(piPackageRoot, "dist", "cli.js");
const extensionPath = path.join(runtimeRoot, "extensions", "corp-provider.ts");

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const agentDir = path.join(localAppData, "OfficeAgent", "pi-agent-dev");

await mkdir(agentDir, { recursive: true });

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || agentDir,
  OFFICE_AGENT_GATEWAY_URL: process.env.OFFICE_AGENT_GATEWAY_URL || "http://127.0.0.1:8080/v1",
  OFFICE_AGENT_GATEWAY_TOKEN: process.env.OFFICE_AGENT_GATEWAY_TOKEN || "dev-gateway-token",
};

const extraArgs = process.argv.slice(2);
const args = [
  cliPath,
  "--extension",
  extensionPath,
  "--provider",
  "corp",
  "--model",
  "assistant",
  ...extraArgs,
];

console.log(`[office-agent] using pinned local Pi at ${cliPath}`);
console.log(`[office-agent] PI_CODING_AGENT_DIR=${env.PI_CODING_AGENT_DIR}`);
console.log(`[office-agent] gateway=${env.OFFICE_AGENT_GATEWAY_URL}`);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  cwd: process.cwd(),
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
