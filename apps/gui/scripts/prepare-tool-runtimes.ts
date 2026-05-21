import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface RuntimeLock {
  readonly schemaVersion: number;
  readonly python?: PythonRuntimeLock;
  readonly uv?: UvRuntimeLock;
}

interface PythonRuntimeLock {
  readonly enabled: boolean;
  readonly source: string;
  readonly runtimeId: string;
  readonly pythonVersion: string;
  readonly release: string;
  readonly targetTriple: string;
  readonly variant: string;
  readonly archiveName: string;
  readonly url: string;
  readonly sha256: string;
  readonly size?: number;
}

interface UvRuntimeLock {
  readonly enabled: boolean;
  readonly source: string;
  readonly runtimeId: string;
  readonly version: string;
  readonly targetTriple: string;
  readonly archiveName: string;
  readonly url: string;
  readonly sha256: string;
  readonly size?: number;
}

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const checkOnly = args.has("--check");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const runtimeBuildRoot = path.join(projectRoot, "desktop", "build", "runtime");
const cacheDir = path.join(projectRoot, "desktop", "build", "runtime-cache");
const legalBuildDir = path.join(projectRoot, "desktop", "build", "legal");
const lockPath = path.join(scriptDir, "tool-runtimes.lock.json");

async function main() {
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as RuntimeLock;
  if (lock.schemaVersion !== 1) {
    throw new Error(`Unsupported tool runtime lock schemaVersion: ${lock.schemaVersion}`);
  }

  if (checkOnly) {
    await checkPreparedRuntimes(lock);
    return;
  }

  if (lock.python?.enabled) {
    await preparePythonRuntime(lock.python);
  }
  if (lock.uv?.enabled) {
    await prepareUvRuntime(lock.uv);
  }
  await writeAggregateNotices(lock);
}

async function checkPreparedRuntimes(lock: RuntimeLock): Promise<void> {
  if (lock.python?.enabled) {
    const manifestPath = path.join(
      runtimeBuildRoot,
      "python",
      lock.python.runtimeId,
      "officeagent-python-runtime.json",
    );
    await access(manifestPath);
  }
  if (lock.uv?.enabled) {
    const manifestPath = path.join(
      runtimeBuildRoot,
      "uv",
      lock.uv.runtimeId,
      "officeagent-uv-runtime.json",
    );
    await access(manifestPath);
  }
}

async function preparePythonRuntime(config: PythonRuntimeLock): Promise<void> {
  const targetDir = path.join(runtimeBuildRoot, "python", config.runtimeId);
  const manifestPath = path.join(targetDir, "officeagent-python-runtime.json");
  const pythonDir = path.join(targetDir, "python");
  const pythonExe = path.join(pythonDir, "python.exe");
  if (!force && (await fileExists(manifestPath)) && (await fileExists(pythonExe))) {
    console.log(`Python runtime already prepared: ${config.runtimeId}`);
    return;
  }

  const archivePath = await downloadAndVerify(config.url, config.archiveName, config.sha256);
  const stagingParent = path.join(runtimeBuildRoot, "python", ".staging");
  const stagingDir = path.join(stagingParent, `${config.runtimeId}-${process.pid}-${randomUUID()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  console.log(`Extracting Python runtime ${config.runtimeId}...`);
  await extractTarGz(archivePath, stagingDir);
  const defaultExtractedPythonDir = path.join(stagingDir, "python");
  const extractedPythonDir = (await fileExists(path.join(defaultExtractedPythonDir, "python.exe")))
    ? defaultExtractedPythonDir
    : await findDirectoryContaining(stagingDir, "python.exe");
  if (!extractedPythonDir) {
    throw new Error(`Python archive did not contain python.exe: ${archivePath}`);
  }

  const stagedRuntimeDir = path.join(stagingDir, "runtime");
  await mkdir(stagedRuntimeDir, { recursive: true });
  const stagedPythonDir = path.join(stagedRuntimeDir, "python");
  await cp(extractedPythonDir, stagedPythonDir, { recursive: true });
  await rm(extractedPythonDir, { recursive: true, force: true });
  await removeFilesByExtension(stagedPythonDir, ".pdb");
  await writePythonRuntimeMetadata(stagedRuntimeDir, config);

  const stagedPythonExe = path.join(stagedRuntimeDir, "python", "python.exe");
  await smokePython(stagedPythonExe);
  await finalizeRuntime(stagedRuntimeDir, targetDir);
  console.log(`Prepared Python runtime: ${targetDir}`);
}

async function prepareUvRuntime(config: UvRuntimeLock): Promise<void> {
  const targetDir = path.join(runtimeBuildRoot, "uv", config.runtimeId);
  const manifestPath = path.join(targetDir, "officeagent-uv-runtime.json");
  const uvExe = path.join(targetDir, "uv.exe");
  if (!force && (await fileExists(manifestPath)) && (await fileExists(uvExe))) {
    console.log(`uv runtime already prepared: ${config.runtimeId}`);
    return;
  }

  const archivePath = await downloadAndVerify(config.url, config.archiveName, config.sha256);
  const stagingParent = path.join(runtimeBuildRoot, "uv", ".staging");
  const stagingDir = path.join(stagingParent, `${config.runtimeId}-${process.pid}-${randomUUID()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  console.log(`Extracting uv runtime ${config.runtimeId}...`);
  await extractZip(archivePath, stagingDir);
  const extractedUvExe = await findFile(stagingDir, "uv.exe");
  if (!extractedUvExe) {
    throw new Error(`uv archive did not contain uv.exe: ${archivePath}`);
  }

  const stagedRuntimeDir = path.join(stagingDir, "runtime");
  await mkdir(stagedRuntimeDir, { recursive: true });
  await copyFile(extractedUvExe, path.join(stagedRuntimeDir, "uv.exe"));
  await writeUvRuntimeMetadata(stagedRuntimeDir, config);
  await smokeUv(path.join(stagedRuntimeDir, "uv.exe"), config.version);
  await finalizeRuntime(stagedRuntimeDir, targetDir);
  console.log(`Prepared uv runtime: ${targetDir}`);
}

async function downloadAndVerify(
  url: string,
  fileName: string,
  expectedSha256: string,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, fileName);
  if (!force && (await fileExists(archivePath))) {
    const actual = await sha256File(archivePath);
    if (actual.toLowerCase() === expectedSha256.toLowerCase()) {
      return archivePath;
    }
    console.warn(`Cached runtime archive hash mismatch; re-downloading ${fileName}.`);
    await rm(archivePath, { force: true });
  }

  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`SHA256 mismatch for ${fileName}: expected ${expectedSha256}, got ${actual}`);
  }
  await writeFile(archivePath, buffer);
  return archivePath;
}

