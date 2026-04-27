import { execFile } from "node:child_process";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..", "..");
const manifestPath = path.join(repoRoot, "native", "windows-sandbox-helper", "Cargo.toml");
const targetDir = path.join(repoRoot, "native", "windows-sandbox-helper", "target");
const outputDir = path.join(desktopDir, "build", "native", "windows-sandbox-helper");
const exeName = "officeagent-windows-sandbox-helper.exe";
const builtExePath = path.join(targetDir, "release", exeName);
const outputExePath = path.join(outputDir, exeName);

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, ".gitkeep"), "", "utf8");

if (process.platform !== "win32") {
  console.log("Skipping Windows sandbox helper build outside Windows.");
  process.exit(0);
}

try {
  await execFileAsync("cargo", ["--version"], { cwd: repoRoot });
} catch {
  throw new Error("Rust cargo is required to build the OfficeAgent Windows sandbox helper.");
}

await execFileAsync("cargo", ["build", "--release", "--manifest-path", manifestPath], {
  cwd: repoRoot,
  env: process.env,
});

await access(builtExePath);
await copyFile(builtExePath, outputExePath);
console.log(`Built Windows sandbox helper at ${outputExePath}`);
