import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const runPythonSandboxSmoke =
  process.platform === "win32" && process.env.OFFICE_AGENT_WINDOWS_SANDBOX_PYTHON_SMOKE === "1";

describe.skipIf(!runPythonSandboxSmoke)("OfficeAgent Windows sandbox Python temp handling", () => {
  it("allows Python tempfile-created directories to be writable under the session temp dir", async () => {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    const testId = `python-temp-smoke-${Date.now()}`;
    const cleanupPaths: string[] = [];

    try {
      const [
        {
          ensureOfficeAgentManagedProjectStateLayout,
          ensureOfficeAgentManagedSessionLayout,
          getOfficeAgentManagedRootDir,
          getOfficeAgentManagedSessionEnv,
        },
        { createOfficeAgentSandboxBashOperations, ensureOfficeAgentSandboxShellConfig },
      ] = await Promise.all([
        import(
          pathToFileURL(
            path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts"),
          ).href
        ),
        import(
          pathToFileURL(
            path.resolve(
              process.cwd(),
              "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts",
            ),
          ).href
        ),
      ]);
      const managedRootDir = getOfficeAgentManagedRootDir();
      const projectDir = path.join(managedRootDir, "Projects", testId);
      cleanupPaths.push(projectDir);
      await rm(projectDir, { recursive: true, force: true });
      await mkdir(projectDir, { recursive: true });

      const sessionId = `smoke-${Date.now()}`;
      const [sessionPaths, projectStatePaths] = await Promise.all([
        ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir),
        ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir),
      ]);
      cleanupPaths.push(sessionPaths.sessionDir, projectStatePaths.projectStateDir);
      const env = getOfficeAgentManagedSessionEnv(sessionId, process.env, {
        managedRootDir,
        activeProjectDir: projectDir,
      });
      const shellConfig = await ensureOfficeAgentSandboxShellConfig(managedRootDir);
      if (!shellConfig.pythonRuntime) {
        console.warn("Skipping Python temp smoke because bundled Python is unavailable.");
        return;
      }
      const operations = createOfficeAgentSandboxBashOperations({
        managedRootDir,
        sessionPaths,
        projectStatePaths,
        env,
        shellConfig,
      });
      let output = "";
      const python = [
        "import os, tempfile",
        "directory = tempfile.mkdtemp(prefix='officeagent-acl-')",
        "target = os.path.join(directory, 'metadata.txt')",
        "open(target, 'w', encoding='utf-8').write('ok')",
        "print(open(target, encoding='utf-8').read())",
      ].join(";");

      const result = await operations.exec(`python -c "${python}"`, projectDir, {
        timeout: 120,
        onData: (chunk: Buffer) => {
          output += chunk.toString();
        },
      });

      expect(result.exitCode).toBe(0);
      expect(output).toContain("ok");
      expect(output).not.toContain("PermissionError");
    } finally {
      await Promise.all(
        cleanupPaths.map((target) =>
          rm(target, { recursive: true, force: true }).catch(() => undefined),
        ),
      );
    }
  }, 180_000);
});
