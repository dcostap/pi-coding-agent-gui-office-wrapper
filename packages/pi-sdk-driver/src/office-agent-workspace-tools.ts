import { copyFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { getOfficeAgentRealUserFolders } from "@office-agent/runtime";
import { Type, type Static } from "typebox";
import { expandOfficeAgentPathPlaceholders } from "./office-agent-path-placeholders.js";

const COPY_FILE_INTO_WORKSPACE_PARAMS = Type.Object({
  sourcePath: Type.String({
    description:
      "Path to an existing user/host file. %OFFICE_AGENT_WORKSPACE% and %OFFICE_AGENT_REAL_USER_*% environment references are expanded.",
  }),
  destinationName: Type.Optional(Type.String({
    description:
      "Optional file name to use in the active workspace. Must be a plain file name, not a path. Defaults to the source file name.",
  })),
  overwrite: Type.Optional(Type.Boolean({
    description:
      "When true, replace an existing workspace file with the same destinationName. Defaults to false; a unique copy name is chosen instead.",
  })),
});

type CopyFileIntoWorkspaceParams = Static<typeof COPY_FILE_INTO_WORKSPACE_PARAMS>;

export interface CopyFileIntoWorkspaceDetails {
  readonly sourcePath: string;
  readonly workspacePath: string;
  readonly workspaceRelativePath: string;
  readonly workspaceEnvPath: string;
  readonly originalFileName: string;
  readonly copiedBytes: number;
  readonly alreadyInWorkspace: boolean;
  readonly renamedForCollision: boolean;
}

export function createCopyFileIntoWorkspaceToolDefinition(options: {
  readonly cwd: string;
  readonly managedRootDir: string;
  readonly env?: NodeJS.ProcessEnv;
}) {
  const env = options.env ?? process.env;
  const workspaceRoot = assertPathWithin(resolve(options.managedRootDir), resolve(options.cwd), "workspace");

  return {
    name: "copy_file_into_workspace",
    label: "Copy file into workspace",
    description:
      "Copy one readable real-user/host file into the active OfficeAgent workspace so the agent can safely inspect, transform, or modify the workspace copy without touching the original.",
    promptSnippet:
      "Copy a real user file into the active OfficeAgent workspace before modifying, transforming, deeply inspecting, or running tools against it.",
    promptGuidelines: [
      "Use OFFICE_AGENT_REAL_USER_* env vars to locate real user folders, including OFFICE_AGENT_REAL_USER_TEMP for the real Windows temp folder. When you need to modify, transform, deeply inspect, or run tools against a user file, first call copy_file_into_workspace and then operate on the returned workspace path.",
      "copy_file_into_workspace creates a copy in OFFICE_AGENT_WORKSPACE/the current project; the original user file is left untouched.",
    ],
    parameters: COPY_FILE_INTO_WORKSPACE_PARAMS,
    async execute(_toolCallId: string, params: CopyFileIntoWorkspaceParams) {
      const sourcePath = resolve(expandOfficeAgentPathPlaceholders(params.sourcePath, env));
      const sourceStats = await stat(sourcePath).catch((error: unknown) => {
        throw new Error(`Source file is not accessible: ${sourcePath}. ${formatUnknownError(error)}`);
      });
      if (!sourceStats.isFile()) {
        throw new Error(`copy_file_into_workspace only copies files, but sourcePath is not a file: ${sourcePath}`);
      }

      const sourceRealPath = await realpath(sourcePath);
      await assertAllowedSourcePath(sourceRealPath, options.managedRootDir, env);

      const destinationName = normalizeDestinationName(params.destinationName ?? basename(sourceRealPath));
      const requestedTargetPath = assertPathWithin(workspaceRoot, join(workspaceRoot, destinationName), "destinationName");
      const { targetPath, renamedForCollision } = params.overwrite === true
        ? { targetPath: requestedTargetPath, renamedForCollision: false }
        : await chooseAvailableTargetPath(requestedTargetPath);

      if (samePath(sourceRealPath, targetPath)) {
        const details = createCopyDetails({
          sourcePath: sourceRealPath,
          targetPath,
          workspaceRoot,
          copiedBytes: sourceStats.size,
          alreadyInWorkspace: true,
          renamedForCollision: false,
        });
        return {
          content: [{
            type: "text" as const,
            text: formatCopyResultText({
              title: "The file is already inside the active workspace as:",
              details,
              sourcePath: sourceRealPath,
            }),
          }],
          details,
        };
      }

      await copyFile(sourceRealPath, targetPath);
      const copiedStats = await stat(targetPath);
      const details = createCopyDetails({
        sourcePath: sourceRealPath,
        targetPath,
        workspaceRoot,
        copiedBytes: copiedStats.size,
        alreadyInWorkspace: false,
        renamedForCollision,
      });
      return {
        content: [{
          type: "text" as const,
          text: formatCopyResultText({
            title: "Copied into workspace as:",
            details,
            sourcePath: sourceRealPath,
          }),
        }],
        details,
      };
    },
  };
}

function createCopyDetails(input: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly workspaceRoot: string;
  readonly copiedBytes: number;
  readonly alreadyInWorkspace: boolean;
  readonly renamedForCollision: boolean;
}): CopyFileIntoWorkspaceDetails {
  const workspaceRelativePath = toWorkspaceRelativePath(input.workspaceRoot, input.targetPath);
  return {
    sourcePath: input.sourcePath,
    workspacePath: input.targetPath,
    workspaceRelativePath,
    workspaceEnvPath: toWorkspaceEnvPath(workspaceRelativePath),
    originalFileName: basename(input.sourcePath),
    copiedBytes: input.copiedBytes,
    alreadyInWorkspace: input.alreadyInWorkspace,
    renamedForCollision: input.renamedForCollision,
  };
}

