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
  sandboxCommandTool.label = "Windows shell";
  sandboxCommandTool.description = [
    "Run a Windows cmd.exe command in the sandboxed project directory. This tool is not Bash.",
    "Use Windows cmd syntax. Prefer native project tools such as npm, npx, node, python, py, git, cargo, dotnet, and package scripts.",
    "Do not use Bash-only syntax such as export, VAR=value command, $(...), heredocs, /tmp, rm -rf, sed, grep, chmod, or POSIX paths unless OfficeAgent explicitly reports a real Bash backend.",
    "For complex logic, write a temporary .cmd, .ps1, .js, or .py file inside the project and run it.",
  ].join(" ");
  sandboxCommandTool.promptSnippet = "Execute Windows cmd.exe commands in the sandboxed project directory (not Bash).";
  sandboxCommandTool.promptGuidelines = [
    "The `bash` tool is currently backed by Windows cmd.exe in OfficeAgent managed workspaces; use Windows command syntax, not Bash syntax.",
    "Prefer npm scripts, node, python/py, git, cargo, dotnet, and other project tools over shell-specific tricks.",
    "For multi-step or complex logic, write a temporary .cmd, .ps1, .js, or .py script inside the project and execute it.",
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
