import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const outputDir = path.join(desktopDir, "build", "runtime", "git-bash", "v1");
const cacheDir = path.join(desktopDir, "build", "runtime-cache");
const defaultPortableGitVersion = "2.52.0.windows.1";
const defaultPortableGitArchive = "PortableGit-2.52.0-64-bit.7z.exe";
const defaultPortableGitUrl = `https://github.com/git-for-windows/git/releases/download/v${defaultPortableGitVersion}/${defaultPortableGitArchive}`;

if (process.platform !== "win32") {
  await ensurePlaceholder();
  console.log("Skipping Portable Git Bash staging outside Windows.");
  process.exit(0);
}

await ensurePlaceholder();

if (await hasBash(outputDir)) {
  console.log(`Portable Git Bash already staged at ${outputDir}`);
  process.exit(0);
}

const archiveOverride = process.env.OFFICE_AGENT_PORTABLE_GIT_ARCHIVE?.trim();
const shouldDownload = process.env.OFFICE_AGENT_DOWNLOAD_PORTABLE_GIT === "1";
const url = process.env.OFFICE_AGENT_PORTABLE_GIT_URL?.trim() || defaultPortableGitUrl;

if (!archiveOverride && !shouldDownload) {
  console.log(
    "Portable Git Bash not staged. Set OFFICE_AGENT_PORTABLE_GIT_ARCHIVE to a PortableGit .7z.exe, " +
      "or OFFICE_AGENT_DOWNLOAD_PORTABLE_GIT=1 to download the default Git for Windows portable archive.",
  );
  process.exit(0);
}

await mkdir(cacheDir, { recursive: true });
const archivePath = archiveOverride ? path.resolve(archiveOverride) : path.join(cacheDir, path.basename(new URL(url).pathname));

if (!archiveOverride) {
  console.log(`Downloading Portable Git Bash from ${url}`);
  await download(url, archivePath);
}

await access(archivePath);
await verifySha256IfRequested(archivePath);

const extractDir = await mkdtemp(path.join(cacheDir, "portable-git-extract-"));
try {
  console.log(`Extracting ${archivePath}`);
  await execFileAsync(archivePath, ["-y", `-o${extractDir}`], {
    cwd: desktopDir,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (!(await hasBash(extractDir))) {
    throw new Error(`Extracted Portable Git archive did not contain bin/bash.exe, usr/bin/bash.exe, or bash.exe: ${extractDir}`);
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await execFileAsync("robocopy", [extractDir, outputDir, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], {
    cwd: desktopDir,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  }).catch((error) => {
    // Robocopy returns 1 when files were copied successfully.
    if (typeof error?.code === "number" && error.code <= 3) {
      return;
    }
    throw error;
  });

  await writeFile(path.join(outputDir, "officeagent-runtime-manifest.json"), `${JSON.stringify({
    kind: "portable-git-for-windows",
    version: defaultPortableGitVersion,
    source: archiveOverride ? "local-archive" : url,
    stagedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`Staged Portable Git Bash at ${outputDir}`);
} finally {
  await rm(extractDir, { recursive: true, force: true });
}

async function ensurePlaceholder() {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, ".gitkeep"), "", "utf8");
}

async function hasBash(dir) {
  for (const relative of [path.join("bin", "bash.exe"), path.join("usr", "bin", "bash.exe"), "bash.exe"]) {
    try {
      await access(path.join(dir, relative));
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function verifySha256IfRequested(filePath) {
  const expected = process.env.OFFICE_AGENT_PORTABLE_GIT_SHA256?.trim().toLowerCase();
  if (!expected) {
    return;
  }
  const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
  if (digest !== expected) {
    throw new Error(`Portable Git archive checksum mismatch. Expected ${expected}, got ${digest}`);
  }
}

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), outputPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}
