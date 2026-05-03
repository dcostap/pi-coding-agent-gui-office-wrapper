import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(__filename);

type ElectronShell = {
  openPath?: (path: string) => Promise<string>;
};

function getElectronShell(): ElectronShell | null {
  try {
    const electron = require("electron") as { shell?: ElectronShell } | string;
    return typeof electron === "object" ? (electron.shell ?? null) : null;
  } catch {
    return null;
  }
}

function openPathWithFallback(targetPath: string) {
  const command =
    process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";

  const child = spawn(command, [targetPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export async function openPathWithSystem(targetPath: string) {
  const shell = getElectronShell();

  if (shell?.openPath) {
    const error = await shell.openPath(targetPath);
    if (error.length === 0) {
      return true;
    }
  }

  try {
    openPathWithFallback(targetPath);
    return true;
  } catch {
    return false;
  }
}
