import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const runV2PackageSmoke = process.platform === "win32" && process.env.OFFICE_AGENT_WINDOWS_SANDBOX_V2_PACKAGE_SMOKE === "1";

describe.skipIf(!runV2PackageSmoke)("OfficeAgent Windows sandbox v2 package-manager acceptance", () => {
  async function createOperations(projectName: string) {
    process.env.OFFICE_AGENT_WINDOWS_SANDBOX_BACKEND = "codex-v2";
    const [runtime, sandbox] = await Promise.all([
      import(pathToFileURL(path.resolve(process.cwd(), "../../packages/office-agent-runtime/src/index.ts")).href),
      import(pathToFileURL(path.resolve(process.cwd(), "../../packages/pi-sdk-driver/src/windows-sandbox-helper-client.ts")).href),
    ]);
    const managedRootDir = runtime.getOfficeAgentManagedRootDir();
    const check = await sandbox.invokeWindowsSandboxHelper({
      kind: "checkSandboxSetup",
      requestId: `v2-package-readiness-${projectName}`,
      managedRoot: managedRootDir,
    });
    expect(check.ok).toBe(true);
    expect(check.result?.ready).toBe(true);

    const projectDir = path.join(managedRootDir, "Projects", projectName);
    await rm(projectDir, { recursive: true, force: true });
    const sessionId = `v2-package-${projectName}-${Date.now()}`;
    const [sessionPaths, projectStatePaths] = await Promise.all([
      runtime.ensureOfficeAgentManagedSessionLayout(sessionId, managedRootDir),
      runtime.ensureOfficeAgentManagedProjectStateLayout(projectDir, managedRootDir),
    ]);
    const env = runtime.getOfficeAgentManagedSessionEnv(sessionId, process.env, {
      managedRootDir,
      activeProjectDir: projectDir,
    });
    const shellConfig = await sandbox.ensureOfficeAgentSandboxShellConfig(managedRootDir);
    const operations = sandbox.createOfficeAgentSandboxBashOperations({
      managedRootDir,
      sessionPaths,
      projectStatePaths,
      env,
      shellConfig,
    });
    return { operations, projectDir, managedRootDir, sandbox };
  }

  async function execText(
    operations: Awaited<ReturnType<typeof createOperations>>["operations"],
    command: string,
    cwd: string,
  ) {
    let output = "";
    const result = await operations.exec(command, cwd, {
      timeout: 180,
      onData: (chunk: Buffer) => {
        output += chunk.toString();
      },
    });
    return { ...result, output };
  }

  it("installs and imports a local Python package with pip", async () => {
    const { operations, projectDir, managedRootDir, sandbox } = await createOperations("v2-package-pip-smoke");
    const probe = await execText(operations, "python --version && python -m pip --version", projectDir);
    if (probe.exitCode !== 0) {
      console.warn(`Skipping pip v2 package smoke because python/pip is unavailable under v2: ${probe.output}`);
      return;
    }

    const packageDir = path.join(projectDir, "py_pkg");
    await sandbox.mkdirWithOfficeAgentSandbox(managedRootDir, path.join(packageDir, "officeagent_pkg_smoke"));
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(packageDir, "officeagent_pkg_smoke", "__init__.py"),
      "VALUE = 'pip-ok'\n",
      { createParentDirs: true },
    );
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(packageDir, "setup.py"),
      "from setuptools import setup\nsetup(name='officeagent-pkg-smoke', version='0.0.0', packages=['officeagent_pkg_smoke'])\n",
      { createParentDirs: true },
    );
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(projectDir, "verify-pip.py"),
      "import pathlib\nimport officeagent_pkg_smoke\npathlib.Path('pip-result.txt').write_text(officeagent_pkg_smoke.VALUE, encoding='utf-8')\n",
      { createParentDirs: true },
    );
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(projectDir, "make-wheel.py"),
      [
        "import zipfile",
        "wheel = 'officeagent_pkg_smoke-0.0.0-py3-none-any.whl'",
        "dist = 'officeagent_pkg_smoke-0.0.0.dist-info'",
        "with zipfile.ZipFile(wheel, 'w') as z:",
        "    z.write('py_pkg/officeagent_pkg_smoke/__init__.py', 'officeagent_pkg_smoke/__init__.py')",
        "    z.writestr(dist + '/METADATA', 'Metadata-Version: 2.1\\nName: officeagent-pkg-smoke\\nVersion: 0.0.0\\n')",
        "    z.writestr(dist + '/WHEEL', 'Wheel-Version: 1.0\\nGenerator: OfficeAgent smoke\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')",
        "    z.writestr(dist + '/RECORD', '')",
        "",
      ].join("\n"),
      { createParentDirs: true },
    );
    const command = [
      "python make-wheel.py",
      "python -m pip install --user --no-index --force-reinstall officeagent_pkg_smoke-0.0.0-py3-none-any.whl",
      "python verify-pip.py",
    ].join(" && ");
    const result = await execText(operations, command, projectDir);
    expect(result.output).toContain("Successfully installed officeagent-pkg-smoke");
    expect(result.exitCode).toBe(0);
    await expect(readFile(path.join(projectDir, "pip-result.txt"), "utf8")).resolves.toContain("pip-ok");
  }, 240_000);

  it("installs and imports a local npm package", async () => {
    const { operations, projectDir, managedRootDir, sandbox } = await createOperations("v2-package-npm-smoke");
    const probe = await execText(operations, "node --version && npm --version", projectDir);
    if (probe.exitCode !== 0) {
      console.warn(`Skipping npm v2 package smoke because node/npm is unavailable: ${probe.output}`);
      return;
    }

    const packageDir = path.join(projectDir, "npm-pkg");
    await sandbox.mkdirWithOfficeAgentSandbox(managedRootDir, packageDir);
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "officeagent-npm-smoke", version: "1.0.0", main: "index.js" }),
      { createParentDirs: true },
    );
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(packageDir, "index.js"),
      "module.exports = 'npm-ok';\n",
      { createParentDirs: true },
    );
    await sandbox.writeFileWithOfficeAgentSandbox(
      managedRootDir,
      path.join(projectDir, "verify-npm.js"),
      "require('fs').writeFileSync('npm-result.txt', require('officeagent-npm-smoke'))\n",
      { createParentDirs: true },
    );
    const command = [
      "npm install ./npm-pkg --no-audit --ignore-scripts",
      "node verify-npm.js",
    ].join(" && ");
    const result = await execText(operations, command, projectDir);
    expect(result.output).toMatch(/added|up to date/i);
    expect(result.exitCode).toBe(0);
    await expect(readFile(path.join(projectDir, "npm-result.txt"), "utf8")).resolves.toContain("npm-ok");
  }, 240_000);

  it("creates a local uv virtualenv and runs Python from it", async () => {
    const { operations, projectDir } = await createOperations("v2-package-uv-smoke");
    const probe = await execText(operations, "uv --version", projectDir);
    if (probe.exitCode !== 0) {
      console.warn(`Skipping uv v2 package smoke because uv is unavailable: ${probe.output}`);
      return;
    }

    const result = await execText(operations, "uv venv .uv-smoke-venv && uv run python -c \"print('uv-ok')\"", projectDir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("uv-ok");
  }, 240_000);
});
