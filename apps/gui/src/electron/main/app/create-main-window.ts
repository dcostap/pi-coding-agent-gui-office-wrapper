import path from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { resolveConfiguredDevServerUrl } from "../../../../shared/dev-server";
import { isTrustedRendererUrl, shouldOpenUrlExternally } from "./navigation-security";
import { getElectronBuildDirectory } from "../runtime/app-paths";
import { getRendererDistDirectory } from "../runtime/app-paths";

const MIN_WINDOW_WIDTH = 1040;
const MIN_WINDOW_HEIGHT = 600;

function getWindowIconPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "dist", "howcode-icon.png");
  }

  return path.join(process.env.HOWCODE_REPO_ROOT ?? process.cwd(), "public", "howcode-icon.png");
}

function getRendererTrustConfig() {
  return {
    rendererDistDirectory: getRendererDistDirectory(),
    devServerUrl: app.isPackaged
      ? null
      : resolveConfiguredDevServerUrl([
          process.env.HOWCODE_REPO_ROOT ?? "",
          app.getAppPath(),
          process.cwd(),
        ]),
  };
}

export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    title: "Castrosua IA",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#ededed",
      height: 36,
    },
    backgroundColor: "#1f1f1f",
    autoHideMenuBar: true,
    width: 1480,
    height: 980,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    x: 120,
    y: 80,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(getElectronBuildDirectory(), "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererTrustConfig = getRendererTrustConfig();

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, rendererTrustConfig)) {
      return;
    }

    event.preventDefault();
    if (shouldOpenUrlExternally(url)) {
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenUrlExternally(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  return mainWindow;
}
