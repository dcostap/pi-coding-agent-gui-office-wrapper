import {
  app,
  ipcMain,
  Menu,
  nativeImage,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  getDesktopEventIpcChannel,
  getDesktopRequestIpcChannel,
  type DesktopRequestChannel,
  type DesktopRequestHandlerMap,
  type TitleBarMenuId,
} from "../../../../shared/desktop-ipc";
import { resolveConfiguredDevServerUrl } from "../../../../shared/dev-server";
import { isTrustedRendererUrl } from "../app/navigation-security";
import type { DesktopRuntimeModules } from "../runtime/desktop-runtime-contracts";
import { getRendererDistDirectory } from "../runtime/app-paths";
import type { AppUpdater } from "../updater/app-updater";
import { createAppUpdateHandlers } from "./request-handlers/app-update";
import { createPiPackagesHandlers } from "./request-handlers/pi-packages";
import { createPiSkillsHandlers } from "./request-handlers/pi-skills";
import { createPiThreadsHandlers } from "./request-handlers/pi-threads";
import { createSkillCreatorHandlers } from "./request-handlers/skill-creator";
import { createSystemHandlers } from "./request-handlers/system";
import { createTerminalHandlers } from "./request-handlers/terminal";
import { createWindowsSandboxHandlers } from "./request-handlers/windows-sandbox";

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

function assertTrustedDesktopIpcEvent(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
) {
  const mainWindow = getMainWindow();
  const senderUrl = event.senderFrame?.url || event.sender.getURL();

  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("Blocked desktop IPC request from a non-main renderer.");
  }

  if (!isTrustedRendererUrl(senderUrl, getRendererTrustConfig())) {
    throw new Error(`Blocked desktop IPC request from untrusted renderer URL: ${senderUrl}`);
  }
}

function getTitleBarMenuTemplate(menuId: TitleBarMenuId): MenuItemConstructorOptions[] {
  switch (menuId) {
    case "file":
      return [{ role: "close" }, { type: "separator" }, { role: "quit" }];
    case "edit":
      return [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      ];
    case "view":
      return [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ];
    case "window":
      return [{ role: "minimize" }, { role: "close" }];
    case "help":
      return [{ label: "OfficeAgent v0.1", enabled: false }];
  }
}

const MIN_ZOOM_LEVEL = -4;
const MAX_ZOOM_LEVEL = 4;
const ZOOM_STEP = 0.5;

function clampZoomLevel(zoomLevel: number) {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, zoomLevel));
}

const dragIcon = nativeImage
  .createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  )
  .resize({ width: 32, height: 32 });

function getExistingDragFiles(paths: unknown) {
  if (!Array.isArray(paths)) {
    return [];
  }

  return paths
    .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0)
    .map((filePath) => path.resolve(filePath))
    .filter((filePath) => {
      try {
        return existsSync(filePath) && statSync(filePath).isFile();
      } catch {
        return false;
      }
    });
}

function registerFileDragHandler(getMainWindow: () => BrowserWindow | null) {
  ipcMain.on("howcode:start-file-drag", (event, payload) => {
    assertTrustedDesktopIpcEvent(event, getMainWindow);
    const files = getExistingDragFiles(payload?.paths);
    const [firstFile] = files;
    if (!firstFile) {
      return;
    }

    event.sender.startDrag({
      file: firstFile,
      ...(files.length > 1 ? { files } : {}),
      icon: dragIcon,
    });
  });
}

function registerRequestHandlers(
  handlers: DesktopRequestHandlerMap,
  getMainWindow: () => BrowserWindow | null,
) {
  for (const channel of Object.keys(handlers) as DesktopRequestChannel[]) {
    ipcMain.handle(getDesktopRequestIpcChannel(channel), (event, params) => {
      assertTrustedDesktopIpcEvent(event, getMainWindow);
      return handlers[channel](params);
    });
  }
}

export function registerDesktopIpc(
  getMainWindow: () => BrowserWindow | null,
  runtime: DesktopRuntimeModules,
  appUpdater: AppUpdater,
) {
  const handlers: DesktopRequestHandlerMap = {
    showTitleBarMenu: ({ menuId, x, y }) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false };
      }

      Menu.buildFromTemplate(getTitleBarMenuTemplate(menuId)).popup({
        window: mainWindow,
        x: Math.round(x),
        y: Math.round(y),
      });
      return { ok: true };
    },
    runTitleBarCommand: ({ commandId }) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false };
      }

      const webContents = mainWindow.webContents;
      switch (commandId) {
        case "file.close":
        case "window.close":
          mainWindow.close();
          return { ok: true };
        case "file.quit":
          app.quit();
          return { ok: true };
        case "window.minimize":
          mainWindow.minimize();
          return { ok: true };
        case "edit.undo":
          webContents.undo();
          return { ok: true };
        case "edit.redo":
          webContents.redo();
          return { ok: true };
        case "edit.cut":
          webContents.cut();
          return { ok: true };
        case "edit.copy":
          webContents.copy();
          return { ok: true };
        case "edit.paste":
          webContents.paste();
          return { ok: true };
        case "edit.selectAll":
          webContents.selectAll();
          return { ok: true };
        case "view.reload":
          webContents.reload();
          return { ok: true };
        case "view.forceReload":
          webContents.reloadIgnoringCache();
          return { ok: true };
        case "view.toggleDevTools":
          webContents.toggleDevTools();
          return { ok: true };
        case "view.resetZoom":
          webContents.setZoomLevel(0);
          return { ok: true };
        case "view.zoomIn":
          webContents.setZoomLevel(clampZoomLevel(webContents.getZoomLevel() + ZOOM_STEP));
          return { ok: true };
        case "view.zoomOut":
          webContents.setZoomLevel(clampZoomLevel(webContents.getZoomLevel() - ZOOM_STEP));
          return { ok: true };
        case "view.toggleFullscreen":
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
          return { ok: true };
      }
    },
    ...createAppUpdateHandlers(appUpdater),
    ...createPiThreadsHandlers(runtime.piThreads),
    ...createPiPackagesHandlers(runtime.piThreads),
    ...createPiSkillsHandlers(runtime.piSkills),
    ...createSkillCreatorHandlers(runtime.skillCreator),
    ...createTerminalHandlers(runtime.terminalManager),
    ...createSystemHandlers(),
    ...createWindowsSandboxHandlers(),
  };

  registerFileDragHandler(getMainWindow);
  registerRequestHandlers(handlers, getMainWindow);

  runtime.piThreads.subscribeDesktopEvents((event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(getDesktopEventIpcChannel("desktopEvent"), event);
    }
  });

  runtime.terminalManager.subscribeTerminalEvents((event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(getDesktopEventIpcChannel("terminalEvent"), event);
    }
  });

  appUpdater.subscribe((state) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(getDesktopEventIpcChannel("desktopEvent"), {
        type: "app-update",
        state,
      });
    }
  });
}
