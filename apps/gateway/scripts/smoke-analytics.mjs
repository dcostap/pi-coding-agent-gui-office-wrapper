import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = "officeagent-demo-2026";

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
const analyticsDir = await mkdtemp(path.join(os.tmpdir(), "officeagent-gateway-analytics-"));
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

  const requestResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-officeagent-user": "alice",
      "x-officeagent-domain": "CORP",
      "x-officeagent-host": "TESTHOST",
      "x-officeagent-client": "gui",
    },
    body: JSON.stringify({
      model: "assistant",
      stream: true,
      messages: [{ role: "user", content: "hello analytics" }],
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    }),
  });
  assert(requestResponse.ok, `request failed: HTTP ${requestResponse.status}`);
  await requestResponse.text();

  const summaryResponse = await fetch(`${baseUrl}/analytics/summary?range=30m`);
  assert(summaryResponse.ok, `summary failed: HTTP ${summaryResponse.status}`);
  const summary = await summaryResponse.json();

  assert(summary.range?.id === "30m", "summary range mismatch");
  assert(summary.totals?.completedRequests === 1, "completed request was not counted");
  assert(summary.totals?.successCount === 1, "success was not counted");
  assert(summary.totals?.totalTokens > 0, "estimated tokens were not counted");
  assert(summary.totals?.totalPromptTokens > 0, "estimated prompt tokens were not counted");
  assert(summary.totals?.totalOutputTokens > 0, "estimated output tokens were not counted");
  assert(summary.users?.[0]?.identity === "CORP\\alice", `bad user identity: ${summary.users?.[0]?.identity}`);
  assert(summary.models?.length === 1, "model breakdown missing");
  assert(summary.tools?.some((tool) => tool.name === "read_file"), "tool breakdown missing read_file");
  assert(Array.isArray(summary.series) && summary.series.length > 0, "series missing");
  assert(summary.previous && summary.deltas, "previous/deltas missing");

  console.log("analytics smoke passed", {
    completedRequests: summary.totals.completedRequests,
    uniqueUsers: summary.totals.uniqueUsers,
    totalTokens: summary.totals.totalTokens,
    tools: summary.tools.length,
    buckets: summary.series.length,
  });
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
  await rm(analyticsDir, { recursive: true, force: true });
}
