import path from "node:path";
import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import type { ComposerAttachment } from "../../shared/desktop-contracts";
import { getSafeExternalUrl, isSafeExternalUrl } from "../../shared/external-url";
import { getAttachmentKind, normalizeComposerAttachments } from "../../shared/composer-attachments";

const maxConcurrentAttachmentStats = 8;

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

type StatLike = Pick<Awaited<ReturnType<typeof stat>>, "isDirectory">;

type AttachmentStat = (path: string) => Promise<StatLike>;

type AttachmentPlatform = NodeJS.Platform;

type PreparedLocalAttachmentPath = {
  normalizedPath: string;
  statPath: string;
};

function getLocalAttachmentPathParts(
  attachmentPath: string,
  platform: AttachmentPlatform,
): PreparedLocalAttachmentPath | null {
  const trimmedPath = attachmentPath.trim();
  if (!trimmedPath || isSafeExternalUrl(trimmedPath) || hasControlCharacters(trimmedPath)) {
    return null;
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmedPath)) {
    const normalizedPath = path.win32.normalize(trimmedPath);
    return normalizedPath === path.win32.parse(normalizedPath).root
      ? null
      : { normalizedPath, statPath: trimmedPath };
  }

  if (trimmedPath.startsWith("\\\\") || (platform === "win32" && trimmedPath.startsWith("//"))) {
    const normalizedPath = path.win32.normalize(trimmedPath);
    return normalizedPath === path.win32.parse(normalizedPath).root
      ? null
      : { normalizedPath, statPath: trimmedPath };
  }

  if (trimmedPath.startsWith("/")) {
    const normalizedPath = path.posix.normalize(trimmedPath);
    return normalizedPath === "/" ? null : { normalizedPath, statPath: trimmedPath };
  }

  return null;
}

async function resolveLocalAttachmentKind(
  attachmentPath: string,
  statAttachmentPath: AttachmentStat,
): Promise<ComposerAttachment["kind"] | null> {
  try {
    const stats = await statAttachmentPath(attachmentPath);
    return stats.isDirectory() ? "directory" : getAttachmentKind(attachmentPath);
  } catch {
    return null;
  }
}

