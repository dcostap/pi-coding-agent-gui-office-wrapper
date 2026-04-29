import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const outputRoot = path.join(desktopDir, "build", "runtime", "python");
const targetTriple = "x86_64-pc-windows-msvc";
const manifestName = "officeagent-python-runtime.json";

const archiveOverride = process.env.OFFICE_AGENT_PYTHON_RUNTIME_ARCHIVE?.trim();
const downloadEnabled = process.env.OFFICE_AGENT_DOWNLOAD_PYTHON_RUNTIME === "1";
const expectedSha256 = process.env.OFFICE_AGENT_PYTHON_RUNTIME_SHA256?.trim().toLowerCase();
const packagingRevision = Number.parseInt(process.env.OFFICE_AGENT_PYTHON_RUNTIME_PACKAGING_REVISION ?? "1", 10);

await mkdir(outputRoot, { recursive: true });

if (!archiveOverride && !downloadEnabled) {
  await writeFile(path.join(outputRoot, ".gitkeep"), "");
  console.log(
    "Skipping OfficeAgent Python runtime staging. Set OFFICE_AGENT_PYTHON_RUNTIME_ARCHIVE or OFFICE_AGENT_DOWNLOAD_PYTHON_RUNTIME=1.",
  );
  process.exit(0);
}

const pythonVersion = process.env.OFFICE_AGENT_PYTHON_VERSION?.trim();
const standaloneRelease = process.env.OFFICE_AGENT_PYTHON_BUILD_STANDALONE_RELEASE?.trim();

let archivePath;
let metadata;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "officeagent-python-runtime-"));
try {
  if (archiveOverride) {
    archivePath = path.resolve(archiveOverride);
    await access(archivePath);
    metadata = inferPythonArchiveMetadata(path.basename(archivePath));
  } else {
    if (!pythonVersion || !standaloneRelease) {
      throw new Error(
        "OFFICE_AGENT_DOWNLOAD_PYTHON_RUNTIME=1 requires OFFICE_AGENT_PYTHON_VERSION and OFFICE_AGENT_PYTHON_BUILD_STANDALONE_RELEASE.",
      );
    }
    metadata = { pythonVersion, standaloneRelease };
    const fileName = pythonArchiveFileName(metadata.pythonVersion, metadata.standaloneRelease);
    archivePath = path.join(tempRoot, fileName);
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${metadata.standaloneRelease}/${encodeURIComponent(fileName)}`;
    console.log(`Downloading Python runtime from ${url}`);
    await downloadFile(url, archivePath);
  }

  if (!metadata.pythonVersion || !metadata.standaloneRelease) {
    throw new Error(
      "Could not infer Python runtime metadata from archive name. Set OFFICE_AGENT_PYTHON_VERSION and OFFICE_AGENT_PYTHON_BUILD_STANDALONE_RELEASE.",
    );
  }

  const actualSha256 = await sha256File(archivePath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`Python runtime SHA256 mismatch. expected=${expectedSha256} actual=${actualSha256}`);
  }

  const runtimeId = `python-${metadata.pythonVersion}+pbs-${metadata.standaloneRelease}-win-x64-officeagent.${packagingRevision}`;
  const extractDir = path.join(tempRoot, "extract");
  await mkdir(extractDir, { recursive: true });
  await run(windowsTarCommand(), ["-xzf", archivePath, "-C", extractDir]);

  const extractedPythonDir = path.join(extractDir, "python");
  await access(path.join(extractedPythonDir, "python.exe"));

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const stagedRuntimeDir = path.join(outputRoot, runtimeId);
  await cp(extractedPythonDir, stagedRuntimeDir, { recursive: true, force: true });

  const manifest = {
    kind: "officeagent-python-runtime",
    runtimeId,
    version: metadata.pythonVersion,
    pythonVersion: metadata.pythonVersion,
    pythonBuildStandaloneRelease: metadata.standaloneRelease,
    target: targetTriple,
    sourceArchive: path.basename(archivePath),
    sha256: actualSha256,
    packagingRevision,
    executableRelativePath: "python.exe",
    scriptsRelativePath: "Scripts",
  };
  await writeFile(path.join(stagedRuntimeDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, ".gitkeep"), "");
  console.log(`Staged OfficeAgent Python runtime ${runtimeId} at ${stagedRuntimeDir}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function pythonArchiveFileName(version, release) {
  return `cpython-${version}+${release}-${targetTriple}-install_only_stripped.tar.gz`;
}

function inferPythonArchiveMetadata(fileName) {
  const match = /^cpython-(?<pythonVersion>[^+]+)\+(?<standaloneRelease>\d+)-x86_64-pc-windows-msvc.*install_only(?:_stripped)?\.tar\.gz$/i.exec(fileName);
  return {
    pythonVersion: process.env.OFFICE_AGENT_PYTHON_VERSION?.trim() ?? match?.groups?.pythonVersion,
    standaloneRelease: process.env.OFFICE_AGENT_PYTHON_BUILD_STANDALONE_RELEASE?.trim() ?? match?.groups?.standaloneRelease,
  };
}

function windowsTarCommand() {
  if (process.platform !== "win32") {
    return "tar";
  }
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
}

async function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function downloadFile(url, targetPath, redirects = 0) {
  if (redirects > 10) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { headers: { "User-Agent": "office-agent-runtime-stager" } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), targetPath, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: ${status} ${response.statusMessage ?? ""}`.trim()));
        return;
      }
      const out = createWriteStream(targetPath);
      response.pipe(out);
      response.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => out.close(resolve));
    });
    request.on("error", reject);
  });
}
