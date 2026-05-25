const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function findRcedit(appDir) {
  const repoRoot = path.resolve(appDir, "../..");
  const candidates = [
    path.join(appDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(repoRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(repoRoot, "node_modules", ".bun", "electron-winstaller@5.4.0", "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const appDir = context.packager.projectDir;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(appDir, "public", "howcode-icon.ico");

  if (!existsSync(exePath)) {
    throw new Error(`[after-pack] Windows exe not found: ${exePath}`);
  }
  if (!existsSync(iconPath)) {
    throw new Error(`[after-pack] Windows icon not found: ${iconPath}`);
  }

  const rceditPath = findRcedit(appDir);
  if (!rceditPath) {
    throw new Error("[after-pack] rcedit.exe not found");
  }

  const result = spawnSync(rceditPath, [exePath, "--set-icon", iconPath], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`[after-pack] rcedit failed with exit code ${result.status}`);
  }

  console.log(`[after-pack] applied ${iconPath} to ${exePath}`);
};
