import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const runPythonSandboxSmoke =
  process.platform === "win32" && process.env.OFFICE_AGENT_WINDOWS_SANDBOX_PYTHON_SMOKE === "1";

describe.skipIf(!runPythonSandboxSmoke)(
  "OfficeAgent Windows sandbox project-scoped package state",
  () => {
    it("lets two sessions in the same project write/read the same project PYTHONUSERBASE", async () => {
      process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
      const testId = `project-state-smoke-${Date.now()}`;
      const cleanupPaths: string[] = [];

      try {
        const [runtime, sandbox] = await Promise.all([
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
        const managedRootDir = runtime.getOfficeAgentManagedRootDir();
        const projectDir = path.join(managedRootDir, "Projects", testId);
        cleanupPaths.push(projectDir);
        await rm(projectDir, { recursive: true, force: true });
        await mkdir(projectDir, { recursive: true });

        const projectStatePaths = await runtime.ensureOfficeAgentManagedProjectStateLayout(
          projectDir,
          managedRootDir,
        );
        cleanupPaths.push(projectStatePaths.projectStateDir);
        const shellConfig = await sandbox.ensureOfficeAgentSandboxShellConfig(managedRootDir);
        if (!shellConfig.pythonRuntime) {
          console.warn(
            "Skipping project-state Python smoke because bundled Python is unavailable.",
          );
          return;
        }

        const createOperations = async (sessionId: string) => {
          const sessionPaths = await runtime.ensureOfficeAgentManagedSessionLayout(
            sessionId,
            managedRootDir,
          );
          cleanupPaths.push(sessionPaths.sessionDir);
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

        const sessionA = await createOperations(`session-a-${Date.now()}`);
        const sessionB = await createOperations(`session-b-${Date.now()}`);
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
        await Promise.all(
          cleanupPaths.map((target) =>
            rm(target, { recursive: true, force: true }).catch(() => undefined),
          ),
        );
      }
    }, 180_000);
  },
);
