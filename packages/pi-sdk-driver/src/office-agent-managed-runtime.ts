import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  ensureOfficeAgentManagedSessionLayout,
  findOfficeAgentManagedRootForPath,
  getOfficeAgentManagedSessionEnv,
} from "@office-agent/runtime";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import { createAgentSessionRuntimeWithNpmFallback } from "./npm-package-fallback.js";
import { createOfficeAgentSandboxBashOperations } from "./windows-sandbox-helper-client.js";

/**
 * First OfficeAgent-controlled session startup path.
 *
 * This is not the final sandbox boundary. It prepares the same managed-root,
 * per-session env/tool shape that the Rust/AppContainer worker will consume.
 */
export async function createOfficeAgentManagedSessionRuntime(
  options: CreateAgentSessionOptions = {},
) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const managedRootDir = findOfficeAgentManagedRootForPath(cwd);
  if (!managedRootDir) {
    return createAgentSessionRuntimeWithNpmFallback(options);
  }

  const sessionId = options.sessionManager?.getSessionId();
  if (!sessionId) {
    throw new Error("OfficeAgent managed runtime requires a session manager with a session id.");
  }

  const sessionPaths = await ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir);
  const sessionEnv = getOfficeAgentManagedSessionEnv(sessionId, process.env, {
    managedRootDir,
    ...(options.agentDir ? { agentDir: options.agentDir } : {}),
  });

  const sandboxCommandTool = createBashToolDefinition(cwd, {
    operations: createOfficeAgentSandboxBashOperations({
      managedRootDir,
      sessionPaths,
      env: sessionEnv,
    }),
    spawnHook: (context) => ({
      ...context,
      cwd: assertManagedPath(managedRootDir, context.cwd),
      env: {
        ...context.env,
        ...sessionEnv,
      },
    }),
  });
  sandboxCommandTool.label = "OfficeAgent Windows shell";
  sandboxCommandTool.description = [
    "Run a command in the OfficeAgent Windows sandbox shell for the current project. This tool is not Bash.",
    "The backend uses Windows cmd-style syntax to launch real executables, plus OfficeAgent-managed implementations for common file commands that are unreliable inside AppContainer, including dir, where, copy, move, del, mkdir, and rmdir.",
    "Use Windows command syntax. Prefer project tools such as npm, npx, node, python, pip, uv, git, cargo, dotnet, and package scripts when they are available in the sandbox.",
    "Do not assume access to C:\\, user profile folders, Program Files, PowerShell, Git Bash, arbitrary host tools, or POSIX paths.",
    "For complex logic, write a temporary .cmd, .js, or .py file inside the project and run it.",
  ].join(" ");
  sandboxCommandTool.promptSnippet = "Execute OfficeAgent Windows sandbox shell commands in the current project directory (cmd-style syntax, not Bash).";
  sandboxCommandTool.promptGuidelines = [
    "The `bash` tool is currently an OfficeAgent Windows sandbox shell in managed workspaces; use Windows/cmd-style syntax, not Bash syntax.",
    "Common file commands such as dir, where, copy, move, del, mkdir, and rmdir are supported in project paths even when native cmd.exe built-ins are unreliable under AppContainer.",
    "Prefer npm scripts, node, python, pip, uv, git, cargo, dotnet, and other project tools over shell-specific tricks.",
    "Do not assume access to C:\\, user profile folders, Program Files, PowerShell, Git Bash, arbitrary host tools, /tmp, rm -rf, chmod, or POSIX paths.",
    "For multi-step or complex logic, write a temporary .cmd, .js, or .py script inside the project and execute it.",
  ];

  const customTools = [
      createReadToolDefinition(cwd, {
        operations: {
          access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
          readFile: (absolutePath: string) => readFile(assertManagedPath(managedRootDir, absolutePath)),
        },
      }),
      sandboxCommandTool,
      createEditToolDefinition(cwd, {
        operations: {
          access: (absolutePath: string) => access(assertManagedPath(managedRootDir, absolutePath)),
          readFile: (absolutePath: string) => readFile(assertManagedPath(managedRootDir, absolutePath)),
          writeFile: async (absolutePath: string, content: string) => {
            const target = assertManagedPath(managedRootDir, absolutePath);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content, "utf8");
          },
        },
      }),
      createWriteToolDefinition(cwd, {
        operations: {
          mkdir: (dir: string) => mkdir(assertManagedPath(managedRootDir, dir), { recursive: true }).then(() => undefined),
          writeFile: (absolutePath: string, content: string) => writeFile(assertManagedPath(managedRootDir, absolutePath), content, "utf8"),
        },
      }),
      ...(options.customTools ?? []),
    ] as unknown as NonNullable<CreateAgentSessionOptions["customTools"]>;

  const managedOptions: CreateAgentSessionOptions = {
    ...options,
    cwd,
    tools: [],
    customTools,
  };

  return withScopedProcessEnv(sessionEnv, () => createAgentSessionRuntimeWithNpmFallback(managedOptions));
}

function assertManagedPath(managedRootDir: string, pathValue: string): string {
  const absolutePath = resolve(pathValue);
  if (!isPathWithin(managedRootDir, absolutePath)) {
    throw new Error(`OfficeAgent blocked path outside managed root: ${absolutePath}`);
  }
  return absolutePath;
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function withScopedProcessEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
