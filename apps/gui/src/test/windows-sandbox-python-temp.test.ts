import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "win32")(
  "OfficeAgent Windows sandbox Python temp handling",
  () => {
    it("allows Python tempfile-created directories to be writable under the session temp dir", async () => {
      const managedRootDir = await mkdtemp(path.join(tmpdir(), "officeagent-python-temp-smoke-"));
      const projectDir = path.join(managedRootDir, "projects", "python-temp-smoke");
      await mkdir(projectDir, { recursive: true });

      try {
        const [
          {
            ensureOfficeAgentManagedProjectStateLayout,
            ensureOfficeAgentManagedSessionLayout,
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
        const sessionId = `smoke-${Date.now()}`;
        const [sessionPaths, projectStatePaths] = await Promise.all([
          ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir),
          ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir),
        ]);
        const env = getOfficeAgentManagedSessionEnv(sessionId, process.env, {
          managedRootDir,
          activeProjectDir: projectDir,
        });
        const shellConfig = await ensureOfficeAgentSandboxShellConfig(managedRootDir);
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
        await rm(managedRootDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }, 180_000);
  },
);
