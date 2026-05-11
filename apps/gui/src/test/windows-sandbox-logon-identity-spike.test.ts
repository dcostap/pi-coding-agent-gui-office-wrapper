import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const hasLogonSpikeCredentials =
  process.platform === "win32" &&
  process.env.OFFICE_AGENT_SANDBOX_IDENTITY_MODE === "logon-user" &&
  !!process.env.OFFICE_AGENT_SANDBOX_LOGON_USER &&
  !!process.env.OFFICE_AGENT_SANDBOX_LOGON_PASSWORD;

describe.skipIf(!hasLogonSpikeCredentials)(
  "OfficeAgent Windows sandbox logon-user identity spike",
  () => {
    it("runs a command as the configured sandbox account and writes project state", async () => {
      const managedRootDir = await mkdtemp(path.join(tmpdir(), "officeagent-logon-spike-"));
      const projectDir = path.join(managedRootDir, "projects", "logon-spike");
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

        const sessionId = "logon-spike-session";
        const [sessionPaths, projectStatePaths] = await Promise.all([
          runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir),
          runtime.ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir),
        ]);
        const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, {
          managedRootDir,
          activeProjectDir: projectDir,
        });
        const previousDefaultShell = process.env.OFFICE_AGENT_SANDBOX_DEFAULT_SHELL;
        process.env.OFFICE_AGENT_SANDBOX_DEFAULT_SHELL = "powershell";
        const shellConfig = await sandbox.ensureOfficeAgentSandboxShellConfig(managedRootDir);
        if (previousDefaultShell === undefined) {
          delete process.env.OFFICE_AGENT_SANDBOX_DEFAULT_SHELL;
        } else {
          process.env.OFFICE_AGENT_SANDBOX_DEFAULT_SHELL = previousDefaultShell;
        }
        const operations = sandbox.createOfficeAgentSandboxBashOperations({
          managedRootDir,
          sessionPaths,
          projectStatePaths,
          env,
          shellConfig,
        });

        let output = "";
        const command = [
          "$target = Join-Path $env:PYTHONUSERBASE 'logon-spike.txt'",
          "New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null",
          "'logon-ok' | Set-Content -Path $target -Encoding utf8",
          "whoami",
          "Get-Content -Path $target",
        ].join("; ");
        const result = await operations.exec(command, projectDir, {
          timeout: 120,
          onData: (chunk: Buffer) => {
            output += chunk.toString();
          },
        });

        expect(result.exitCode).toBe(0);
        expect(output.toLowerCase()).toContain(process.env.OFFICE_AGENT_SANDBOX_LOGON_USER!.toLowerCase());
        expect(output).toContain("logon-ok");
      } finally {
        await rm(managedRootDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }, 180_000);
  },
);
