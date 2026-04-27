import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..", "..");

if (process.platform !== "win32") {
  console.log("Skipping OfficeAgent Windows sandbox smoke test outside Windows.");
  process.exit(0);
}

const keepSmokeDir = process.env.OFFICE_AGENT_KEEP_SANDBOX_SMOKE_DIR === "1";
let managedRoot;
let outsideRoot;

try {
  await run(npmCommand(), ["run", "build", "--workspace", "@office-agent/runtime"]);
  await run(npmCommand(), ["run", "build", "--workspace", "@pi-gui/pi-sdk-driver"]);
  await run(npmCommand(), ["run", "build:sandbox-helper", "--workspace", "@office-agent/gui"]);

  const runtime = await import(pathToFileURL(path.join(repoRoot, "packages", "office-agent-runtime", "dist", "index.js")));
  const driver = await import(pathToFileURL(path.join(repoRoot, "packages", "pi-sdk-driver", "dist", "windows-sandbox-helper-client.js")));

  managedRoot = await mkdtemp(path.join(os.tmpdir(), "officeagent-sandbox-smoke-root-"));
  outsideRoot = await mkdtemp(path.join(os.tmpdir(), "officeagent-sandbox-smoke-outside-"));
  const projectDir = path.join(managedRoot, "projects", "demo");
  await mkdir(projectDir, { recursive: true });

  const sessionId = `smoke-${Date.now()}`;
  const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRoot);
  const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, { managedRootDir: managedRoot });
  const shellConfig = await driver.ensureOfficeAgentSandboxShellConfig(managedRoot);
  const commandSet = shellConfig.kind === "cmd-fallback"
    ? createCmdSmokeCommands(outsideRoot)
    : createBashSmokeCommands(outsideRoot);
  const bash = driver.createOfficeAgentSandboxBashOperations({
    managedRootDir: managedRoot,
    sessionPaths,
    env,
  });

  const selfTest = await driver.invokeWindowsSandboxHelper({ kind: "selfTest", requestId: "sandbox-smoke-self-test" });
  assert(selfTest.ok, `helper selfTest failed: ${JSON.stringify(selfTest)}`);

  const inside = await runSandboxCommand(bash, commandSet.inside, projectDir, env, 20);
  assert(inside.exitCode === 0, `inside command failed: ${JSON.stringify(inside)}`);
  assert(inside.output.includes("sandbox-ok"), `inside command did not produce expected output: ${inside.output}`);
  assert(inside.output.toLowerCase().includes(managedRoot.toLowerCase()), `TEMP was not redirected inside the managed root. output=${inside.output}`);
  await access(path.join(projectDir, "inside.txt"));

  const outsideWriteTarget = path.join(outsideRoot, "blocked-write.txt");
  const outsideWrite = await runSandboxCommand(bash, commandSet.outsideWrite(outsideWriteTarget), projectDir, env, 20);
  const wroteOutside = await exists(outsideWriteTarget);
  assert(!wroteOutside, `sandbox command unexpectedly wrote outside managed root: ${outsideWriteTarget}; result=${JSON.stringify(outsideWrite)}`);

  const envLeak = await runSandboxCommand(bash, commandSet.envLeak, projectDir, env, 20);
  assert(!envLeak.output.includes("officeagent-demo-2026"), `sandbox command leaked OfficeAgent gateway token: ${envLeak.output}`);

  const outsideSecret = path.join(outsideRoot, "secret.txt");
  await writeFile(outsideSecret, "outside-secret", "utf8");
  const outsideRead = await runSandboxCommand(bash, commandSet.outsideRead(outsideSecret), projectDir, env, 20);
  assert(!outsideRead.output.includes("outside-secret"), `sandbox command unexpectedly read outside managed root: ${outsideRead.output}`);

  const timeout = await runSandboxCommand(bash, commandSet.timeout, projectDir, env, 1);
  assert(timeout.exitCode === 124, `timeout command should return 124, got ${JSON.stringify(timeout)}`);

  console.log(JSON.stringify({
    ok: true,
    managedRoot,
    projectDir,
    shell: shellConfig,
    checks: {
      helperSelfTest: true,
      insideWriteAndOutput: true,
      tempRedirectedInsideManagedRoot: true,
      outsideWriteBlocked: true,
      gatewayTokenNotInSandboxEnv: true,
      outsideReadBlocked: true,
      timeoutKilled: true,
    },
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (managedRoot) console.error(`Managed root kept for debugging: ${managedRoot}`);
  if (outsideRoot) console.error(`Outside root kept for debugging: ${outsideRoot}`);
  process.exitCode = 1;
} finally {
  if (!keepSmokeDir && process.exitCode !== 1) {
    await Promise.all([
      managedRoot ? rm(managedRoot, { recursive: true, force: true }) : Promise.resolve(),
      outsideRoot ? rm(outsideRoot, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
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

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createCmdSmokeCommands() {
  return {
    inside: "cd && echo sandbox-ok> inside.txt && type inside.txt && echo TEMP=%TEMP%",
    outsideWrite: (target) => `echo should-not-exist> "${target}"`,
    outsideRead: (target) => `type "${target}"`,
    envLeak: "set OFFICE_AGENT_GATEWAY_TOKEN",
    timeout: "for /l %i in (1,1,1000000000) do @rem",
  };
}

function createBashSmokeCommands() {
  return {
    inside: "pwd && echo sandbox-ok > inside.txt && cat inside.txt && echo TEMP=$TEMP && bash --version | head -n 1",
    outsideWrite: (target) => `echo should-not-exist > "${toMsysPath(target)}"`,
    outsideRead: (target) => `cat "${toMsysPath(target)}"`,
    envLeak: "printenv OFFICE_AGENT_GATEWAY_TOKEN || true",
    timeout: "while true; do :; done",
  };
}

function toMsysPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replaceAll("\\", "/");
  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!driveMatch) {
    return normalized;
  }
  return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function npmCommand() {
  return "npm";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
