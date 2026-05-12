import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runV2Smoke = process.platform === "win32" && process.env.OFFICE_AGENT_WINDOWS_SANDBOX_V2_SMOKE === "1";
const execFileAsync = promisify(execFile);

describe.skipIf(!runV2Smoke)("OfficeAgent Windows sandbox v2 launch", () => {
  it("runs cmd as OfficeAgentSandbox and captures named-pipe stdin/stdout/stderr", async () => {
    const previousBackend = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    try {
      const [runtime, sandbox] = await Promise.all([
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href),
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts")).href),
      ]);
      const managedRootDir = runtime.getOfficeAgentManagedRootDir();
      const check = await sandbox.invokeWindowsSandboxHelper({
        kind: "checkSandboxSetup",
        requestId: "v2-smoke-readiness",
        managedRoot: managedRootDir,
      });
      expect(check.ok).toBe(true);
      expect(check.result?.ready).toBe(true);

      const projectDir = path.join(managedRootDir, "Projects", "v2-vitest-smoke");
      const sessionDir = path.join(managedRootDir, ".officeagent", "sessions", "v2-vitest-smoke");
      const launch = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-launch",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/d", "/q", "/c", "echo %USERNAME% & echo errtext 1>&2"],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir],
        timeoutMs: 30_000,
      });
      expect(launch.ok).toBe(true);
      expect(launch.result?.exitCode).toBe(0);
      expect(String(launch.result?.stdout ?? "")).toContain("OfficeAgentSandbox");
      expect(String(launch.result?.stderr ?? "")).toContain("errtext");

      const stdinLaunch = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-stdin-launch",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/v:on", "/d", "/q", "/c", "set /p line= & echo stdin:!line!"],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir],
        stdinContent: "hello from stdin\r\n",
        timeoutMs: 30_000,
      });
      expect(stdinLaunch.ok).toBe(true);
      expect(stdinLaunch.result?.exitCode).toBe(0);
      expect(String(stdinLaunch.result?.stdout ?? "")).toContain("stdin:hello from stdin");
    } finally {
      if (previousBackend === undefined) {
        delete process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
      } else {
        process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = previousBackend;
      }
    }
  }, 120_000);

  it("rejects symlink writable-root escapes", async () => {
    const previousBackend = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    let outsideDir: string | undefined;
    try {
      const [runtime, sandbox] = await Promise.all([
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href),
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts")).href),
      ]);
      const managedRootDir = runtime.getOfficeAgentManagedRootDir();
      const projectDir = path.join(managedRootDir, "Projects", "v2-vitest-symlink");
      const symlinkDir = path.join(projectDir, "symlink-out");
      const sessionDir = path.join(managedRootDir, ".officeagent", "sessions", "v2-vitest-symlink");
      outsideDir = path.join(path.dirname(managedRootDir), `SymlinkOutside-${Date.now()}`);
      await rm(projectDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
      await mkdir(projectDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      try {
        const escapedSymlink = symlinkDir.replace(/'/g, "''");
        const escapedOutside = outsideDir.replace(/'/g, "''");
        await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `New-Item -ItemType SymbolicLink -Path '${escapedSymlink}' -Target '${escapedOutside}' | Out-Null`,
        ], { windowsHide: true });
      } catch (error) {
        console.warn(`Skipping symlink escape smoke because symlink creation failed: ${String(error)}`);
        return;
      }

      const launch = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-symlink-launch",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/d", "/q", "/c", "echo should-not-run"],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir, symlinkDir],
        timeoutMs: 30_000,
      });
      expect(launch.ok).toBe(false);
      expect(String(launch.error?.message ?? "")).toContain("writeRoot must be inside");
    } finally {
      if (outsideDir) {
        await rm(outsideDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (previousBackend === undefined) {
        delete process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
      } else {
        process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = previousBackend;
      }
    }
  }, 120_000);

  it("rejects junction writable-root escapes", async () => {
    const previousBackend = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    let outsideDir: string | undefined;
    try {
      const [runtime, sandbox] = await Promise.all([
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href),
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts")).href),
      ]);
      const managedRootDir = runtime.getOfficeAgentManagedRootDir();
      const projectDir = path.join(managedRootDir, "Projects", "v2-vitest-junction");
      const junctionDir = path.join(projectDir, "junction-out");
      const sessionDir = path.join(managedRootDir, ".officeagent", "sessions", "v2-vitest-junction");
      outsideDir = path.join(path.dirname(managedRootDir), `JunctionOutside-${Date.now()}`);
      await rm(projectDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
      await mkdir(projectDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      try {
        const escapedJunction = junctionDir.replace(/'/g, "''");
        const escapedOutside = outsideDir.replace(/'/g, "''");
        await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-Command",
          `New-Item -ItemType Junction -Path '${escapedJunction}' -Target '${escapedOutside}' | Out-Null`,
        ], { windowsHide: true });
      } catch (error) {
        console.warn(`Skipping junction escape smoke because junction creation failed: ${String(error)}`);
        return;
      }

      const launch = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-junction-launch",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/d", "/q", "/c", "echo should-not-run"],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir, junctionDir],
        timeoutMs: 30_000,
      });
      expect(launch.ok).toBe(false);
      expect(String(launch.error?.message ?? "")).toContain("writeRoot must be inside");
    } finally {
      if (outsideDir) {
        await rm(outsideDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (previousBackend === undefined) {
        delete process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
      } else {
        process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = previousBackend;
      }
    }
  }, 120_000);

  it("does not grant capability-token writes to sibling roots outside writablePaths", async () => {
    const previousBackend = process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    try {
      const [runtime, sandbox] = await Promise.all([
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href),
        import(pathToFileURL(path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts")).href),
      ]);
      const managedRootDir = runtime.getOfficeAgentManagedRootDir();
      const projectDir = path.join(managedRootDir, "Projects", "v2-vitest-allowed");
      const deniedDir = path.join(managedRootDir, "Projects", "v2-vitest-denied");
      const deniedFile = path.join(deniedDir, "escape.txt");
      await mkdir(projectDir, { recursive: true });
      await mkdir(deniedDir, { recursive: true });
      await rm(deniedFile, { force: true });
      const sessionDir = path.join(managedRootDir, ".officeagent", "sessions", "v2-vitest-denied");
      const launch = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-denied-launch",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/d", "/q", "/c", `echo should-not-write > "${deniedFile}"`],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir],
        timeoutMs: 30_000,
      });
      expect(launch.ok).toBe(true);
      expect(launch.result?.exitCode).not.toBe(0);
      await expect(access(deniedFile)).rejects.toThrow();

      const secretsFile = path.join(managedRootDir, ".officeagent", "sandbox-secrets", "sandbox_users.json");
      const secretsProbe = await sandbox.invokeWindowsSandboxHelper({
        kind: "launch",
        requestId: "v2-vitest-secrets-probe",
        executable: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        args: ["/d", "/q", "/c", `type "${secretsFile}"`],
        cwd: projectDir,
        managedRoot: managedRootDir,
        sessionDir,
        writablePaths: [projectDir],
        timeoutMs: 30_000,
      });
      expect(secretsProbe.ok).toBe(true);
      expect(secretsProbe.result?.exitCode).not.toBe(0);
      expect(String(secretsProbe.result?.stdout ?? "")).not.toContain("password");

      const capSids = JSON.parse(await readFile(path.join(managedRootDir, ".officeagent", "sandbox", "cap_sid.json"), "utf8")) as {
        workspaceByCwd?: Record<string, string>;
      };
      const projectKey = projectDir.replace(/\\/g, "/").toLowerCase();
      const workspaceSid = capSids.workspaceByCwd?.[projectKey];
      expect(workspaceSid).toBeTruthy();
      const { stdout: aclText } = await execFileAsync("icacls.exe", [projectDir], { windowsHide: true });
      const occurrences = String(aclText).split(workspaceSid as string).length - 1;
      expect(occurrences).toBe(1);
    } finally {
      if (previousBackend === undefined) {
        delete process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND;
      } else {
        process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = previousBackend;
      }
    }
  }, 120_000);
});
