import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const outputRoot = path.join(desktopDir, "build", "runtime", "uv");
const targetTriple = "x86_64-pc-windows-msvc";
const manifestName = "officeagent-uv-runtime.json";

const archiveOverride = process.env.OFFICE_AGENT_UV_ARCHIVE?.trim();
const downloadEnabled = process.env.OFFICE_AGENT_DOWNLOAD_UV === "1";
const expectedSha256 = process.env.OFFICE_AGENT_UV_SHA256?.trim().toLowerCase();
const packagingRevision = Number.parseInt(process.env.OFFICE_AGENT_UV_PACKAGING_REVISION ?? "1", 10);

await mkdir(outputRoot, { recursive: true });

if (!archiveOverride && !downloadEnabled) {
  await writeFile(path.join(outputRoot, ".gitkeep"), "");
  console.log("Skipping OfficeAgent uv runtime staging. Set OFFICE_AGENT_UV_ARCHIVE or OFFICE_AGENT_DOWNLOAD_UV=1.");
  process.exit(0);
}

let uvVersion = process.env.OFFICE_AGENT_UV_VERSION?.trim();
let archivePath;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "officeagent-uv-runtime-"));
try {
  if (archiveOverride) {
    archivePath = path.resolve(archiveOverride);
    await access(archivePath);
    uvVersion = uvVersion ?? inferUvVersion(path.basename(archivePath));
  } else {
    if (!uvVersion) {
      throw new Error("OFFICE_AGENT_DOWNLOAD_UV=1 requires OFFICE_AGENT_UV_VERSION, for example 0.11.8.");
    }
    const fileName = uvArchiveFileName();
    archivePath = path.join(tempRoot, fileName);
    const url = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/${fileName}`;
    console.log(`Downloading uv runtime from ${url}`);
    await downloadFile(url, archivePath);
  }

  if (!uvVersion) {
    throw new Error("Could not infer uv version from archive name. Set OFFICE_AGENT_UV_VERSION.");
  }

  const actualSha256 = await sha256File(archivePath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`uv runtime SHA256 mismatch. expected=${expectedSha256} actual=${actualSha256}`);
  }

  const runtimeId = `uv-${uvVersion}-win-x64-officeagent.${packagingRevision}`;
  const extractDir = path.join(tempRoot, "extract");
  await mkdir(extractDir, { recursive: true });
  await extractZip(archivePath, extractDir);

  const uvExe = await findFile(extractDir, "uv.exe");
  if (!uvExe) {
    throw new Error(`uv.exe was not found after extracting ${archivePath}`);
  }
  const uvxExe = await findFile(extractDir, "uvx.exe");

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const stagedRuntimeDir = path.join(outputRoot, runtimeId);
  await mkdir(stagedRuntimeDir, { recursive: true });
  await cp(uvExe, path.join(stagedRuntimeDir, "uv.exe"), { force: true });
  if (uvxExe) {
    await cp(uvxExe, path.join(stagedRuntimeDir, "uvx.exe"), { force: true });
  }

  const manifest = {
    kind: "officeagent-uv-runtime",
    runtimeId,
    version: uvVersion,
    uvVersion,
    target: targetTriple,
    sourceArchive: path.basename(archivePath),
    sha256: actualSha256,
    packagingRevision,
    executableRelativePath: "uv.exe",
  };
  await writeFile(path.join(stagedRuntimeDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, ".gitkeep"), "");
  console.log(`Staged OfficeAgent uv runtime ${runtimeId} at ${stagedRuntimeDir}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function uvArchiveFileName() {
  return `uv-${targetTriple}.zip`;
}

function inferUvVersion(fileName) {
  // The official release asset name does not include the version, so prefer the explicit env var.
  const match = /^uv-(?<version>\d+\.\d+\.\d+)-/i.exec(fileName);
  return match?.groups?.version;
}

async function extractZip(archivePath, outputDir) {
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowershell(archivePath)} -DestinationPath ${quotePowershell(outputDir)} -Force`,
    ]);
    return;
  }
  await run("unzip", ["-q", archivePath, "-d", outputDir]);
}

function quotePowershell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function findFile(root, fileName) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, fileName);
      if (nested) return nested;
    }
  }
  return undefined;
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
