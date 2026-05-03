import path from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { resolveConfiguredDevServerUrl } from "../../../../shared/dev-server";
import { SMALL_WINDOW_MINIMUM_SIZE } from "../../../app/app-shell/small-window";
import { isTrustedRendererUrl, shouldOpenUrlExternally } from "./navigation-security";
import { getElectronBuildDirectory } from "../runtime/app-paths";
import { getRendererDistDirectory } from "../runtime/app-paths";

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
    title: "OfficeAgent",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#ededed",
      height: 36,
    },
    backgroundColor: "#00000000",
    backgroundMaterial: process.platform === "win32" ? "acrylic" : undefined,
    autoHideMenuBar: true,
    width: 1480,
    height: 980,
    minWidth: SMALL_WINDOW_MINIMUM_SIZE.width,
    minHeight: SMALL_WINDOW_MINIMUM_SIZE.height,
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
