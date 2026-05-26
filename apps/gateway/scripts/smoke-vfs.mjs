import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.OFFICE_AGENT_GATEWAY_VFS_SMOKE_PORT || 18083);
const token = "officeagent-vfs-smoke";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "officeagent-vfs-smoke-"));
const vfsBase = path.join(tempRoot, "vfs");
const isoRoot = path.join(vfsBase, "castrosua_iso");
await mkdir(path.join(isoRoot, "policies"), { recursive: true });
await writeFile(path.join(isoRoot, "policies", "quality.md"), [
  "# Quality Policy",
  "Risk assessment is reviewed annually.",
  "Audit evidence is retained.",
].join("\n"), "utf8");
await writeFile(path.join(isoRoot, "readme.txt"), "ISO documentation root\n", "utf8");

const server = spawn(process.execPath, ["src/server.mjs"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MOCK_MODE: "1",
    GATEWAY_TOKEN: token,
    OFFICE_AGENT_VFS_BASE_DIR: vfsBase,
    OFFICE_AGENT_GATEWAY_ANALYTICS_DIR: path.join(tempRoot, "analytics"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForServer(port);

  const roots = await get("/v1/vfs/roots");
  assert(roots.roots?.some((root) => root.rootId === "castrosua_iso" && root.uriPrefix === "virtual://castrosua_iso" && root.displayName === "Castrosua ISO docs" && root.description?.includes("quality procedures")), "roots includes hardcoded castrosua_iso metadata");

  const list = await post("/v1/vfs/list", { rootId: "castrosua_iso", path: "/" });
  assert(list.entries?.some((entry) => entry.name === "policies" && entry.isDirectory), "list returns policies directory");

  const read = await post("/v1/vfs/read", { rootId: "castrosua_iso", path: "/policies/quality.md", offset: 2, limit: 1 });
  assert(read.text.includes("Risk assessment"), "read returns selected line");
  assert(read.truncated === true && read.nextOffset === 3, "read returns continuation metadata");

  const find = await post("/v1/vfs/find", { rootId: "castrosua_iso", path: "/", pattern: "**/*.md" });
  assert(find.paths?.includes("/policies/quality.md"), "find returns markdown file");

  const grep = await post("/v1/vfs/grep", { rootId: "castrosua_iso", path: "/", pattern: "risk", ignoreCase: true });
  assert(grep.matches?.some((match) => match.path === "/policies/quality.md" && match.line === 2), "grep returns match");

  console.log("[gateway:vfs-smoke] ok");
} finally {
  server.kill();
  await rm(tempRoot, { recursive: true, force: true });
}

async function waitForServer(portValue) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portValue}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gateway did not become ready. Output:\n${output}`);
}

async function get(route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return parseResponse(response);
}

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}\nGateway output:\n${output}`);
  }
  return json;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}\nGateway output:\n${output}`);
  }
}