async function writePythonRuntimeMetadata(
  targetDir: string,
  config: PythonRuntimeLock,
): Promise<void> {
  const pythonDir = path.join(targetDir, "python");
  const vcRuntimeFiles = (
    await Promise.all(
      ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"].map(async (name) =>
        (await fileExists(path.join(pythonDir, name))) ? name : undefined,
      ),
    )
  ).filter((value): value is string => value !== undefined);
  const licensesDir = path.join(targetDir, "licenses");
  await mkdir(licensesDir, { recursive: true });
  await writeFile(
    path.join(licensesDir, "THIRD_PARTY_NOTICES.txt"),
    createPythonNotice(config, vcRuntimeFiles),
    "utf8",
  );
  await writeFile(
    path.join(targetDir, "officeagent-python-runtime.json"),
    `${JSON.stringify(
      {
        kind: "officeagent-python-runtime",
        schemaVersion: 1,
        runtimeId: config.runtimeId,
        source: {
          name: config.source,
          release: config.release,
          archiveName: config.archiveName,
          archiveSha256: config.sha256,
          targetTriple: config.targetTriple,
          variant: config.variant,
          url: config.url,
        },
        pythonVersion: config.pythonVersion,
        architecture: "x64",
        platform: "win32",
        executableRelativePath: "python/python.exe",
        scriptsRelativePath: "python/Scripts",
        stdlibRelativePath: "python/Lib",
        pipMode: "module",
        supportsVenv: true,
        supportsEnsurepip: true,
        containsPip: true,
        requiresVCRuntime: true,
        vcRuntimeFiles,
        licenseNoticeRelativePath: "licenses/THIRD_PARTY_NOTICES.txt",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeReadyMarker(targetDir, config.runtimeId);
}

async function writeUvRuntimeMetadata(targetDir: string, config: UvRuntimeLock): Promise<void> {
  const licensesDir = path.join(targetDir, "licenses");
  await mkdir(licensesDir, { recursive: true });
  await writeFile(
    path.join(licensesDir, "THIRD_PARTY_NOTICES.txt"),
    createUvNotice(config),
    "utf8",
  );
  await writeFile(
    path.join(targetDir, "officeagent-uv-runtime.json"),
    `${JSON.stringify(
      {
        kind: "officeagent-uv-runtime",
        schemaVersion: 1,
        runtimeId: config.runtimeId,
        source: {
          name: config.source,
          version: config.version,
          archiveName: config.archiveName,
          archiveSha256: config.sha256,
          targetTriple: config.targetTriple,
          url: config.url,
        },
        uvVersion: config.version,
        architecture: "x64",
        platform: "win32",
        executableRelativePath: "uv.exe",
        licenseNoticeRelativePath: "licenses/THIRD_PARTY_NOTICES.txt",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeReadyMarker(targetDir, config.runtimeId);
}

async function writeReadyMarker(targetDir: string, runtimeId: string): Promise<void> {
  await writeFile(
    path.join(targetDir, "READY.json"),
    `${JSON.stringify(
      {
        runtimeId,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function finalizeRuntime(stagedRuntimeDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  try {
    await rename(stagedRuntimeDir, targetDir);
  } catch (error) {
    if (!isWindowsPermissionError(error)) {
      throw error;
    }
    await cp(stagedRuntimeDir, targetDir, { recursive: true });
    await rm(stagedRuntimeDir, { recursive: true, force: true });
  }
}

function isWindowsPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
}

async function smokePython(pythonExe: string): Promise<void> {
  if (process.platform !== "win32") {
    console.warn(
      `Skipping Python smoke on ${process.platform}; Windows runtime cannot execute here.`,
    );
    return;
  }
  await run(pythonExe, [
    "-E",
    "-c",
    "import sys, ssl, sqlite3, venv, ensurepip; print(sys.version)",
  ]);
  const tempEnv = path.join(path.dirname(path.dirname(pythonExe)), ".smoke-env");
  await rm(tempEnv, { recursive: true, force: true });
  await run(pythonExe, ["-m", "venv", "--without-pip", tempEnv]);
  await run(path.join(tempEnv, "Scripts", "python.exe"), [
    "-m",
    "ensurepip",
    "--upgrade",
    "--default-pip",
  ]);
  await run(path.join(tempEnv, "Scripts", "python.exe"), ["-m", "pip", "--version"]);
  await rm(tempEnv, { recursive: true, force: true });
}

async function smokeUv(uvExe: string, expectedVersion: string): Promise<void> {
  if (process.platform !== "win32") {
    console.warn(`Skipping uv smoke on ${process.platform}; Windows runtime cannot execute here.`);
    return;
  }
  const output = await run(uvExe, ["--version"]);
  if (!output.includes(expectedVersion)) {
    throw new Error(
      `uv smoke returned unexpected version. Expected ${expectedVersion}; output: ${output}`,
    );
  }
}

async function extractTarGz(archivePath: string, destinationDir: string): Promise<void> {
  const tarCommand =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  await run(tarCommand, ["-xzf", archivePath, "-C", destinationDir]);
}

async function extractZip(archivePath: string, destinationDir: string): Promise<void> {
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShellString(archivePath)} -DestinationPath ${quotePowerShellString(destinationDir)} -Force`,
    ]);
    return;
  }
  await run("unzip", ["-q", archivePath, "-d", destinationDir]);
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout + stderr);
        return;
      }
      rejectPromise(
        new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stdout}${stderr}`),
      );
    });
  });
}

async function removeFilesByExtension(root: string, extension: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await removeFilesByExtension(candidate, extension);
        return;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase())) {
        await rm(candidate, { force: true });
      }
    }),
  );
}

async function findDirectoryContaining(
  root: string,
  fileName: string,
): Promise<string | undefined> {
  const filePath = await findFile(root, fileName);
  return filePath ? path.dirname(filePath) : undefined;
}

async function findFile(root: string, fileName: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const found = await findFile(candidate, fileName);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

async function fileExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(pathValue: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(pathValue);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function createPythonNotice(config: PythonRuntimeLock, vcRuntimeFiles: readonly string[]): string {
  return [
    "OfficeAgent bundled Python runtime",
    "==================================",
    "",
    `Runtime ID: ${config.runtimeId}`,
    `Source: ${config.source}`,
    `Release: ${config.release}`,
    `Archive: ${config.archiveName}`,
    `SHA256: ${config.sha256}`,
    `URL: ${config.url}`,
    "",
    "This runtime is prepared from python-build-standalone. Include python-build-standalone, CPython, and third-party dependency notices in product legal review before release.",
    vcRuntimeFiles.length > 0
      ? `Detected VC runtime DLLs in runtime: ${vcRuntimeFiles.join(", ")}`
      : "No VC runtime DLLs were detected in the runtime tree. Clean-machine packaging must verify VC runtime handling before release.",
    "",
  ].join("\n");
}

function createUvNotice(config: UvRuntimeLock): string {
  return [
    "OfficeAgent bundled uv runtime",
    "================================",
    "",
    `Runtime ID: ${config.runtimeId}`,
    `Source: ${config.source}`,
    `Version: ${config.version}`,
    `Archive: ${config.archiveName}`,
    `SHA256: ${config.sha256}`,
    `URL: ${config.url}`,
    "",
    "Include uv license notices in product legal review before release.",
    "",
  ].join("\n");
}

async function writeAggregateNotices(lock: RuntimeLock): Promise<void> {
  await mkdir(legalBuildDir, { recursive: true });
  const notices = [
    "OfficeAgent bundled tool runtime notices",
    "=========================================",
    "",
    "This file is generated by apps/gui/scripts/prepare-tool-runtimes.ts.",
    "It is a packaging aid, not a substitute for final legal/compliance review.",
    "",
    lock.python?.enabled ? createPythonNotice(lock.python, []) : "",
    lock.uv?.enabled ? createUvNotice(lock.uv) : "",
  ]
    .filter(Boolean)
    .join("\n");
  await writeFile(path.join(legalBuildDir, "THIRD_PARTY_RUNTIME_NOTICES.txt"), notices, "utf8");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
