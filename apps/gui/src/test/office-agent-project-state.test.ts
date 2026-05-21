import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("OfficeAgent project-scoped tool state", () => {
  it("shares package/cache env paths across sessions in the same project", async () => {
    const managedRootDir = await mkdtemp(path.join(tmpdir(), "officeagent-project-state-"));
    const projectDir = path.join(managedRootDir, "projects", "alpha");
    const otherProjectDir = path.join(managedRootDir, "projects", "beta");
    await mkdir(projectDir, { recursive: true });
    await mkdir(otherProjectDir, { recursive: true });

    try {
      const {
        ensureOfficeAgentManagedProjectStateLayout,
        ensureOfficeAgentManagedSessionLayout,
        getOfficeAgentManagedSessionEnv,
      } = await import(
        pathToFileURL(
          path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts"),
        ).href
      );

      await Promise.all([
        ensureOfficeAgentManagedSessionLayout("session-a", managedRootDir),
        ensureOfficeAgentManagedSessionLayout("session-b", managedRootDir),
        ensureOfficeAgentManagedSessionLayout("session-c", managedRootDir),
        ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir),
        ensureOfficeAgentManagedProjectStateLayout(otherProjectDir, managedRootDir),
      ]);

      const sessionA = getOfficeAgentManagedSessionEnv("session-a", process.env, {
        managedRootDir,
        activeProjectDir: projectDir,
      });
      const sessionB = getOfficeAgentManagedSessionEnv("session-b", process.env, {
        managedRootDir,
        activeProjectDir: projectDir,
      });
      const sessionC = getOfficeAgentManagedSessionEnv("session-c", process.env, {
        managedRootDir,
        activeProjectDir: otherProjectDir,
      });

      expect(sessionA.PYTHONUSERBASE).toBe(sessionB.PYTHONUSERBASE);
      expect(sessionA.OFFICE_AGENT_PYTHON_ENV).toBe(sessionB.OFFICE_AGENT_PYTHON_ENV);
      expect(sessionA.OFFICE_AGENT_SCRATCH).toBe(sessionB.OFFICE_AGENT_SCRATCH);
      expect(sessionA.PIP_CACHE_DIR).toBe(sessionB.PIP_CACHE_DIR);
      expect(sessionA.PIP_CONFIG_FILE).toBe(sessionB.PIP_CONFIG_FILE);
      expect(sessionA.NPM_CONFIG_CACHE).toBe(sessionB.NPM_CONFIG_CACHE);
      expect(sessionA.UV_CACHE_DIR).toBe(sessionB.UV_CACHE_DIR);
      expect(sessionA.TEMP).not.toBe(sessionB.TEMP);

      expect(sessionA.PYTHONUSERBASE).not.toBe(sessionC.PYTHONUSERBASE);
      expect(sessionA.OFFICE_AGENT_PYTHON_ENV).not.toBe(sessionC.OFFICE_AGENT_PYTHON_ENV);
      expect(sessionA.OFFICE_AGENT_SCRATCH).not.toBe(sessionC.OFFICE_AGENT_SCRATCH);
      expect(sessionA.PIP_CACHE_DIR).not.toBe(sessionC.PIP_CACHE_DIR);
      expect(sessionA.PIP_CONFIG_FILE).not.toBe(sessionC.PIP_CONFIG_FILE);
      expect(sessionA.PYTHONUSERBASE).toContain(
        `${path.sep}.officeagent${path.sep}project-state${path.sep}`,
      );
      expect(sessionA.OFFICE_AGENT_PROJECT_STATE).toContain(
        `${path.sep}.officeagent${path.sep}project-state${path.sep}`,
      );
      expect(path.basename(sessionA.OFFICE_AGENT_PROJECT_STATE ?? "")).toMatch(/^ws-[a-f0-9]{24}$/);
      expect(sessionA.XDG_CACHE_HOME).toBe(sessionA.OFFICE_AGENT_PROJECT_CACHE);
    } finally {
      await rm(managedRootDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
