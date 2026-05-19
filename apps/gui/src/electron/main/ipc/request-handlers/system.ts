import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { app, clipboard, dialog, shell } from "electron";
import { getAttachmentKind } from "../../../../../shared/composer-attachments";
import { getSafeExternalUrl } from "../../../../../shared/external-url";
import {
  listComposerAttachmentEntries,
  normalizeDialogFilePaths,
} from "../../../../desktop-host/composer-attachments";
import { readNativeClipboardFilePaths, writeNativeClipboardFilePaths } from "./clipboard-file-paths";
import { getDesktopWorkingDirectory } from "../../../../../shared/desktop-working-directory";
import type { DesktopRequestHandlerMap } from "../../../../../shared/desktop-ipc";

type SystemRequestHandlers = Pick<
  DesktopRequestHandlerMap,
  | "clearClipboardImages"
  | "pickComposerAttachments"
  | "readClipboardSnapshot"
  | "readClipboardFilePaths"
  | "readClipboardImage"
  | "getAttachmentKindsForPaths"
  | "listComposerAttachmentEntries"
  | "listProjectFileEntries"
  | "getProjectFilePreview"
  | "openExternal"
  | "openPath"
  | "revealPath"
  | "copyTextToClipboard"
  | "copyFilesToClipboard"
  | "saveTextToDownloads"
>;

const clipboardImageTempDir = path.join(tmpdir(), "howcode-clipboard-images");
const hiddenProjectFileNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".officeagent",
  ".cache",
  ".vite",
  ".next",
  "node_modules",
  "dist",
  "build",
]);
const maxClipboardImagePixels = 32_000_000;
const maxClipboardImageBytes = 25 * 1024 * 1024;
const maxProjectPreviewTextBytes = 256 * 1024;
const maxProjectPreviewImageBytes = 12 * 1024 * 1024;

const projectPreviewImageMimeTypes: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const projectPreviewTextExtensions = new Set([
  ".bat",
  ".c",
  ".cc",
  ".cmd",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".less",
  ".log",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const projectPreviewTextFileNames = new Set([
  ".gitignore",
  ".npmrc",
  "dockerfile",
  "license",
  "makefile",
  "readme",
]);

function isClipboardImageWithinLimits(size: { width: number; height: number }) {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  return width > 0 && height > 0 && width * height <= maxClipboardImagePixels;
}

async function writeClipboardImageToTempFile(buffer: Buffer) {
  if (buffer.length === 0 || buffer.length > maxClipboardImageBytes) {
    return null;
  }

  await mkdir(clipboardImageTempDir, { recursive: true, mode: 0o700 });

  const filePath = path.join(clipboardImageTempDir, `howcode-clipboard-${randomUUID()}.png`);
  await writeFile(filePath, buffer, { mode: 0o600 });
  return filePath;
}

async function clearClipboardImageTempFiles() {
  let entries: Array<{ isFile(): boolean; name: string }>;
  try {
    entries = await readdir(clipboardImageTempDir, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { clearedCount: 0, clearFailedCount: 0 };
    }

    return { clearedCount: 0, clearFailedCount: 1 };
  }

  const targets = entries.filter(
    (entry) =>
      entry.isFile() && entry.name.startsWith("howcode-clipboard-") && entry.name.endsWith(".png"),
  );
  const results = await Promise.allSettled(
    targets.map((entry) => rm(path.join(clipboardImageTempDir, entry.name), { force: true })),
  );
  return {
    clearedCount: results.filter((result) => result.status === "fulfilled").length,
    clearFailedCount: results.filter((result) => result.status === "rejected").length,
  };
}

function isNodeErrorWithCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isPathWithinRoot(candidatePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function listProjectFileEntriesForDirectory(request: {
  projectId: string;
  directoryPath?: string | null;
}) {
  const rootPath = path.resolve(request.projectId || getDesktopWorkingDirectory());
  const requestedDirectoryPath = path.resolve(request.directoryPath || rootPath);
  const directoryPath = isPathWithinRoot(requestedDirectoryPath, rootPath)
    ? requestedDirectoryPath
    : rootPath;
  let directoryEntries: Dirent[];
  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { rootPath, directoryPath, entries: [] };
    }
    throw error;
  }

  const entryResults = await Promise.allSettled(
    directoryEntries
      .filter((entry) => !hiddenProjectFileNames.has(entry.name))
      .map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        const stats = await stat(entryPath);
        return {
          path: entryPath,
          name: entry.name,
          kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
          modifiedMs: stats.mtimeMs,
          size: entry.isDirectory() ? null : stats.size,
        };
      }),
  );
  const entries = entryResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  return { rootPath, directoryPath, entries };
}

function getProjectPreviewTextSupport(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (projectPreviewTextExtensions.has(extension)) return true;
  return projectPreviewTextFileNames.has(fileName.toLowerCase());
}