function formatCopyResultText(input: {
  readonly title: string;
  readonly details: CopyFileIntoWorkspaceDetails;
  readonly sourcePath: string;
}): string {
  return [
    input.title,
    "",
    input.details.workspaceRelativePath,
    "",
    "Use this path in commands because commands start in the active workspace.",
    "If you need an absolute path, use:",
    input.details.workspaceEnvPath,
    "",
    `Original file left untouched: ${input.sourcePath}`,
  ].join("\n");
}

function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  const relativePath = relative(resolve(workspaceRoot), resolve(targetPath)).replaceAll("/", "\\");
  return `.\\${relativePath}`;
}

function toWorkspaceEnvPath(workspaceRelativePath: string): string {
  const withoutDotPrefix = workspaceRelativePath.replace(/^\.\\/, "");
  return `%OFFICE_AGENT_WORKSPACE%\\${withoutDotPrefix}`;
}

function normalizeDestinationName(input: string): string {
  const name = input.trim();
  if (!name) {
    throw new Error("destinationName must not be empty.");
  }
  if (isAbsolute(name) || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("destinationName must be a plain file name, not a path.");
  }
  if (/[<>:"|?*\x00-\x1F]/.test(name)) {
    throw new Error(`destinationName contains characters that are invalid for Windows file names: ${name}`);
  }
  return name;
}

async function assertAllowedSourcePath(sourceRealPath: string, managedRootDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const folders = getOfficeAgentRealUserFolders(env);
  const candidateRoots = [
    managedRootDir,
    folders.desktop,
    folders.documents,
    folders.downloads,
    folders.pictures,
    folders.videos,
    folders.music,
    folders.temp,
  ];
  const allowedRoots: string[] = [];
  for (const root of candidateRoots) {
    try {
      allowedRoots.push(await realpath(root));
    } catch {
      // Missing redirected/disabled known folders are not allowed for this session.
    }
  }
  if (allowedRoots.some((root) => isPathWithin(root, sourceRealPath))) {
    return;
  }
  throw new Error(
    [
      `Source file is outside OfficeAgent readable roots: ${sourceRealPath}`,
      "Allowed roots are the active OfficeAgent managed tree plus real user Desktop, Documents, Downloads, Pictures, Videos, Music, and Temp folders.",
      "Use OFFICE_AGENT_REAL_USER_DESKTOP, OFFICE_AGENT_REAL_USER_DOCUMENTS, OFFICE_AGENT_REAL_USER_DOWNLOADS, OFFICE_AGENT_REAL_USER_PICTURES, OFFICE_AGENT_REAL_USER_VIDEOS, OFFICE_AGENT_REAL_USER_MUSIC, or OFFICE_AGENT_REAL_USER_TEMP to locate user files.",
    ].join("\n"),
  );
}

async function chooseAvailableTargetPath(requestedTargetPath: string): Promise<{
  readonly targetPath: string;
  readonly renamedForCollision: boolean;
}> {
  if (!await pathExists(requestedTargetPath)) {
    return { targetPath: requestedTargetPath, renamedForCollision: false };
  }

  const parsed = parse(requestedTargetPath);
  const extension = extname(parsed.base);
  const stem = extension ? parsed.base.slice(0, -extension.length) : parsed.base;
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidate = join(parsed.dir, `${stem}${suffix}${extension}`);
    if (!await pathExists(candidate)) {
      return { targetPath: candidate, renamedForCollision: true };
    }
  }
  throw new Error(`Could not choose an unused workspace file name for ${requestedTargetPath}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function assertPathWithin(rootPath: string, candidatePath: string, label: string): string {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  if (!isPathWithin(root, candidate)) {
    throw new Error(`${label} must stay inside the active OfficeAgent workspace: ${candidate}`);
  }
  return candidate;
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
