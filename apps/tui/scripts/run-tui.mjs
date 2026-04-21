import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ensureOfficeAgentManagedAgentDir,
  getOfficeAgentAgentDir,
  getOfficeAgentManagedEnv,
} from "@office-agent/runtime";

const piMainUrl = await import.meta.resolve("@mariozechner/pi-coding-agent");
const piMainPath = fileURLToPath(piMainUrl);
const piPackageRoot = path.resolve(path.dirname(piMainPath), "..");
const cliPath = path.join(piPackageRoot, "dist", "cli.js");

const env = getOfficeAgentManagedEnv();
const agentDir = env.PI_CODING_AGENT_DIR || getOfficeAgentAgentDir();
await ensureOfficeAgentManagedAgentDir(agentDir);

const args = [cliPath, ...process.argv.slice(2)];

console.log(`[office-agent:tui] using pinned Pi at ${cliPath}`);
console.log(`[office-agent:tui] PI_CODING_AGENT_DIR=${agentDir}`);
console.log(`[office-agent:tui] gateway=${env.OFFICE_AGENT_GATEWAY_URL}`);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  cwd: process.cwd(),
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
