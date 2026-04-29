import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..", "..");

if (process.platform !== "win32") {
  console.log("Skipping OfficeAgent Windows sandbox workflow smoke outside Windows.");
  process.exit(0);
}

const keepSmokeDir = process.env.OFFICE_AGENT_KEEP_SANDBOX_SMOKE_DIR === "1";
const strict = process.env.OFFICE_AGENT_SANDBOX_WORKFLOW_SMOKE_STRICT === "1";
let managedRoot;

try {
  await run("npm", ["run", "build", "--workspace", "@office-agent/runtime"]);
  await run("npm", ["run", "build", "--workspace", "@pi-gui/pi-sdk-driver"]);
  await run("npm", ["run", "build:sandbox-helper", "--workspace", "@office-agent/gui"]);

  const runtime = await import(pathToFileURL(path.join(repoRoot, "packages", "office-agent-runtime", "dist", "index.js")));
  const driver = await import(pathToFileURL(path.join(repoRoot, "packages", "pi-sdk-driver", "dist", "windows-sandbox-helper-client.js")));

  managedRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-sandbox-workflow-root-")));
  const projectDir = path.join(managedRoot, "projects", "demo");
  await mkdir(projectDir, { recursive: true });

  const sessionId = `workflow-${Date.now()}`;
  const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRoot);
  const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, { managedRootDir: managedRoot });
  const shell = await driver.ensureOfficeAgentSandboxShellConfig(managedRoot);
  const bash = driver.createOfficeAgentSandboxBashOperations({ managedRootDir: managedRoot, sessionPaths, env });

  const commands = shell.backend === "cmd" ? cmdWorkflowCommands() : bashWorkflowCommands();
  const results = [];
  for (const check of commands) {
    const result = await runSandboxCommand(bash, check.command, projectDir, env, check.timeout ?? 30);
    results.push({
      name: check.name,
      command: check.command,
      required: check.required,
      ok: check.accept(result),
      exitCode: result.exitCode,
      output: trimOutput(result.output),
    });
  }

  const failedRequired = results.filter((result) => result.required && !result.ok);
  const report = {
    ok: failedRequired.length === 0,
    strict,
    managedRoot,
    projectDir,
    shell,
    note: "This workflow smoke is diagnostic by default. Set OFFICE_AGENT_SANDBOX_WORKFLOW_SMOKE_STRICT=1 to fail on required workflow checks.",
    results,
  };
  console.log(JSON.stringify(report, null, 2));

  if (strict && failedRequired.length > 0) {
    throw new Error(`Required sandbox workflow checks failed: ${failedRequired.map((result) => result.name).join(", ")}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (managedRoot) console.error(`Managed root kept for debugging: ${managedRoot}`);
  process.exitCode = 1;
} finally {
  if (!keepSmokeDir && process.exitCode !== 1) {
    await (managedRoot ? rm(managedRoot, { recursive: true, force: true }) : Promise.resolve());
  }
}

function cmdWorkflowCommands() {
  return [
    {
      name: "node-version",
      command: "node --version",
      required: false,
      accept: success,
    },
    {
      name: "npm-version",
      command: "npm --version",
      required: false,
      accept: success,
    },
    {
      name: "npm-cache-prefix",
      command: "npm config get cache && npm config get prefix",
      required: false,
      accept: success,
    },
    {
      name: "python-version",
      command: "python --version",
      required: false,
      accept: success,
    },
    {
      name: "python-venv",
      command: "python -m venv .venv && .venv\\Scripts\\python.exe -m pip --version",
      timeout: 90,
      required: false,
      accept: success,
    },
    {
      name: "git-version",
      command: "git --version",
      required: false,
      accept: success,
    },
    {
      name: "git-init-status",
      command: "git init && git config user.email officeagent@example.invalid && git config user.name OfficeAgent && git status --short",
      timeout: 60,
      required: false,
      accept: success,
    },
  ];
}

function bashWorkflowCommands() {
  return [
    {
      name: "node-version",
      command: "node --version",
      required: false,
      accept: success,
    },
    {
      name: "npm-version",
      command: "npm --version",
      required: false,
      accept: success,
    },
    {
      name: "npm-cache-prefix",
      command: "npm config get cache && npm config get prefix",
      required: false,
      accept: success,
    },
    {
      name: "python-version",
      command: "python --version",
      required: false,
      accept: success,
    },
    {
      name: "python-venv",
      command: "python -m venv .venv && .venv/Scripts/python.exe -m pip --version",
      timeout: 90,
      required: false,
      accept: success,
    },
    {
      name: "git-version",
      command: "git --version",
      required: false,
      accept: success,
    },
    {
      name: "git-init-status",
      command: "git init && git config user.email officeagent@example.invalid && git config user.name OfficeAgent && git status --short",
      timeout: 60,
      required: false,
      accept: success,
    },
  ];
}

function success(result) {
  return result.exitCode === 0;
}

async function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const childCommand = process.platform === "win32" ? "cmd.exe" : command;
  const childArgs = process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const { stdout, stderr } = await execFileAsync(childCommand, childArgs, {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

async function runSandboxCommand(bash, command, cwd, env, timeout) {
  let output = Buffer.alloc(0);
  const result = await bash.exec(command, cwd, {
    onData(data) {
      output = Buffer.concat([output, data]);
    },
    env,
    timeout,
  });
  return {
    exitCode: result.exitCode,
    output: output.toString("utf8"),
  };
}

function trimOutput(output) {
  const trimmed = output.trim();
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...[truncated]` : trimmed;
}
