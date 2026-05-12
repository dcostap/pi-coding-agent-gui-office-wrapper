import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const isWatchMode = process.argv.includes("--watch");
const projectRoot = process.cwd();
const repoRoot = path.resolve(projectRoot, "..", "..");
const buildRoot = path.join(projectRoot, "build");

const officeAgentRuntimeAliasPlugin = {
  name: "office-agent-runtime-alias",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /^@office-agent\/runtime$/ }, () => ({
      path: path.join(repoRoot, "packages", "office-agent-runtime", "src", "index.ts"),
    }));
  },
} satisfies Bun.BunPlugin;

const buildTargets = [
  {
    label: "electron-runtime",
    entrypoints: [
      path.join(projectRoot, "src", "electron", "main", "index.ts"),
      path.join(projectRoot, "src", "electron", "preload", "index.ts"),
    ],
    outdir: path.join(buildRoot, "electron"),
    root: path.join(projectRoot, "src", "electron"),
    naming: {
      entry: "[dir]/[name].cjs",
    },
    format: "cjs",
  },
  {
    label: "desktop-runtime",
    entrypoints: [
      path.join(projectRoot, "desktop", "pi-threads.cts"),
      path.join(projectRoot, "desktop", "pi-skills.cts"),
      path.join(projectRoot, "desktop", "skill-creator-session.cts"),
      path.join(projectRoot, "desktop", "runtime-host", "worker.cts"),
    ],
    outdir: path.join(buildRoot, "desktop"),
    root: path.join(projectRoot, "desktop"),
    naming: {
      entry: "[name].mjs",
    },
    format: "esm",
  },
  {
    label: "terminal-manager",
    entrypoints: [path.join(projectRoot, "desktop", "terminal", "manager.cts")],
    outdir: path.join(buildRoot, "desktop"),
    root: path.join(projectRoot, "desktop", "terminal"),
    naming: {
      entry: "terminal-manager.mjs",
    },
    format: "esm",
  },
] as const;

async function prepareBuildDirectories() {
  await rm(path.join(buildRoot, "electron"), { recursive: true, force: true });
  await rm(path.join(buildRoot, "desktop"), { recursive: true, force: true });
  await rm(path.join(buildRoot, "native"), { recursive: true, force: true });
  await mkdir(path.join(buildRoot, "electron"), { recursive: true });
  await mkdir(path.join(buildRoot, "desktop"), { recursive: true });
}

async function copyWindowsSandboxHelperBinaries() {
  if (process.platform !== "win32") {
    return;
  }

  const binaryNames = [
    "officeagent-windows-sandbox-helper.exe",
    "office-agent-windows-sandbox-setup.exe",
    "office-agent-command-runner.exe",
  ];
  const sourceDirs = [
    path.join(repoRoot, "native", "windows-sandbox-helper", "target", "release"),
    path.join(repoRoot, "native", "windows-sandbox-helper", "target", "debug"),
  ];
  const outputDir = path.join(buildRoot, "native", "windows-sandbox-helper");
  await mkdir(outputDir, { recursive: true });

  const missing: string[] = [];
  for (const binaryName of binaryNames) {
    const source = sourceDirs
      .map((dir) => path.join(dir, binaryName))
      .filter((candidate) => existsSync(candidate))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!source) {
      missing.push(binaryName);
      continue;
    }
    await copyFile(source, path.join(outputDir, binaryName));
  }

  if (missing.length > 0) {
    console.warn(
      `Windows sandbox helper binaries were not copied because they are missing: ${missing.join(", ")}. ` +
        "Build native/windows-sandbox-helper first if packaging strong Windows sandbox support.",
    );
  }
}

async function runBuild() {
  await prepareBuildDirectories();

  const builds = await Promise.all(
    buildTargets.map((target) =>
      Bun.build({
        entrypoints: [...target.entrypoints],
        outdir: target.outdir,
        root: target.root,
        naming: target.naming,
        target: "node",
        format: target.format,
        packages: "external",
        plugins: [officeAgentRuntimeAliasPlugin],
        sourcemap: "linked",
        watch: isWatchMode,
        throw: true,
      } as Bun.BuildConfig & { watch?: boolean }),
    ),
  );

  for (const [index, build] of builds.entries()) {
    console.log(`Built ${buildTargets[index].label} (${build.outputs.length} output(s)).`);
  }

  await copyWindowsSandboxHelperBinaries();

  if (isWatchMode) {
    console.log("Watching Electron runtime bundles...");
    await new Promise(() => {
      setInterval(() => {}, 1 << 30);
    });
  }
}

void runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
