import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "../..");

if (process.platform !== "win32") {
  process.exit(0);
}

const exePath = path.join(appDir, "artifacts", "electron", "win-unpacked", "Castrosua IA.exe");
const iconPath = path.join(appDir, "artifacts", "electron", ".icon-ico", "icon.ico");

const rceditCandidates = [
  path.join(appDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
  path.join(repoRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
  path.join(repoRoot, "node_modules", ".bun", "electron-winstaller@5.4.0", "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
];

if (!existsSync(exePath)) {
  console.warn(`[patch-windows-exe-icon] skipped; exe not found: ${exePath}`);
  process.exit(0);
}
if (!existsSync(iconPath)) {
  console.warn(`[patch-windows-exe-icon] skipped; icon not found: ${iconPath}`);
  process.exit(0);
}

const rceditPath = rceditCandidates.find((candidate) => existsSync(candidate));
if (!rceditPath) {
  console.warn(`[patch-windows-exe-icon] skipped; rcedit.exe not found. Tried: ${rceditCandidates.join(", ")}`);
  process.exit(0);
}

const result = spawnSync(rceditPath, [exePath, "--set-icon", iconPath], { stdio: "inherit" });
if (result.status !== 0) {
  throw new Error(`[patch-windows-exe-icon] rcedit failed with exit code ${result.status}`);
}

console.log(`[patch-windows-exe-icon] applied ${iconPath} to ${exePath}`);
