import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { prepareOfficeAgentDesktopRuntime } from "../../../../desktop/office-agent-runtime.cts";

const require = createRequire(__filename);

function resolvePiPackageDirectory() {
  const packageName = "@earendil-works/pi-coding-agent";
  const searchPaths = require.resolve.paths(packageName) ?? [];
  for (const searchPath of searchPaths) {
    const packageDirectory = path.join(searchPath, packageName);
    if (existsSync(path.join(packageDirectory, "package.json"))) {
      return packageDirectory;
    }
  }
  return null;
}

function resolveConfiguredUserDataPath() {
  const configuredUserDataPath = process.env.HOWCODE_USER_DATA_PATH?.trim();
  if (configuredUserDataPath) {
    return configuredUserDataPath;
  }

  const defaultUserDataPath = app.getPath("userData");
  return app.isPackaged ? defaultUserDataPath : path.join(defaultUserDataPath, "dev");
}

export async function configureDesktopEnvironment() {
  const userDataPath = resolveConfiguredUserDataPath();
  app.setPath("userData", userDataPath);
  process.env.HOWCODE_USER_DATA_PATH = userDataPath;

  const piPackageDirectory = resolvePiPackageDirectory();
  if (piPackageDirectory) {
    process.env.PI_PACKAGE_DIR = piPackageDirectory;
  }

  await prepareOfficeAgentDesktopRuntime();
}