async function statLocalAttachmentPaths(
  localPaths: PreparedLocalAttachmentPath[],
  statAttachmentPath: AttachmentStat,
) {
  const localAttachmentKinds = new Map<string, ComposerAttachment["kind"] | null>();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < localPaths.length) {
      const attachmentPath = localPaths[nextIndex];
      nextIndex += 1;

      if (!attachmentPath) {
        continue;
      }

      localAttachmentKinds.set(
        attachmentPath.normalizedPath,
        await resolveLocalAttachmentKind(attachmentPath.statPath, statAttachmentPath),
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrentAttachmentStats, localPaths.length) }, () =>
      worker(),
    ),
  );

  return localAttachmentKinds;
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string) {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function getUniqueAttachmentName(fileName: string, usedNames: Set<string>) {
  const parsed = path.parse(fileName.trim() || "attachment");
  const baseName = parsed.name || "attachment";
  const extension = parsed.ext;

  for (let index = 0; index < 10_000; index += 1) {
    const candidateName = index === 0 ? `${baseName}${extension}` : `${baseName} ${index + 1}${extension}`;
    const key = candidateName.toLocaleLowerCase();
    if (!usedNames.has(key)) {
      usedNames.add(key);
      return candidateName;
    }
  }

  throw new Error(`Could not allocate a unique attachment name for ${fileName}.`);
}

async function reserveUniqueAttachmentPath(targetRootPath: string, fileName: string, usedNames: Set<string>) {
  await mkdir(targetRootPath, { recursive: true });
  const parsed = path.parse(getUniqueAttachmentName(fileName, usedNames));

  for (let index = 0; index < 10_000; index += 1) {
    const candidateName = index === 0 ? `${parsed.name}${parsed.ext}` : `${parsed.name} ${index + 1}${parsed.ext}`;
    const candidatePath = path.join(targetRootPath, candidateName);
    try {
      const file = await open(candidatePath, "wx", 0o600);
      await file.close();
      return candidatePath;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        usedNames.add(candidateName.toLocaleLowerCase());
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Could not allocate a unique attachment path for ${fileName}.`);
}

async function copyAttachmentToProjectRoot(
  attachment: ComposerAttachment,
  options: {
    targetRootPath: string;
    usedNames: Set<string>;
  },
): Promise<ComposerAttachment | null> {
  if (attachment.kind === "directory") {
    return null;
  }

  const sourcePath = path.resolve(attachment.path);
  const targetRootPath = path.resolve(options.targetRootPath);
  if (isPathInsideDirectory(sourcePath, targetRootPath)) {
    return { ...attachment, path: sourcePath, name: path.basename(sourcePath) || attachment.name };
  }

  const targetPath = await reserveUniqueAttachmentPath(
    targetRootPath,
    path.basename(sourcePath) || attachment.name || "attachment",
    options.usedNames,
  );

  try {
    await copyFile(sourcePath, targetPath);
  } catch (error) {
    try {
      await rm(targetPath, { force: true });
    } catch {
      // Best-effort cleanup of the reservation file; preserve the original copy error.
    }
    throw error;
  }

  return {
    ...attachment,
    path: targetPath,
    name: path.basename(targetPath),
    kind: getAttachmentKind(targetPath),
  };
}

export async function normalizeComposerSendAttachments(
  attachments: ComposerAttachment[],
  options?: {
    statAttachmentPath?: AttachmentStat;
    platform?: AttachmentPlatform;
    targetRootPath?: string | null;
  },
): Promise<{ attachments: ComposerAttachment[]; rejected: boolean }> {
  const statAttachmentPath = options?.statAttachmentPath ?? stat;
  const platform = options?.platform ?? process.platform;
  const localPathsByNormalizedPath = new Map<string, PreparedLocalAttachmentPath>();

  for (const attachment of attachments) {
    const pathParts = getLocalAttachmentPathParts(attachment.path, platform);
    if (pathParts) {
      localPathsByNormalizedPath.set(pathParts.normalizedPath, pathParts);
    }
  }

  const localAttachmentKinds = await statLocalAttachmentPaths(
    [...localPathsByNormalizedPath.values()],
    statAttachmentPath,
  );
  let rejected = false;

  const normalizedAttachments = normalizeComposerAttachments(
    attachments.map((attachment) => {
      const trimmedPath = attachment.path.trim();
      const safeExternalUrl = getSafeExternalUrl(trimmedPath);
      if (safeExternalUrl) {
        return { ...attachment, path: safeExternalUrl };
      }

      const pathParts = getLocalAttachmentPathParts(attachment.path, platform);
      return pathParts ? { ...attachment, path: pathParts.normalizedPath } : attachment;
    }),
    {
      resolveAttachmentKind: (attachmentPath) => {
        const pathParts = getLocalAttachmentPathParts(attachmentPath, platform);
        if (!pathParts) {
          rejected = true;
          return null;
        }

        const kind = localAttachmentKinds.get(pathParts.normalizedPath) ?? null;
        if (kind === null || kind === "directory") {
          rejected = true;
          return null;
        }

        return kind;
      },
    },
  );

  if (rejected || normalizedAttachments.length === 0 || !options?.targetRootPath) {
    return { attachments: normalizedAttachments, rejected };
  }

  const usedNames = new Set<string>();
  const preparedAttachments: ComposerAttachment[] = [];

  for (const attachment of normalizedAttachments) {
    if (isSafeExternalUrl(attachment.path)) {
      preparedAttachments.push(attachment);
      continue;
    }

    try {
      const copiedAttachment = await copyAttachmentToProjectRoot(attachment, {
        targetRootPath: options.targetRootPath,
        usedNames,
      });
      if (!copiedAttachment) {
        rejected = true;
        continue;
      }
      preparedAttachments.push(copiedAttachment);
    } catch {
      rejected = true;
    }
  }

  return { attachments: preparedAttachments, rejected };
}
