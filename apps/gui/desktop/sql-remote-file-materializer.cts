import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const SQL_TOOL_FILES_SUBDIR = "sql";
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const REMOTE_DOWNLOAD_URL_PATTERN = /^files\/[A-Za-z0-9._~-]+$/;

export interface SqlMaterializedFileDetails {
  readonly localPath: string;
  readonly workspaceRelativePath: string;
  readonly format: string;
  readonly mimeType?: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly source: {
    readonly gatewayFileId?: string;
  };
}

export interface MaterializeSqlRemoteFilesOptions {
  readonly workspaceRoot: string;
  readonly toolFilesRoot: string;
  readonly sqlEndpointUrl: string;
  readonly gatewayToken: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
}

export async function materializeSqlRemoteFilesIfPresent<TToolResult>(
  toolResult: TToolResult,
  options: MaterializeSqlRemoteFilesOptions,
): Promise<TToolResult> {
  if (!isRecord(toolResult)) return toolResult;
  const details = isRecord(toolResult.details) ? toolResult.details : undefined;
  const remoteFiles = Array.isArray(details?.remoteFiles) ? details.remoteFiles : [];
  if (remoteFiles.length === 0) return toolResult;

  const materializedFiles: SqlMaterializedFileDetails[] = [];
  for (const remoteFile of remoteFiles) {
    materializedFiles.push(await materializeSqlRemoteFile(remoteFile, options));
  }

  const action = typeof details?.action === "string" ? details.action : "query";
  return {
    ...toolResult,
    content: [{
      type: "text" as const,
      text: formatMaterializedSqlResultText(action, materializedFiles),
    }],
    details: {
      ...(details ?? {}),
      materializedFiles,
    },
  };
}

async function materializeSqlRemoteFile(
  remoteFile: unknown,
  options: MaterializeSqlRemoteFilesOptions,
): Promise<SqlMaterializedFileDetails> {
  if (!isRecord(remoteFile)) {
    throw new Error("SQL gateway returned an invalid remote file descriptor.");
  }
  const gatewayFileId = typeof remoteFile.id === "string" ? remoteFile.id : undefined;
  const downloadUrl = requirePlainString(remoteFile.downloadUrl, "remoteFiles[].downloadUrl");
  const format = normalizeFileFormat(remoteFile.format);
  const mimeType = typeof remoteFile.mimeType === "string" ? remoteFile.mimeType : undefined;
  const expectedBytes = typeof remoteFile.bytes === "number" && Number.isSafeInteger(remoteFile.bytes)
    ? remoteFile.bytes
    : undefined;
  const expectedSha256 = typeof remoteFile.sha256 === "string" ? remoteFile.sha256.toLowerCase() : undefined;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  if (expectedBytes !== undefined && expectedBytes > maxBytes) {
    throw new Error("SQL remote file exceeds the OfficeAgent materialization size limit.");
  }

  const destinationDir = await ensureSafeDirectory(
    options.workspaceRoot,
    join(options.toolFilesRoot, SQL_TOOL_FILES_SUBDIR),
  );
  const fileName = sanitizeMaterializedFileName(
    typeof remoteFile.fileName === "string" ? remoteFile.fileName : undefined,
    format,
    gatewayFileId,
  );
  const requestedTargetPath = assertPathWithin(destinationDir, join(destinationDir, fileName), "SQL output file");
  const targetPath = await chooseAvailableTargetPath(requestedTargetPath);
  const tempPath = assertPathWithin(
    destinationDir,
    join(destinationDir, `.officeagent-download-${randomUUID()}.tmp`),
    "temporary SQL output file",
  );

  try {
    const downloaded = await downloadRemoteFileToTemp({
      url: resolveRemoteDownloadUrl(options.sqlEndpointUrl, downloadUrl),
      tempPath,
      gatewayToken: options.gatewayToken,
      headers: options.headers,
      signal: options.signal,
      maxBytes,
    });
    if (expectedBytes !== undefined && downloaded.bytes !== expectedBytes) {
      throw new Error("Downloaded SQL remote file size did not match the gateway descriptor.");
    }
    if (expectedSha256 && downloaded.sha256.toLowerCase() !== expectedSha256) {
      throw new Error("Downloaded SQL remote file hash did not match the gateway descriptor.");
    }

    await link(tempPath, targetPath);
    await rm(tempPath, { force: true });

    const finalStats = await stat(targetPath);
    const workspaceRelativePath = await toWorkspaceRelativePath(options.workspaceRoot, targetPath);
    return {
      localPath: targetPath,
      workspaceRelativePath,
      format,
      ...(mimeType ? { mimeType } : {}),
      bytes: finalStats.size,
      sha256: downloaded.sha256,
      source: {
        ...(gatewayFileId ? { gatewayFileId } : {}),
      },
    };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (isFileExistsError(error)) {
      throw new Error("Could not choose a unique local SQL output file name.");
    }
    throw error;
  }
}

async function downloadRemoteFileToTemp(options: {
  readonly url: string;
  readonly tempPath: string;
  readonly gatewayToken: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly maxBytes: number;
}): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const response = await fetch(options.url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${options.gatewayToken}`,
      ...(options.headers ?? {}),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`SQL remote file download failed with HTTP ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("SQL remote file download returned an empty response body.");
  }

  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > options.maxBytes) {
        callback(new Error("SQL remote file exceeded the OfficeAgent materialization size limit."));
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as never),
    meter,
    createWriteStream(options.tempPath, { flags: "wx" }),
  );
  return { bytes, sha256: hash.digest("hex") };
}