async function getProjectFilePreview(request: { projectId: string; filePath: string }) {
  const rootPath = path.resolve(request.projectId || getDesktopWorkingDirectory());
  const filePath = path.resolve(request.filePath);
  if (!isPathWithinRoot(filePath, rootPath)) {
    return null;
  }

  const stats = await stat(filePath);
  if (!stats.isFile()) {
    return null;
  }

  const name = path.basename(filePath);
  const base = {
    filePath,
    name,
    size: stats.size,
    modifiedMs: stats.mtimeMs,
  };
  const extension = path.extname(name).toLowerCase();
  const imageMimeType = projectPreviewImageMimeTypes[extension];

  if (imageMimeType) {
    if (stats.size > maxProjectPreviewImageBytes) {
      return { kind: "unsupported" as const, ...base, reason: "Image is too large to preview." };
    }

    const data = await readFile(filePath);
    return {
      kind: "image" as const,
      ...base,
      mimeType: imageMimeType,
      dataUrl: `data:${imageMimeType};base64,${data.toString("base64")}`,
    };
  }

  if (getProjectPreviewTextSupport(name)) {
    const limit = maxProjectPreviewTextBytes;
    const file = await open(filePath, "r");
    try {
      const length = Math.min(stats.size, limit + 1);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, 0);
      const truncated = bytesRead > limit || stats.size > limit;
      return {
        kind: "text" as const,
        ...base,
        text: buffer.subarray(0, Math.min(bytesRead, limit)).toString("utf8"),
        truncated,
      };
    } finally {
      await file.close();
    }
  }

  return { kind: "unsupported" as const, ...base };
}

async function writeUniqueTextFile(directoryPath: string, fileName: string, content: string) {
  const parsed = path.parse(fileName);
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? fileName : `${parsed.name}-${index + 1}${parsed.ext}`;
    const candidatePath = path.join(directoryPath, candidateName);
    try {
      const file = await open(candidatePath, "wx", 0o600);
      try {
        await file.writeFile(content, "utf8");
      } finally {
        await file.close();
      }
      return candidatePath;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not find an unused file name in Downloads.");
}

export function createSystemHandlers(): SystemRequestHandlers {
  return {
    clearClipboardImages: clearClipboardImageTempFiles,
    pickComposerAttachments: async ({ projectId }) => {
      const result = await dialog.showOpenDialog({
        defaultPath: projectId ?? getDesktopWorkingDirectory(),
        properties: ["openFile", "multiSelections"],
      });

      if (result.canceled) {
        return [];
      }

      const normalizedFilePaths = await normalizeDialogFilePaths(result.filePaths);

      return normalizedFilePaths
        .filter((filePath) => filePath.length > 0)
        .map((filePath) => ({
          path: filePath,
          name: filePath.split(/[\\/]/).pop() ?? filePath,
          kind: getAttachmentKind(filePath),
        }));
    },
    readClipboardSnapshot: ({ formats: requestedFormats }) => {
      const formats = Array.isArray(requestedFormats)
        ? requestedFormats.filter((format) => typeof format === "string" && format.length > 0)
        : clipboard.availableFormats();
      const valuesByFormat = Object.fromEntries(
        formats.map((format) => {
          try {
            return [format, clipboard.read(format)] as const;
          } catch {
            return [format, ""] as const;
          }
        }),
      );

      if (!valuesByFormat["text/plain"]) {
        valuesByFormat["text/plain"] = clipboard.readText();
      }

      return { formats, valuesByFormat };
    },
    readClipboardFilePaths: () => readNativeClipboardFilePaths(),
    readClipboardImage: async () => {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return null;
      }

      if (!isClipboardImageWithinLimits(image.getSize())) {
        return null;
      }

      const filePath = await writeClipboardImageToTempFile(image.toPNG());
      if (!filePath) {
        return null;
      }

      return { path: filePath, mimeType: "image/png" };
    },
    getAttachmentKindsForPaths: async ({ paths }) => {
      const uniquePaths = [...new Set(Array.isArray(paths) ? paths : [])].filter(
        (path): path is string => typeof path === "string" && path.trim().length > 0,
      );

      const entries = await Promise.all(
        uniquePaths.map(async (path) => {
          try {
            const stats = await stat(path);
            return [path, stats.isDirectory() ? "directory" : getAttachmentKind(path)] as const;
          } catch {
            return [path, null] as const;
          }
        }),
      );

      return Object.fromEntries(entries);
    },
    listComposerAttachmentEntries: (request) => listComposerAttachmentEntries(request),
    listProjectFileEntries: (request) => listProjectFileEntriesForDirectory(request),
    getProjectFilePreview,
    openExternal: async ({ url }) => {
      const safeUrl = getSafeExternalUrl(url);
      if (!safeUrl) {
        return { ok: false };
      }

      try {
        await shell.openExternal(safeUrl);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    openPath: async ({ path: targetPath }) => {
      try {
        const resolvedPath = path.resolve(targetPath);
        await stat(resolvedPath);
        const errorMessage = await shell.openPath(resolvedPath);
        return { ok: errorMessage === "" };
      } catch {
        return { ok: false };
      }
    },
    revealPath: async ({ path: targetPath }) => {
      try {
        const resolvedPath = path.resolve(targetPath);
        await stat(resolvedPath);
        shell.showItemInFolder(resolvedPath);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    copyTextToClipboard: ({ text }) => {
      try {
        clipboard.writeText(text);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    copyFilesToClipboard: async ({ paths }) => ({
      ok: await writeNativeClipboardFilePaths(
        Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [],
      ),
    }),
    saveTextToDownloads: async ({ fileName, content }) => {
      const safeFileName = fileName
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/^\.+/, "")
        .trim();
      if (!safeFileName) return { ok: false, error: "Invalid file name." };
      const downloadsPath = app.getPath("downloads");
      try {
        const targetPath = await writeUniqueTextFile(downloadsPath, safeFileName, content);
        return { ok: true, path: targetPath };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
