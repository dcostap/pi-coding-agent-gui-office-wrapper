import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..", "..");
const rawArgs = process.argv.slice(2);
const extraArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const workspacePackages = ["@office-agent/runtime", "@pi-gui/session-driver", "@pi-gui/pi-sdk-driver", "@pi-gui/catalogs"];

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function spawnInherited(cmd, args, cwd) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", cmd, ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
  }

  return spawn(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
}

async function run(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawnInherited(cmd, args, cwd);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${cmd} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function start(cmd, args, cwd) {
  return spawnInherited(cmd, args, cwd);
}

async function main() {
  for (const workspaceName of workspacePackages) {
    await run(npmCmd, ["run", "build", "--workspace", workspaceName], repoRoot);
  }

  const children = [
    start(npxCmd, ["electron-vite", "dev", "--watch", ...extraArgs], desktopDir),
  ];

  let exiting = false;
  const stopChildren = () => {
    if (exiting) {
      return;
    }
    exiting = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  for (const child of children) {
    child.once("exit", (code, signal) => {
      stopChildren();
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    child.once("error", (error) => {
      console.error(error);
      stopChildren();
      process.exitCode = 1;
    });
  }

  process.once("SIGINT", () => {
    stopChildren();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stopChildren();
    process.exit(143);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
