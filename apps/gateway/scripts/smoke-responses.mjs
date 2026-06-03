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

function parseSseEvents(text) {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim())
    .filter(Boolean)
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const port = await getFreePort();
const analyticsDir = await mkdtemp(path.join(os.tmpdir(), "officeagent-gateway-responses-"));
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

  const response = await fetch(`${baseUrl}/v1/responses`, {
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
      model: "gpt-5.5",
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: "hello responses" }] }],
      reasoning: { effort: "high", summary: "auto" },
    }),
  });
  assert(response.ok, `responses request failed: HTTP ${response.status}`);
  const text = await response.text();
  const events = parseSseEvents(text);
  assert(events.some((event) => event.type === "response.reasoning_summary_text.delta"), "reasoning delta missing");
  assert(events.some((event) => event.type === "response.output_text.delta"), "output delta missing");
  assert(events.some((event) => event.type === "response.completed"), "completion event missing");

  const summaryResponse = await fetch(`${baseUrl}/analytics/summary?range=30m`);
  assert(summaryResponse.ok, `summary failed: HTTP ${summaryResponse.status}`);
  const summary = await summaryResponse.json();
  assert(summary.totals?.completedRequests === 1, "responses request was not counted");
  assert(summary.models?.[0]?.model === "gpt-5.5", `bad model breakdown: ${summary.models?.[0]?.model}`);

  console.log("responses smoke passed", {
    events: events.length,
    completedRequests: summary.totals.completedRequests,
  });
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
  await rm(analyticsDir, { recursive: true, force: true });
}
