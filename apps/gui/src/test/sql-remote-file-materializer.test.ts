import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type MaterializedFileForTest = {
  readonly workspaceRelativePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly localPath: string;
};

describe("SQL remote file materializer", () => {
  it("streams a gateway remote file into the workspace tool-files directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-files-"));
    const body = Buffer.from('{"ok":true,"rows":[{"a":1}]}\n', "utf8");
    const sha256 = hashSha256(body);

    const server = createFileServer({ body, token: testToken });
    try {
      const baseUrl = await listen(server);
      const result = await materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "files/file-1",
          fileName: "CON",
          format: "json",
          mimeType: "application/json",
          bytes: body.length,
          sha256,
        },
        sqlEndpointUrl: `${baseUrl}/v1/tools/castrosua_sql_read_only`,
      });

      const materialized = getMaterializedFile(result);
      expect(materialized.workspaceRelativePath).toBe(".\\officeagent-tool-files\\sql\\CON_.json");
      expect(materialized.bytes).toBe(body.length);
      expect(materialized.sha256).toBe(sha256);
      expect(await readFile(materialized.localPath, "utf8")).toBe(body.toString("utf8"));
      expect(result.content[0].text).toContain(".\\officeagent-tool-files\\sql\\CON_.json");
    } finally {
      await close(server);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("chooses a collision-free local file name", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-collision-"));
    const sqlDir = path.join(workspaceRoot, "officeagent-tool-files", "sql");
    await mkdir(sqlDir, { recursive: true });
    await writeFile(path.join(sqlDir, "data.json"), "existing", "utf8");

    const body = Buffer.from("{\"ok\":true}\n", "utf8");
    const server = createFileServer({ body, token: testToken });
    try {
      const baseUrl = await listen(server);
      const result = await materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "files/file-1",
          fileName: "data.json",
          format: "json",
          bytes: body.length,
          sha256: hashSha256(body),
        },
        sqlEndpointUrl: `${baseUrl}/v1/tools/castrosua_sql_read_only`,
      });

      const materialized = getMaterializedFile(result);
      expect(materialized.workspaceRelativePath).toBe(".\\officeagent-tool-files\\sql\\data copy.json");
      expect(await readFile(path.join(sqlDir, "data.json"), "utf8")).toBe("existing");
      expect(await readFile(materialized.localPath, "utf8")).toBe(body.toString("utf8"));
    } finally {
      await close(server);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects hash mismatches and cleans up partial temp files", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-hash-"));
    const body = Buffer.from("{\"ok\":true}\n", "utf8");
    const server = createFileServer({ body, token: testToken });
    try {
      const baseUrl = await listen(server);
      await expect(materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "files/file-1",
          fileName: "bad-hash.json",
          format: "json",
          bytes: body.length,
          sha256: "0".repeat(64),
        },
        sqlEndpointUrl: `${baseUrl}/v1/tools/castrosua_sql_read_only`,
      })).rejects.toThrow(/hash/i);

      const sqlDir = path.join(workspaceRoot, "officeagent-tool-files", "sql");
      const entries = await readdir(sqlDir).catch(() => []);
      expect(entries).not.toContain("bad-hash.json");
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    } finally {
      await close(server);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects byte-count mismatches", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-bytes-"));
    const body = Buffer.from("{\"ok\":true}\n", "utf8");
    const server = createFileServer({ body, token: testToken });
    try {
      const baseUrl = await listen(server);
      await expect(materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "files/file-1",
          fileName: "bad-bytes.json",
          format: "json",
          bytes: body.length + 1,
          sha256: hashSha256(body),
        },
        sqlEndpointUrl: `${baseUrl}/v1/tools/castrosua_sql_read_only`,
      })).rejects.toThrow(/size/i);
    } finally {
      await close(server);
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects absolute or unexpected remote download URLs", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-url-"));
    const body = Buffer.from("{\"ok\":true}\n", "utf8");
    try {
      await expect(materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "https://example.invalid/files/file-1",
          fileName: "data.json",
          format: "json",
          bytes: body.length,
          sha256: hashSha256(body),
        },
        sqlEndpointUrl: "http://127.0.0.1:1/v1/tools/castrosua_sql_read_only",
      })).rejects.toThrow(/download URL/i);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlink or junction components in the tool-files path", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "officeagent-sql-symlink-workspace-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "officeagent-sql-symlink-outside-"));
    const linkPath = path.join(workspaceRoot, "officeagent-tool-files");
    const body = Buffer.from("{\"ok\":true}\n", "utf8");
    const server = createFileServer({ body, token: testToken });
    let symlinkCreated = false;

    try {
      try {
        await symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");
        symlinkCreated = true;
      } catch (error) {
        if (isSymlinkPrivilegeError(error)) {
          console.warn("Skipping symlink traversal assertion because this platform denies symlink/junction creation.");
          return;
        }
        throw error;
      }

      const baseUrl = await listen(server);
      await expect(materializeForTest({
        workspaceRoot,
        body,
        descriptor: {
          id: "file-1",
          downloadUrl: "files/file-1",
          fileName: "data.json",
          format: "json",
          bytes: body.length,
          sha256: hashSha256(body),
        },
        sqlEndpointUrl: `${baseUrl}/v1/tools/castrosua_sql_read_only`,
      })).rejects.toThrow(/symlink|junction|escaped/i);
    } finally {
      if (symlinkCreated) await rm(linkPath, { recursive: true, force: true }).catch(() => undefined);
      await close(server);
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

const testToken = "test-token";

type ToolResultForTest = {
  content: Array<{ type: "text"; text: string }>;
  details: {
    action: string;
    remoteFiles: unknown[];
  };
};

async function materializeForTest(options: {
  readonly workspaceRoot: string;
  readonly body: Buffer;
  readonly descriptor: Record<string, unknown>;
  readonly sqlEndpointUrl: string;
}): Promise<ToolResultForTest> {
  const { materializeSqlRemoteFilesIfPresent } = await import(
    pathToFileURL(path.resolve(process.cwd(), "desktop/sql-remote-file-materializer.cts")).href
  ) as typeof import("../../desktop/sql-remote-file-materializer.cts");

  return materializeSqlRemoteFilesIfPresent({
    content: [{ type: "text" as const, text: "remote" }],
    details: {
      action: "query",
      remoteFiles: [options.descriptor],
    },
  }, {
    workspaceRoot: options.workspaceRoot,
    toolFilesRoot: path.join(options.workspaceRoot, "officeagent-tool-files"),
    sqlEndpointUrl: options.sqlEndpointUrl,
    gatewayToken: testToken,
  });
}

function getMaterializedFile(result: ToolResultForTest): MaterializedFileForTest {
  return (result.details as unknown as { materializedFiles: MaterializedFileForTest[] }).materializedFiles[0];
}

function createFileServer(options: { readonly body: Buffer; readonly token: string }): http.Server {
  return http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/tools/castrosua_sql_read_only/files/file-1") {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(options.body.length),
      });
      res.end(options.body);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not return a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function hashSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isSymlinkPrivilegeError(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code));
}