async function ensureSafeDirectory(workspaceRoot: string, targetDir: string): Promise<string> {
  const workspaceResolved = resolve(workspaceRoot);
  const workspaceReal = await realpath(workspaceResolved);
  const targetResolved = assertPathWithin(workspaceResolved, resolve(targetDir), "tool files directory");
  const relativeParts = relative(workspaceResolved, targetResolved)
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".");

  let current = workspaceResolved;
  for (const part of relativeParts) {
    current = join(current, part);
    await ensurePlainDirectoryComponent(current, workspaceReal);
  }

  const targetReal = await realpath(targetResolved);
  if (!isPathWithin(workspaceReal, targetReal)) {
    throw new Error("Resolved tool files directory escaped the active workspace.");
  }
  return targetReal;
}

async function ensurePlainDirectoryComponent(componentPath: string, workspaceReal: string): Promise<void> {
  const beforeStats = await lstat(componentPath).catch((error: unknown) => {
    if (isNotFoundError(error)) return null;
    throw error;
  });
  if (!beforeStats) {
    await mkdir(componentPath);
  }

  const stats = await lstat(componentPath);
  if (stats.isSymbolicLink()) {
    throw new Error("Tool files directory contains a symlink or junction component.");
  }
  if (!stats.isDirectory()) {
    throw new Error("Tool files directory contains a non-directory component.");
  }
  const realComponent = await realpath(componentPath);
  if (!isPathWithin(workspaceReal, realComponent)) {
    throw new Error("Tool files directory component escaped the active workspace.");
  }
}

function resolveRemoteDownloadUrl(sqlEndpointUrl: string, downloadUrl: string): string {
  if (!REMOTE_DOWNLOAD_URL_PATTERN.test(downloadUrl)) {
    throw new Error("SQL gateway returned an invalid remote file download URL.");
  }
  const base = sqlEndpointUrl.endsWith("/") ? sqlEndpointUrl : `${sqlEndpointUrl}/`;
  return new URL(downloadUrl, base).toString();
}

async function chooseAvailableTargetPath(requestedTargetPath: string): Promise<string> {
  if (!await pathExists(requestedTargetPath)) return requestedTargetPath;

  const parsed = parse(requestedTargetPath);
  const extension = extname(parsed.base);
  const stem = extension ? parsed.base.slice(0, -extension.length) : parsed.base;
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidate = join(parsed.dir, `${stem}${suffix}${extension}`);
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error("Could not choose a unique local SQL output file name.");
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await lstat(pathValue);
    return true;
  } catch {
    return false;
  }
}

function sanitizeMaterializedFileName(input: string | undefined, format: string, gatewayFileId: string | undefined): string {
  const extension = format === "jsonl" ? ".jsonl" : `.${format}`;
  const fallback = gatewayFileId ? `sqlserver-${gatewayFileId}${extension}` : `sqlserver-output-${randomUUID()}${extension}`;
  const rawBase = basename(String(input || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  let base = rawBase.trim().replace(/[ .]+$/g, "");
  if (!base || base === "." || base === "..") base = fallback;

  let parsed = parse(base);
  if (!hasExpectedExtension(parsed.ext, format)) {
    base += extension;
    parsed = parse(base);
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(parsed.name)) {
    base = `${parsed.name}_${parsed.ext}`;
  }
  if (base.length > 180) {
    const ext = extname(base);
    const stem = base.slice(0, -ext.length).slice(0, Math.max(1, 180 - ext.length));
    base = `${stem}${ext}`;
  }
  return base;
}

function normalizeFileFormat(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["json", "csv", "jsonl"].includes(normalized) ? normalized : "json";
}

function hasExpectedExtension(extension: string, format: string): boolean {
  const normalized = extension.toLowerCase();
  if (format === "jsonl") return normalized === ".jsonl" || normalized === ".ndjson";
  return normalized === `.${format}`;
}

async function toWorkspaceRelativePath(workspaceRoot: string, localPath: string): Promise<string> {
  const workspaceReal = await realpath(resolve(workspaceRoot));
  const localReal = await realpath(resolve(localPath));
  const relativePath = relative(workspaceReal, localReal).replaceAll("/", "\\");
  return `.\\${relativePath}`;
}

function formatMaterializedSqlResultText(action: string, files: readonly SqlMaterializedFileDetails[]): string {
  const fileLines = files.map((file) => file.workspaceRelativePath);
  return [
    `SQL Server read-only tool completed action: ${action}.`,
    "",
    files.length === 1
      ? "The full result was saved locally in the active workspace:"
      : "The full results were saved locally in the active workspace:",
    ...fileLines,
    "",
    "Use these paths with read/bash from the active workspace.",
  ].join("\n");
}

function assertPathWithin(rootPath: string, candidatePath: string, label: string): string {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  if (!isPathWithin(root, candidate)) {
    throw new Error(`${label} must stay inside the active OfficeAgent workspace.`);
  }
  return candidate;
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function requirePlainString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isFileExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
