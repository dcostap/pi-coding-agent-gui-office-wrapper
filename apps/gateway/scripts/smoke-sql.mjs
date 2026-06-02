import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = "officeagent-sql-smoke";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, deadlineMs = 10000) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("gateway did not become healthy");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const port = await getFreePort();
const analyticsDir = await mkdtemp(path.join(os.tmpdir(), "officeagent-gateway-sql-"));
const baseUrl = `http://127.0.0.1:${port}`;
let output = "";

const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: gatewayRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MOCK_MODE: "1",
    GATEWAY_TOKEN: token,
    OFFICE_AGENT_GATEWAY_ANALYTICS_DIR: analyticsDir,
  },
});

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth(baseUrl);

  const unauthorized = await fetch(`${baseUrl}/v1/tools/castrosua_sql_read_only`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "info" }),
  });
  assert(unauthorized.status === 401, `unauthorized returned HTTP ${unauthorized.status}`);

  await assertToolError({ action: "info", database: "master" }, "invalid_database");
  await assertToolError({ action: "drop" }, "invalid_action");
  await assertToolError({ action: "describe" }, "missing_table");
  await assertToolError({ action: "query", sql: "SELECT 1; DROP TABLE T" }, "multiple_statements");
  await assertToolError({ action: "sample", table: "LOGIC_CabeceraAlbaranProveedor", limit: 1.5 }, "invalid_limit");
  await assertToolError({ action: "info", database: "LOGIC" }, "invalid_database");

  const info = await postTool({ action: "info" });
  if (info.isError && info.details?.errorCode === "missing_sql_tool") {
    console.log("[gateway:sql-smoke] skipped live info; no server-side SQL executable was found");
  } else {
    assert(!info.isError, `live info returned tool error: ${JSON.stringify(info)}\nGateway output:\n${output}`);
    assert(Array.isArray(info.content), "live info missing content");
  }

  console.log("[gateway:sql-smoke] ok");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
  await rm(analyticsDir, { recursive: true, force: true });
}

async function assertToolError(body, expectedCode) {
  const payload = await postTool(body);
  assert(payload.isError === true, `expected tool error for ${expectedCode}: ${JSON.stringify(payload)}\nGateway output:\n${output}`);
  assert(
    payload.details?.errorCode === expectedCode,
    `expected ${expectedCode}, got ${payload.details?.errorCode}: ${JSON.stringify(payload)}\nGateway output:\n${output}`,
  );
}

async function postTool(body) {
  const response = await fetch(`${baseUrl}/v1/tools/castrosua_sql_read_only`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-officeagent-user": "alice",
      "x-officeagent-domain": "CORP",
      "x-officeagent-host": "SQLSMOKE",
      "x-officeagent-client": "smoke",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  assert(response.ok, `tool request failed: HTTP ${response.status} ${text}\nGateway output:\n${output}`);
  return payload;
}
