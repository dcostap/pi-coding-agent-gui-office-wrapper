import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform !== "win32")(
  "OfficeAgent Windows sandbox project-scoped package state",
  () => {
    it("lets two sessions in the same project write/read the same project PYTHONUSERBASE", async () => {
      const managedRootDir = await mkdtemp(path.join(tmpdir(), "officeagent-sandbox-project-state-"));
      const projectDir = path.join(managedRootDir, "projects", "project-state-smoke");
      await mkdir(projectDir, { recursive: true });

      try {
        const [runtime, sandbox] = await Promise.all([
          import(
            pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href
          ),
          import(
            pathToFileURL(
              path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts"),
            ).href
          ),
        ]);

        const projectStatePaths = await runtime.ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir);
        const shellConfig = await sandbox.ensureOfficeAgentSandboxShellConfig(managedRootDir);

        const createOperations = async (sessionId: string) => {
          const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir);
          const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, {
            managedRootDir,
            activeProjectDir: projectDir,
          });
          return sandbox.createOfficeAgentSandboxBashOperations({
            managedRootDir,
            sessionPaths,
            projectStatePaths,
            env,
            shellConfig,
          });
        };

        const sessionA = await createOperations("session-a");
        const sessionB = await createOperations("session-b");
        const markerScript = [
          "import os",
          "target = os.path.join(os.environ['PYTHONUSERBASE'], 'officeagent-shared-marker.txt')",
          "os.makedirs(os.path.dirname(target), exist_ok=True)",
          "open(target, 'w', encoding='utf-8').write('shared-ok')",
          "print(target)",
        ].join("; ");
        const readScript = [
          "import os",
          "target = os.path.join(os.environ['PYTHONUSERBASE'], 'officeagent-shared-marker.txt')",
          "print(open(target, encoding='utf-8').read())",
        ].join("; ");

        const writeResult = await sessionA.exec(`python -c "${markerScript}"`, projectDir, {
          timeout: 120,
          onData: () => undefined,
        });
        let output = "";
        const readResult = await sessionB.exec(`python -c "${readScript}"`, projectDir, {
          timeout: 120,
          onData: (chunk: Buffer) => {
            output += chunk.toString();
          },
        });

        expect(writeResult.exitCode).toBe(0);
        expect(readResult.exitCode).toBe(0);
        expect(output).toContain("shared-ok");
      } finally {
        await rm(managedRootDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }, 180_000);
  },
);
