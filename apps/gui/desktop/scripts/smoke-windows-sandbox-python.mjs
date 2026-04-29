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
  console.log("Skipping OfficeAgent Windows sandbox Python smoke outside Windows.");
  process.exit(0);
}

const keepSmokeDir = process.env.OFFICE_AGENT_KEEP_SANDBOX_SMOKE_DIR === "1";
const strict = process.env.OFFICE_AGENT_SANDBOX_PYTHON_SMOKE_STRICT === "1" || process.env.OFFICE_AGENT_REQUIRE_BUNDLED_PYTHON === "1";
let managedRoot;

try {
  await run(npmCommand(), ["run", "build", "--workspace", "@office-agent/runtime"]);
  await run(npmCommand(), ["run", "build", "--workspace", "@pi-gui/pi-sdk-driver"]);
  await run(npmCommand(), ["run", "build:sandbox-helper", "--workspace", "@office-agent/gui"]);
  await run(npmCommand(), ["run", "build:python-runtime", "--workspace", "@office-agent/gui"]);
  await run(npmCommand(), ["run", "build:uv-runtime", "--workspace", "@office-agent/gui"]);
  await run(npmCommand(), ["run", "build", "--workspace", "@pi-gui/pi-sdk-driver"]);

  const runtime = await import(pathToFileURL(path.join(repoRoot, "packages", "office-agent-runtime", "dist", "index.js")));
  const driver = await import(pathToFileURL(path.join(repoRoot, "packages", "pi-sdk-driver", "dist", "windows-sandbox-helper-client.js")));

  managedRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "officeagent-sandbox-python-root-")));
  const projectDir = path.join(managedRoot, "projects", "demo");
  await mkdir(projectDir, { recursive: true });

  const sessionId = `python-${Date.now()}`;
  const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRoot);
  const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, { managedRootDir: managedRoot });
  const shell = await driver.ensureOfficeAgentSandboxShellConfig(managedRoot);

  if (!shell.pythonRuntime) {
    const report = {
      ok: !strict,
      skipped: true,
      strict,
      managedRoot,
      shell,
      note: "No bundled OfficeAgent Python runtime was staged. Provide OFFICE_AGENT_PYTHON_RUNTIME_ARCHIVE or OFFICE_AGENT_DOWNLOAD_PYTHON_RUNTIME=1.",
    };
    console.log(JSON.stringify(report, null, 2));
    if (strict) throw new Error(report.note);
  } else {

  const bash = driver.createOfficeAgentSandboxBashOperations({ managedRootDir: managedRoot, sessionPaths, env });
  const onlyChecks = new Set((process.env.OFFICE_AGENT_SANDBOX_PYTHON_SMOKE_ONLY ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean));
  const commands = [
    { name: "where-python", command: "python -c \"import shutil; print(shutil.which('python'))\"" },
    { name: "python-version", command: "python --version" },
    { name: "python-executable", command: "python -c \"import sys; print(sys.executable); print(sys.prefix)\"" },
    { name: "pip-module-version", command: "python -m pip --version" },
    { name: "pip-shim-version", command: "pip --version" },
    { name: "temp-env", command: "echo TEMP=%TEMP% TMP=%TMP% TMPDIR=%TMPDIR%" },
    { name: "temp-write", command: "echo ok> \"%TEMP%\\officeagent-temp-write.txt\" && type \"%TEMP%\\officeagent-temp-write.txt\"" },
    { name: "python-tempfile", command: "python -c \"import os, tempfile; print(os.environ.get('TMPDIR')); print(os.environ.get('TEMP')); print(tempfile.gettempdir())\"" },
    { name: "python-temp-write", command: "python -c \"import os; p=os.path.join(os.environ['TMPDIR'], 'py-temp-write.txt'); open(p, 'w').write('ok'); print(open(p).read())\"" },
    { name: "python-dns", command: "python -c \"import socket; print(socket.getaddrinfo('pypi.org', 443)[0])\"" },
    { name: "cmd-mkdir-python-write", command: "mkdir \"%TMPDIR%\\cmdmade\" && python -c \"import os; p=os.path.join(os.environ['TMPDIR'], 'cmdmade', 'x.txt'); open(p, 'w').write('ok'); print(open(p).read())\"" },
    { name: "python-mkdtemp-write", command: "python -c \"import os, tempfile; p=tempfile.mkdtemp(); print(p); f=os.path.join(p, 'x.txt'); open(f, 'w').write('ok'); print(open(f).read())\"" },
    { name: "venv-mkdtemp-write", command: "python -m venv .venv && .venv\\Scripts\\python.exe -c \"import os, tempfile; p=tempfile.mkdtemp(); print(p); f=os.path.join(p, 'x.txt'); open(f, 'w').write('ok'); print(open(f).read())\"", timeout: 90 },
    { name: "venv", command: "python -m venv .venv", timeout: 90 },
    { name: "venv-debug-ensurepip", command: "python -m venv --without-pip .venv && .venv\\Scripts\\python.exe -m ensurepip --upgrade --default-pip -v", timeout: 90 },
    { name: "sitecustomize-debug", command: "python -c \"import os, tempfile, sitecustomize; print(os.environ.get('PYTHONPATH')); print(sitecustomize.__file__); print(tempfile.mkdtemp.__name__)\" && python -m venv --without-pip .venv && .venv\\Scripts\\python.exe -c \"import os, tempfile, sitecustomize; print(os.environ.get('PYTHONPATH')); print(sitecustomize.__file__); print(tempfile.mkdtemp.__name__)\"", timeout: 90 },
    { name: "venv-pip", command: ".venv\\Scripts\\python.exe -m pip --version" },
    { name: "pip-install-requests", command: ".venv\\Scripts\\python.exe -m pip install requests", timeout: 180 },
    { name: "pip-install-requests-verbose", command: ".venv\\Scripts\\python.exe -m pip install -vvv requests", timeout: 180 },
    { name: "import-requests", command: ".venv\\Scripts\\python.exe -c \"import requests; print(requests.__version__)\"" },
    { name: "session-user-pip", command: "pip install rich", timeout: 180 },
    { name: "python-user-base", command: "python -c \"import site; print(site.USER_BASE)\"" },
    { name: "ssl", command: "python -c \"import ssl; print(ssl.OPENSSL_VERSION)\"" },
    { name: "sqlite", command: "python -c \"import sqlite3; print(sqlite3.sqlite_version)\"" },
    ...(shell.uvRuntime
      ? [
        { name: "uv-version", command: "uv --version" },
        { name: "uv-python-find", command: "uv python find" },
        { name: "uv-python-find-cmd-shim", command: "uv python find \"%OFFICE_AGENT_PYTHON_RUNTIME_DIR%\\..\\shims\\python.cmd\"" },
        { name: "uv-venv", command: "if exist .venv rmdir /s /q .venv\r\nuv venv", timeout: 90 },
        { name: "uv-pip-install", command: "uv pip install httpx", timeout: 180 },
        { name: "uv-run-python", command: "uv run python -c \"import httpx; print(httpx.__version__)\"", timeout: 120 },
      ]
      : []),
  ];

  const selectedCommands = onlyChecks.size > 0
    ? commands.filter((check) => onlyChecks.has(check.name))
    : commands;
  const results = [];
  for (const check of selectedCommands) {
    console.log(`sandbox python smoke: ${check.name}`);
    const result = await runSandboxCommand(bash, check.command, projectDir, env, check.timeout ?? 60);
    results.push({
      name: check.name,
      command: check.command,
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      output: trimOutput(result.output),
    });
  }

  const failed = results.filter((result) => !result.ok);
  const report = {
    ok: failed.length === 0,
    strict,
    managedRoot,
    projectDir,
    shell,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    throw new Error(`Bundled Python sandbox smoke checks failed: ${failed.map((result) => result.name).join(", ")}`);
  }
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

function npmCommand() {
  return "npm";
}
