import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
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
const strictRealShellSmoke = process.env.OFFICE_AGENT_SANDBOX_REAL_SHELL_STRICT === "1";
let managedRoot;
let outsideRoot;
let fileToolOutsideRoot;

try {
  await run(npmCommand(), ["run", "build", "--workspace", "@office-agent/runtime"]);
  await run(npmCommand(), ["run", "build", "--workspace", "@pi-gui/pi-sdk-driver"]);
  await run(npmCommand(), ["run", "build:sandbox-helper", "--workspace", "@office-agent/gui"]);

  const runtime = await import(pathToFileURL(path.join(repoRoot, "packages", "office-agent-runtime", "dist", "index.js")));
  const driver = await import(pathToFileURL(path.join(repoRoot, "packages", "pi-sdk-driver", "dist", "windows-sandbox-helper-client.js")));

  const smokeParentDir = getOfficeAgentLocalAppDataDir();
  await mkdir(smokeParentDir, { recursive: true });
  managedRoot = await realpath(await mkdtemp(path.join(smokeParentDir, "AgentData-smoke-")));
  outsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-sandbox-smoke-outside-")));
  fileToolOutsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-file-tool-smoke-outside-")));
  const projectDir = path.join(managedRoot, "projects", "demo");
  await mkdir(projectDir, { recursive: true });

  const sessionId = `smoke-${Date.now()}`;
  const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRoot);
  const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, { managedRootDir: managedRoot });
  const shellConfig = await driver.ensureOfficeAgentSandboxShellConfig(managedRoot);
  const commandSet = shellConfig.backend === "git-bash"
    ? createBashSmokeCommands(outsideRoot)
    : shellConfig.backend === "powershell" || shellConfig.backend === "pwsh"
      ? createPowerShellSmokeCommands(outsideRoot)
      : createCmdSmokeCommands(outsideRoot);
  const bash = driver.createOfficeAgentSandboxBashOperations({
    managedRootDir: managedRoot,
    sessionPaths,
    env,
  });

  const selfTest = await driver.invokeWindowsSandboxHelper({ kind: "selfTest", requestId: "sandbox-smoke-self-test" });
  assert(selfTest.ok, `helper selfTest failed: ${JSON.stringify(selfTest)}`);

  const directFileToolWriteTarget = path.join(projectDir, "direct-file-tool-write.txt");
  await driver.writeFileWithOfficeAgentSandbox(managedRoot, directFileToolWriteTarget, "direct-file-tool-ok", { createParentDirs: true });
  await access(directFileToolWriteTarget);

  await grantEveryoneModify(fileToolOutsideRoot);
  const outsideJunction = path.join(projectDir, "outside-junction");
  await createDirectoryJunction(outsideJunction, fileToolOutsideRoot);
  const escapedFileToolWriteTarget = path.join(outsideJunction, "escaped-file-tool-write.txt");
  const escapedFileToolWrite = await tryAsync(() =>
    driver.writeFileWithOfficeAgentSandbox(managedRoot, escapedFileToolWriteTarget, "should-not-write", { createParentDirs: true }),
  );
  const escapedFileToolWriteExists = await exists(path.join(fileToolOutsideRoot, "escaped-file-tool-write.txt"));
  assert(!escapedFileToolWrite.ok, "strict native file write unexpectedly succeeded through a junction to an outside directory");
  assert(!escapedFileToolWriteExists, `strict native file write unexpectedly wrote outside through junction: ${escapedFileToolWriteTarget}`);

  const commandHostWriteChecks = await runCommandHostWriteReparseChecks({
    runtime,
    driver,
    managedRoot,
    projectDir,
    env,
    shellConfig,
    commandSet,
  });

  const inside = await runSandboxCommand(bash, commandSet.inside, projectDir, env, 20);
  assert(inside.exitCode === 0, `inside command failed: ${JSON.stringify(inside)}`);
  assert(inside.output.includes("sandbox-ok"), `inside command did not produce expected output: ${inside.output}`);

  assert(env.OFFICE_AGENT_REAL_USERPROFILE, "managed session env did not include OFFICE_AGENT_REAL_USERPROFILE");
  assert(env.OFFICE_AGENT_REAL_DESKTOP, "managed session env did not include OFFICE_AGENT_REAL_DESKTOP");
  assert(env.OFFICE_AGENT_SANDBOX_PROFILE === sessionPaths.profileDir, "managed session env did not expose the sandbox profile path");
  assert(env.OFFICE_AGENT_MANAGED_ROOT === managedRoot, "managed session env did not expose the managed root path");
  const realUserEnv = await runSandboxCommand(bash, commandSet.realUserEnv, projectDir, env, 20);
  assert(realUserEnv.exitCode === 0, `real-user env probe failed: ${JSON.stringify(realUserEnv)}`);
  assert(realUserEnv.output.includes(env.OFFICE_AGENT_REAL_DESKTOP), `sandbox command did not receive OFFICE_AGENT_REAL_DESKTOP: ${realUserEnv.output}`);
  assert(realUserEnv.output.includes(sessionPaths.profileDir), `sandbox command did not receive OFFICE_AGENT_SANDBOX_PROFILE: ${realUserEnv.output}`);

  const nativeCommandChecks = shellConfig.backend === "cmd"
    ? await runNativeCmdCompatibilityChecks(bash, projectDir, env)
    : { skipped: true };
  const powershellChecks = shellConfig.backend === "git-bash"
    ? { skipped: true }
    : await runPowerShellCompatibilityChecks(bash, projectDir, env, shellConfig.backend);
  assert(inside.output.toLowerCase().includes(managedRoot.toLowerCase()), `TEMP was not redirected inside the managed root. output=${inside.output}`);
  await access(path.join(projectDir, "inside.txt"));

  const outsideWriteTarget = path.join(outsideRoot, "blocked-write.txt");
  const outsideWrite = await runSandboxCommand(bash, commandSet.outsideWrite(outsideWriteTarget), projectDir, env, 20);
  const wroteOutside = await exists(outsideWriteTarget);
  assert(!wroteOutside, `sandbox command unexpectedly wrote outside managed root: ${outsideWriteTarget}; result=${JSON.stringify(outsideWrite)}`);

  const publicWriteTarget = path.join(getPublicDir(), `officeagent-blocked-${process.pid}-${Date.now()}.txt`);
  const publicWrite = await runSandboxCommand(bash, commandSet.outsideWrite(publicWriteTarget), projectDir, env, 20);
  const wrotePublic = await exists(publicWriteTarget);
  if (wrotePublic) await rm(publicWriteTarget, { force: true });
  assert(!wrotePublic, `sandbox command unexpectedly wrote to Public: ${publicWriteTarget}; result=${JSON.stringify(publicWrite)}`);

  const envLeak = await runSandboxCommand(bash, commandSet.envLeak, projectDir, env, 20);
  assert(!envLeak.output.includes("officeagent-demo-2026"), `sandbox command leaked OfficeAgent gateway token: ${envLeak.output}`);

  const systemRead = await runSandboxCommand(bash, commandSet.systemRead, projectDir, env, 20);
  assert(systemRead.exitCode === 0 && systemRead.output.length > 0, `sandbox command should be able to read normal read-only system files: ${JSON.stringify(systemRead)}`);

  const outsideSecret = path.join(outsideRoot, "secret.txt");
  await writeFile(outsideSecret, "outside-secret", "utf8");
  const outsideRead = await runSandboxCommand(bash, commandSet.outsideRead(outsideSecret), projectDir, env, 20);
  const outsideReadAllowed = outsideRead.output.includes("outside-secret");

  const timeout = await runSandboxCommand(bash, commandSet.timeout, projectDir, env, 1);
  assert(timeout.exitCode === 124, `timeout command should return 124, got ${JSON.stringify(timeout)}`);

  const cancellationTarget = path.join(projectDir, "cancelled-late-write.txt");
  const cancellation = await runCancellationCheck(bash, commandSet.delayedWrite(cancellationTarget), projectDir, env, cancellationTarget);

  console.log(JSON.stringify({
    ok: true,
    managedRoot,
    projectDir,
    shell: shellConfig,
    checks: {
      helperSelfTest: true,
      directFileToolWriteInside: true,
      directFileToolJunctionEscapeBlocked: true,
      commandHostWriteReparseChecks: commandHostWriteChecks,
      insideWriteAndOutput: true,
      nativeCmdCompatibility: nativeCommandChecks,
      powershellCompatibility: powershellChecks,
      tempRedirectedInsideManagedRoot: true,
      outsideWriteBlocked: true,
      publicWriteBlocked: true,
      gatewayTokenNotInSandboxEnv: true,
      systemReadAllowed: true,
      outsideReadAllowed,
      timeoutKilled: true,
      cancellation,
    },
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (managedRoot) console.error(`Managed root kept for debugging: ${managedRoot}`);
  if (outsideRoot) console.error(`Outside root kept for debugging: ${outsideRoot}`);
  if (fileToolOutsideRoot) console.error(`File-tool outside root kept for debugging: ${fileToolOutsideRoot}`);
  process.exitCode = 1;
} finally {
  if (!keepSmokeDir && process.exitCode !== 1) {
    await Promise.all([
      managedRoot ? rm(managedRoot, { recursive: true, force: true }) : Promise.resolve(),
      outsideRoot ? rm(outsideRoot, { recursive: true, force: true }) : Promise.resolve(),
      fileToolOutsideRoot ? rm(fileToolOutsideRoot, { recursive: true, force: true }) : Promise.resolve(),
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

async function runSandboxCommand(bash, command, cwd, env, timeout, options = {}) {
  let output = Buffer.alloc(0);
  const result = await bash.exec(command, cwd, {
    onData(data) {
      output = Buffer.concat([output, data]);
    },
    env,
    ...(timeout === undefined ? {} : { timeout }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return {
    exitCode: result.exitCode,
    output: output.toString("utf8"),
  };
}

async function runCommandHostWriteReparseChecks({ runtime, driver, managedRoot, projectDir, env, shellConfig, commandSet }) {
  const scriptOutsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-command-script-junction-")));
  const logsOutsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-command-logs-junction-")));
  try {
    await grantEveryoneModify(scriptOutsideRoot);
    await grantEveryoneModify(logsOutsideRoot);

    const scriptSessionId = `script-junction-${Date.now()}`;
    const scriptSessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(scriptSessionId, managedRoot);
    await rm(scriptSessionPaths.sessionDir, { recursive: true, force: true });
    await createDirectoryJunction(scriptSessionPaths.sessionDir, scriptOutsideRoot);
    const scriptJunctionBash = driver.createOfficeAgentSandboxBashOperations({
      managedRootDir: managedRoot,
      sessionPaths: scriptSessionPaths,
      env,
      shellConfig,
    });
    const scriptJunctionRun = await tryAsync(() => runSandboxCommand(scriptJunctionBash, commandSet.hostWriteProbe, projectDir, env, 20));
    const scriptOutsideFiles = await readdir(scriptOutsideRoot).catch(() => []);
    assert(!scriptJunctionRun.ok, "command script creation unexpectedly succeeded through a sessionDir junction");
    assert(scriptOutsideFiles.length === 0, `command script creation wrote outside through junction: ${scriptOutsideFiles.join(", ")}`);

    const logsSessionId = `logs-junction-${Date.now()}`;
    const logsSessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(logsSessionId, managedRoot);
    await rm(logsSessionPaths.logsDir, { recursive: true, force: true });
    await createDirectoryJunction(logsSessionPaths.logsDir, logsOutsideRoot);
    const logsJunctionBash = driver.createOfficeAgentSandboxBashOperations({
      managedRootDir: managedRoot,
      sessionPaths: logsSessionPaths,
      env,
      shellConfig,
    });
    const logsJunctionRun = await tryAsync(() => runSandboxCommand(logsJunctionBash, commandSet.hostWriteProbe, projectDir, env, 20));
    const logsOutsideFiles = await readdir(logsOutsideRoot).catch(() => []);
    assert(!logsJunctionRun.ok, "command log creation unexpectedly succeeded through a logsDir junction");
    assert(logsOutsideFiles.length === 0, `command log creation wrote outside through junction: ${logsOutsideFiles.join(", ")}`);

    return {
      commandScriptJunctionBlocked: true,
      commandLogJunctionBlocked: true,
    };
  } finally {
    await Promise.all([
      rm(scriptOutsideRoot, { recursive: true, force: true }),
      rm(logsOutsideRoot, { recursive: true, force: true }),
    ]);
  }
}

async function runCancellationCheck(bash, command, projectDir, env, cancellationTarget) {
  const controller = new AbortController();
  const started = Date.now();
  const runPromise = runSandboxCommand(bash, command, projectDir, env, undefined, { signal: controller.signal });
  setTimeout(() => controller.abort(), 1000);
  let aborted = false;
  try {
    await runPromise;
  } catch (error) {
    aborted = String(error instanceof Error ? error.message : error).includes("aborted");
  }
  const durationMs = Date.now() - started;
  await sleep(1500);
  const wroteAfterAbort = await exists(cancellationTarget);
  assert(aborted, "sandbox command cancellation should reject with aborted");
  assert(durationMs < 6_000, `sandbox command cancellation took too long: ${durationMs}ms`);
  assert(!wroteAfterAbort, `sandbox command wrote after cancellation: ${cancellationTarget}`);
  return { aborted, durationMs, wroteAfterAbort };
}

async function runNativeCmdCompatibilityChecks(bash, projectDir, env) {
  const commands = [
    {
      name: "dir-b",
      command: "dir /b",
      expect: (result) => result.exitCode === 0 && result.output.includes("inside.txt"),
    },
    {
      name: "dir-redirection",
      command: "dir /b > files.txt && type files.txt",
      expect: (result) => result.exitCode === 0 && result.output.includes("inside.txt"),
    },
    {
      name: "where-python",
      command: "where python",
      expect: (result) => result.exitCode === 0 && result.output.toLowerCase().includes("python"),
    },
    {
      name: "where-missing",
      command: "where definitely-not-real-officeagent-command",
      expect: (result) => result.exitCode !== 0,
    },
    {
      name: "copy-move-del-mkdir-rmdir",
      command: "mkdir a && copy inside.txt a\\copy.txt && move a\\copy.txt a\\moved.txt && type a\\moved.txt && del a\\moved.txt && rmdir a",
      expect: (result) => result.exitCode === 0 && result.output.includes("sandbox-ok"),
    },
    {
      name: "quoted-paths",
      command: "mkdir \"space dir\" && copy inside.txt \"space dir\\hello file.txt\" && type \"space dir\\hello file.txt\" && del \"space dir\\hello file.txt\" && rmdir \"space dir\"",
      expect: (result) => result.exitCode === 0 && result.output.includes("sandbox-ok"),
    },
  ];
  const results = {};
  for (const check of commands) {
    const result = await runSandboxCommand(bash, check.command, projectDir, env, 20);
    results[check.name] = { exitCode: result.exitCode, output: result.output.trim() };
    if (!check.expect(result)) {
      const message = `native cmd compatibility check failed (${check.name}): ${JSON.stringify(result)}`;
      if (strictRealShellSmoke) {
        assert(false, message);
      }
      results[check.name].diagnosticFailure = message;
    }
  }
  return results;
}

async function runPowerShellCompatibilityChecks(bash, projectDir, env, backend) {
  const command = backend === "powershell" || backend === "pwsh"
    ? "Get-ChildItem -Name | Out-String"
    : "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"Get-ChildItem -Name | Out-String\"";
  const result = await runSandboxCommand(bash, command, projectDir, env, 20);
  const passed = result.exitCode === 0 && result.output.includes("inside.txt");
  if (!passed && strictRealShellSmoke) {
    assert(false, `PowerShell compatibility check failed: ${JSON.stringify(result)}`);
  }
  return {
    exitCode: result.exitCode,
    output: result.output.trim(),
    ...(passed ? {} : { diagnosticFailure: `PowerShell compatibility check failed: ${JSON.stringify(result)}` }),
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

async function tryAsync(action) {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function grantEveryoneModify(dir) {
  await execFileAsync("icacls", [dir, "/grant", "*S-1-1-0:(OI)(CI)(M)"], {
    cwd: repoRoot,
    windowsHide: true,
  });
}

async function createDirectoryJunction(linkPath, targetPath) {
  const escapedLink = linkPath.replaceAll("'", "''");
  const escapedTarget = targetPath.replaceAll("'", "''");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `New-Item -ItemType Junction -Path '${escapedLink}' -Target '${escapedTarget}' | Out-Null`,
  ], {
    cwd: repoRoot,
    windowsHide: true,
  });
}

function createCmdSmokeCommands() {
  return {
    inside: "cd && echo sandbox-ok> inside.txt && type inside.txt && echo TEMP=%TEMP%",
    realUserEnv: "echo REAL_DESKTOP=%OFFICE_AGENT_REAL_DESKTOP%&& echo SANDBOX_PROFILE=%OFFICE_AGENT_SANDBOX_PROFILE%",
    outsideWrite: (target) => `echo should-not-exist> "${target}"`,
    outsideRead: (target) => `type "${target}"`,
    systemRead: "type C:\\Windows\\win.ini",
    envLeak: "set OFFICE_AGENT_GATEWAY_TOKEN",
    timeout: "for /l %%i in (1,1,1000000000) do @rem",
    delayedWrite: (target) => `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 10; 'late' | Set-Content -NoNewline '${escapePowerShellSingleQuotedString(target)}'"`,
    hostWriteProbe: "echo host-write-probe",
  };
}

function createPowerShellSmokeCommands() {
  return {
    inside: "$PWD.Path; 'sandbox-ok' | Set-Content -NoNewline inside.txt; Get-Content inside.txt; \"TEMP=$env:TEMP\"",
    realUserEnv: "\"REAL_DESKTOP=$env:OFFICE_AGENT_REAL_DESKTOP\"; \"SANDBOX_PROFILE=$env:OFFICE_AGENT_SANDBOX_PROFILE\"",
    outsideWrite: (target) => `'should-not-exist' | Set-Content -NoNewline "${escapePowerShellString(target)}"`,
    outsideRead: (target) => `Get-Content "${escapePowerShellString(target)}"`,
    systemRead: "Get-Content C:\\Windows\\win.ini",
    envLeak: "Get-ChildItem Env:OFFICE_AGENT_GATEWAY_TOKEN -ErrorAction SilentlyContinue",
    timeout: "while ($true) { Start-Sleep -Milliseconds 100 }",
    delayedWrite: (target) => `Start-Sleep -Seconds 10; 'late' | Set-Content -NoNewline '${escapePowerShellSingleQuotedString(target)}'`,
    hostWriteProbe: "Write-Output 'host-write-probe'",
  };
}

function createBashSmokeCommands() {
  return {
    inside: "pwd && echo sandbox-ok > inside.txt && cat inside.txt && echo TEMP=$TEMP && bash --version | head -n 1",
    realUserEnv: "printf 'REAL_DESKTOP=%s\\nSANDBOX_PROFILE=%s\\n' \"$OFFICE_AGENT_REAL_DESKTOP\" \"$OFFICE_AGENT_SANDBOX_PROFILE\"",
    outsideWrite: (target) => `echo should-not-exist > "${toMsysPath(target)}"`,
    outsideRead: (target) => `cat "${toMsysPath(target)}"`,
    systemRead: "cat /c/Windows/win.ini",
    envLeak: "printenv OFFICE_AGENT_GATEWAY_TOKEN || true",
    timeout: "while true; do :; done",
    delayedWrite: (target) => `sleep 10; echo late > "${toMsysPath(target)}"`,
    hostWriteProbe: "echo host-write-probe",
  };
}

function escapePowerShellString(value) {
  return value.replaceAll("`", "``").replaceAll("\"", "`\"");
}

function escapePowerShellSingleQuotedString(value) {
  return value.replaceAll("'", "''");
}

function toMsysPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replaceAll("\\", "/");
  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!driveMatch) {
    return normalized;
  }
  return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function getOfficeAgentLocalAppDataDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "OfficeAgent");
}

function getPublicDir() {
  return process.env.PUBLIC || path.join(path.parse(os.homedir()).root, "Users", "Public");
}

function npmCommand() {
  return "npm";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
