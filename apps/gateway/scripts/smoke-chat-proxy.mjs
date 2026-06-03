import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = "officeagent-demo-2026";
const requestyModel = "azure/gpt-5.4@swedencentral";
const upstreamApiKey = "requesty-test-key";

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

function createUpstreamServer() {
  const requests = [];
  const streamText = [
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"x_raw_marker\":\"preserve-me\"},\"finish_reason\":null}]}\r\n\r\n",
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"thinking through proxy\"},\"finish_reason\":null}]}\r\n\r\n",
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello raw proxy\"},\"finish_reason\":null}]}\r\n\r\n",
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_stream\",\"type\":\"function\",\"function\":{\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\r\n\r\n",
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"type\":\"function\",\"function\":{\"name\":\"stream_lookup\"}}]},\"finish_reason\":null}]}\r\n\r\n",
    "data: {\"id\":\"chatcmpl_raw\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":7,\"total_tokens\":18}}\r\n\r\n",
    "data: [DONE]\r\n\r\n",
  ].join("");
  const jsonText = JSON.stringify({
    id: "chatcmpl_json_raw",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "json raw proxy one",
          reasoning_content: "json reasoning",
          tool_calls: [{ id: "call_json", type: "function", function: { name: "lookup", arguments: "{}" } }],
        },
        finish_reason: "tool_calls",
      },
      {
        index: 1,
        message: { role: "assistant", content: "json raw proxy two" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
  });

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyText ? JSON.parse(bodyText) : {},
    });

    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    if (requests.at(-1)?.body?.stream === false) {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(jsonText);
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(streamText);
  });

  return { server, requests, streamText, jsonText };
}

const gatewayPort = await getFreePort();
const upstreamPort = await getFreePort();
const analyticsDir = await mkdtemp(path.join(os.tmpdir(), "officeagent-gateway-chat-proxy-analytics-"));
const authDir = await mkdtemp(path.join(os.tmpdir(), "officeagent-gateway-chat-proxy-auth-"));
const modelsPath = path.join(authDir, "models.json");
const authPath = path.join(authDir, "auth.json");
const baseUrl = `http://127.0.0.1:${gatewayPort}`;
const upstreamUrl = `http://127.0.0.1:${upstreamPort}/v1`;
let output = "";

await writeFile(modelsPath, JSON.stringify({
  providers: {
    requesty: {
      baseUrl: upstreamUrl,
      api: "openai-completions",
      apiKey: upstreamApiKey,
      models: [{
        id: requestyModel,
        name: "Requesty Smoke Model",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
      }],
    },
  },
}, null, 2), "utf8");
await writeFile(authPath, "{}\n", "utf8");

const upstream = createUpstreamServer();
await new Promise((resolve, reject) => {
  upstream.server.once("error", reject);
  upstream.server.listen(upstreamPort, "127.0.0.1", resolve);
});

const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: gatewayRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(gatewayPort),
    HOST: "127.0.0.1",
    MOCK_MODE: "0",
    GATEWAY_TOKEN: token,
    OFFICE_AGENT_GATEWAY_ANALYTICS_DIR: analyticsDir,
    OFFICE_AGENT_GATEWAY_AUTH_PATH: authPath,
    OFFICE_AGENT_GATEWAY_MODELS_PATH: modelsPath,
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

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
      model: requestyModel,
      stream: true,
      messages: [{ role: "user", content: "hello chat proxy" }],
      reasoning_effort: "medium",
    }),
  });
  assert(response.ok, `chat proxy request failed: HTTP ${response.status}`);
  const text = await response.text();
  assert(text === upstream.streamText, "gateway did not preserve upstream SSE bytes");

  assert(upstream.requests.length === 1, `expected one upstream request, got ${upstream.requests.length}`);
  const upstreamRequest = upstream.requests[0];
  assert(upstreamRequest.body.model === requestyModel, `bad upstream model: ${upstreamRequest.body.model}`);
  assert(upstreamRequest.headers.authorization === `Bearer ${upstreamApiKey}`, "gateway did not apply upstream auth");
  assert(upstreamRequest.headers["x-officeagent-user"] === undefined, "gateway leaked OfficeAgent identity headers upstream");

  const jsonResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
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
      model: requestyModel,
      stream: false,
      messages: [{ role: "user", content: "hello non-stream chat proxy" }],
    }),
  });
  assert(jsonResponse.ok, `non-stream chat proxy request failed: HTTP ${jsonResponse.status}`);
  const jsonText = await jsonResponse.text();
  assert(jsonText === upstream.jsonText, "gateway did not preserve upstream JSON bytes");
  assert(upstream.requests.length === 2, `expected two upstream requests, got ${upstream.requests.length}`);
  assert(upstream.requests[1].body.model === requestyModel, `bad JSON upstream model: ${upstream.requests[1].body.model}`);

  const summaryResponse = await fetch(`${baseUrl}/analytics/summary?range=30m`);
  assert(summaryResponse.ok, `summary failed: HTTP ${summaryResponse.status}`);
  const summary = await summaryResponse.json();
  assert(summary.totals?.completedRequests === 2, "chat proxy requests were not counted");
  assert(summary.models?.[0]?.model === requestyModel, `bad model breakdown: ${summary.models?.[0]?.model}`);
  assert(summary.totals?.totalOutputTokens === 16, `bad output token total: ${summary.totals?.totalOutputTokens}`);
  assert(summary.totals?.totalToolCalls === 2, `bad tool call total: ${summary.totals?.totalToolCalls}`);
  const toolNames = summary.tools?.map((tool) => tool.name) || [];
  assert(toolNames.includes("stream_lookup"), `streamed tool name was not updated: ${toolNames.join(",")}`);
  assert(toolNames.includes("lookup"), `JSON tool name missing: ${toolNames.join(",")}`);
  assert(!toolNames.includes("unknown"), `streamed tool call was double-counted as unknown: ${toolNames.join(",")}`);

  console.log("chat proxy smoke passed", {
    sseBytes: text.length,
    jsonBytes: jsonText.length,
    completedRequests: summary.totals.completedRequests,
  });
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
  upstream.server.close();
  await rm(analyticsDir, { recursive: true, force: true });
  await rm(authDir, { recursive: true, force: true });
}
