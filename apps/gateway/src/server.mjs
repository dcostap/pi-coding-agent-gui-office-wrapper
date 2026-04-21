import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { streamSimple as piStreamSimple } from "@mariozechner/pi-ai";

const PORT = Number(process.env.OFFICE_AGENT_GATEWAY_PORT || process.env.PORT || 8082);
const HOST = process.env.HOST || "0.0.0.0";
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "officeagent-demo-2026";
const MOCK_MODE = process.env.MOCK_MODE === "1";
const ANALYTICS_WINDOW_MINUTES = 30;
const MAX_ANALYTICS_EVENTS = 5000;
const MAX_ANALYTICS_RECENT_EVENTS = 40;

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const authPath =
  process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");
const modelsPath =
  process.env.OFFICE_AGENT_GATEWAY_MODELS_PATH ||
  path.join(localAppData, "OfficeAgent", "gateway-auth", "models.json");
const analyticsDir =
  process.env.OFFICE_AGENT_GATEWAY_ANALYTICS_DIR || path.join(localAppData, "OfficeAgent", "gateway-analytics");
const analyticsEventsPath = path.join(analyticsDir, "events.jsonl");
const routedProvider = process.env.GATEWAY_UPSTREAM_PROVIDER || "openai-codex";
const routedModelId = process.env.GATEWAY_UPSTREAM_MODEL || "gpt-5.3-codex-spark";

const authStorage = AuthStorage.create(authPath);
const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

class GatewayAnalyticsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.events = [];
    this.activeRequests = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.#pushEvent(JSON.parse(trimmed));
        } catch {
          // Ignore malformed historical lines in demo mode.
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[gateway] analytics load warning", error);
      }
    }
    this.loaded = true;
  }

  startRequest(meta) {
    const startedAtMs = Date.now();
    const active = {
      id: randomUUID(),
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      client: meta.client,
      request: meta.request,
      routing: meta.routing,
    };
    this.activeRequests.set(active.id, active);
    return active;
  }

  async finishRequest(active, result) {
    this.activeRequests.delete(active.id);
    const completedAtMs = Date.now();
    const event = {
      id: active.id,
      startedAt: active.startedAt,
      startedAtMs: active.startedAtMs,
      completedAt: new Date(completedAtMs).toISOString(),
      completedAtMs,
      durationMs: Math.max(0, completedAtMs - active.startedAtMs),
      client: active.client,
      request: active.request,
      routing: result.routing || active.routing,
      result: {
        status: result.status || "success",
        finishReason: result.finishReason || "stop",
        errorMessage: result.errorMessage || null,
      },
      metrics: {
        outputChars: Number(result.outputChars || 0),
        toolCalls: Number(result.toolCalls || 0),
      },
    };

    this.#pushEvent(event);
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  getSummary() {
    const now = Date.now();
    const recentEvents = this.events.slice(-MAX_ANALYTICS_RECENT_EVENTS).reverse();
    const completed = this.events.length;
    const successCount = this.events.filter((event) => event.result?.status === "success").length;
    const errorCount = completed - successCount;
    const totalDurationMs = this.events.reduce((sum, event) => sum + Number(event.durationMs || 0), 0);
    const totalOutputChars = this.events.reduce((sum, event) => sum + Number(event.metrics?.outputChars || 0), 0);
    const users = summarizeUsers(this.events);
    const series = buildMinuteSeries(this.events, ANALYTICS_WINDOW_MINUTES, now);

    return {
      generatedAt: new Date(now).toISOString(),
      gateway: {
        host: HOST,
        port: PORT,
        mockMode: MOCK_MODE,
        analyticsEventsPath,
        routedProvider,
        routedModelId,
      },
      totals: {
        completedRequests: completed,
        activeRequests: this.activeRequests.size,
        uniqueUsers: users.length,
        successCount,
        errorCount,
        successRate: completed > 0 ? successCount / completed : 1,
        avgDurationMs: completed > 0 ? Math.round(totalDurationMs / completed) : 0,
        totalOutputChars,
      },
      users,
      recent: recentEvents,
      active: [...this.activeRequests.values()]
        .map((request) => ({
          ...request,
          elapsedMs: Math.max(0, now - request.startedAtMs),
        }))
        .sort((a, b) => b.startedAtMs - a.startedAtMs),
      series,
    };
  }

  #pushEvent(event) {
    this.events.push(event);
    if (this.events.length > MAX_ANALYTICS_EVENTS) {
      this.events.splice(0, this.events.length - MAX_ANALYTICS_EVENTS);
    }
  }
}

const analyticsStore = new GatewayAnalyticsStore(analyticsEventsPath);
await analyticsStore.load();

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardTemplatePath = path.join(currentDir, "dashboard.html");
const dashboardTemplate = await readFile(dashboardTemplatePath, "utf8");

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
  });
  res.end(html);
}

function unauthorized(res) {
  sendJson(res, 401, { error: "unauthorized" });
}

function getBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getRoutedModel() {
  authStorage.reload();
  modelRegistry.refresh();
  const model = modelRegistry.find(routedProvider, routedModelId);
  if (!model) {
    throw new Error(`Routed model not found: ${routedProvider}/${routedModelId}`);
  }
  return model;
}

function tryParseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n");
}

function convertUserContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text || "" });
      continue;
    }
    if (part.type === "image_url") {
      const url = part.image_url?.url || "";
      const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (match) {
        parts.push({ type: "image", mimeType: match[1], data: match[2] });
      } else if (url) {
        parts.push({ type: "text", text: `[image url omitted: ${url}]` });
      }
    }
  }

  if (parts.length === 0) return "";
  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => part.text).join("\n");
  }
  return parts;
}

function convertToolResultContent(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];

  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text || "" });
      continue;
    }
    if (part.type === "image_url") {
      const url = part.image_url?.url || "";
      const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (match) {
        parts.push({ type: "image", mimeType: match[1], data: match[2] });
      }
    }
  }

  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

function convertTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || "",
      parameters: tool.function.parameters || { type: "object", properties: {} },
    }));
}

function convertChatRequestToContext(body) {
  const systemParts = [];
  const messages = [];
  const timestampBase = Date.now();
  let index = 0;

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const timestamp = timestampBase + index++;
    if (!message || !message.role) continue;

    if (message.role === "system" || message.role === "developer") {
      const text = extractTextFromContent(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === "user") {
      messages.push({
        role: "user",
        content: convertUserContent(message.content),
        timestamp,
      });
      continue;
    }

    if (message.role === "assistant") {
      const content = [];
      const text = extractTextFromContent(message.content);
      if (text) content.push({ type: "text", text });

      for (const toolCall of message.tool_calls || []) {
        if (toolCall?.type !== "function" || !toolCall.function?.name) continue;
        content.push({
          type: "toolCall",
          id: toolCall.id || `call_${timestamp}_${content.length}`,
          name: toolCall.function.name,
          arguments: tryParseJson(toolCall.function.arguments || "{}", {}),
        });
      }

      messages.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "corp",
        model: body.model || "assistant",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: message.tool_calls?.length ? "toolUse" : "stop",
        timestamp,
      });
      continue;
    }

    if (message.role === "tool") {
      messages.push({
        role: "toolResult",
        toolCallId: message.tool_call_id || `tool_${timestamp}`,
        toolName: message.name || "tool",
        content: convertToolResultContent(message.content),
        isError: false,
        timestamp,
      });
    }
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages,
    tools: convertTools(body.tools),
  };
}

function buildMockText(body) {
  const lastUser = Array.isArray(body.messages)
    ? [...body.messages].reverse().find((message) => message?.role === "user")
    : null;
  const content = Array.isArray(lastUser?.content)
    ? lastUser.content
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("\n")
    : typeof lastUser?.content === "string"
      ? lastUser.content
      : "";

  return `Mock gateway response from A. Requested abstract model: ${body.model || "assistant"}. Last user message: ${content || "<empty>"}`;
}

function sendMockStream(res, body) {
  const text = buildMockText(body);
  const id = `chatcmpl_mock_${Date.now()}`;
  const chunks = text.match(/.{1,24}/g) || [text];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const first = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "assistant",
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(first)}\n\n`);

  for (const chunk of chunks) {
    const event = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "assistant",
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const done = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "assistant",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  res.write(`data: ${JSON.stringify(done)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();

  return {
    status: "success",
    finishReason: "stop",
    outputChars: text.length,
    toolCalls: 0,
    routing: {
      provider: "mock",
      model: "assistant",
      api: "mock",
    },
  };
}

function mapFinishReason(reason) {
  if (reason === "toolUse") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}

function writeOpenAIChunk(res, id, modelName, delta, finishReason = null) {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

async function streamViaPiAuth(res, body) {
  const model = getRoutedModel();
  const resolvedAuth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!resolvedAuth.ok) {
    throw new Error(`Auth resolution failed for ${model.provider}/${model.id}: ${resolvedAuth.error}`);
  }

  const context = convertChatRequestToContext(body);
  const reasoning = body.reasoning_effort || body.reasoning?.effort;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;

  console.log("[gateway] routed via Pi auth", {
    abstractModel: body.model,
    provider: model.provider,
    routedModel: model.id,
    api: model.api,
    stream: !!body.stream,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
  });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const streamId = `chatcmpl_pi_${Date.now()}`;
  let sentRole = false;
  let toolIndex = 0;
  let outputChars = 0;
  let toolCalls = 0;
  let finishReason = "stop";

  const eventStream = piStreamSimple(model, context, {
    apiKey: resolvedAuth.apiKey,
    headers: resolvedAuth.headers,
    maxTokens,
    temperature: body.temperature,
    reasoning,
    sessionId: typeof body.user === "string" ? body.user : undefined,
  });

  for await (const event of eventStream) {
    if (!sentRole && event.type === "start") {
      writeOpenAIChunk(res, streamId, body.model || "assistant", { role: "assistant" });
      sentRole = true;
      continue;
    }

    if (event.type === "text_delta") {
      if (!sentRole) {
        writeOpenAIChunk(res, streamId, body.model || "assistant", { role: "assistant" });
        sentRole = true;
      }
      if (event.delta) {
        outputChars += event.delta.length;
        writeOpenAIChunk(res, streamId, body.model || "assistant", { content: event.delta });
      }
      continue;
    }

    if (event.type === "toolcall_end") {
      toolCalls += 1;
      if (!sentRole) {
        writeOpenAIChunk(res, streamId, body.model || "assistant", { role: "assistant" });
        sentRole = true;
      }
      writeOpenAIChunk(res, streamId, body.model || "assistant", {
        tool_calls: [
          {
            index: toolIndex++,
            id: event.toolCall.id,
            type: "function",
            function: {
              name: event.toolCall.name,
              arguments: JSON.stringify(event.toolCall.arguments),
            },
          },
        ],
      });
      continue;
    }

    if (event.type === "done") {
      finishReason = mapFinishReason(event.reason);
      writeOpenAIChunk(res, streamId, body.model || "assistant", {}, finishReason);
      res.write("data: [DONE]\n\n");
      res.end();
      return {
        status: "success",
        finishReason,
        outputChars,
        toolCalls,
        routing: {
          provider: model.provider,
          model: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
        },
      };
    }

    if (event.type === "error") {
      if (!sentRole) {
        writeOpenAIChunk(res, streamId, body.model || "assistant", { role: "assistant" });
        sentRole = true;
      }
      const message = event.error?.errorMessage || `Gateway upstream error (${event.reason})`;
      outputChars += message.length;
      writeOpenAIChunk(res, streamId, body.model || "assistant", { content: message });
      writeOpenAIChunk(res, streamId, body.model || "assistant", {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
      return {
        status: "error",
        finishReason: "stop",
        errorMessage: message,
        outputChars,
        toolCalls,
        routing: {
          provider: model.provider,
          model: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
        },
      };
    }
  }

  writeOpenAIChunk(res, streamId, body.model || "assistant", {}, "stop");
  res.write("data: [DONE]\n\n");
  res.end();
  return {
    status: "success",
    finishReason: "stop",
    outputChars,
    toolCalls,
    routing: {
      provider: model.provider,
      model: model.id,
      api: model.api,
      baseUrl: model.baseUrl,
    },
  };
}

async function handleChatCompletions(req, res) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) return unauthorized(res);

  const body = await readJson(req);
  const client = getClientIdentity(req);
  const request = getRequestSummary(body);
  const active = analyticsStore.startRequest({
    client,
    request,
    routing: {
      provider: MOCK_MODE ? "mock" : routedProvider,
      model: MOCK_MODE ? "assistant" : routedModelId,
      api: MOCK_MODE ? "mock" : "pi-auth",
    },
  });

  try {
    if (MOCK_MODE) {
      console.log("[gateway] chat.completions mock", {
        requestedModel: body.model,
        stream: !!body.stream,
        messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
        identity: client.identity,
        client: client.client,
      });
      const result = sendMockStream(res, body);
      await analyticsStore.finishRequest(active, result);
      return;
    }

    if (body.stream === false) {
      await analyticsStore.finishRequest(active, {
        status: "error",
        finishReason: "stop",
        errorMessage: "unsupported_mode",
      });
      return sendJson(res, 400, {
        error: "unsupported_mode",
        message: "This gateway currently supports only stream=true requests.",
      });
    }

    const result = await streamViaPiAuth(res, body);
    await analyticsStore.finishRequest(active, result);
  } catch (error) {
    await analyticsStore.finishRequest(active, {
      status: "error",
      finishReason: "stop",
      errorMessage: String(error?.message || error),
    });
    throw error;
  }
}

function getClientIdentity(req) {
  const user = cleanHeader(req.headers["x-officeagent-user"]) || "unknown-user";
  const domain = cleanHeader(req.headers["x-officeagent-domain"]);
  const host = cleanHeader(req.headers["x-officeagent-host"]) || "unknown-host";
  const client = cleanHeader(req.headers["x-officeagent-client"]) || "unknown";
  const identityHeader = cleanHeader(req.headers["x-officeagent-identity"]);
  const identity = identityHeader || (domain ? `${domain}\\${user}` : user);

  return {
    identity,
    user,
    domain,
    host,
    client,
    remoteAddress: normalizeRemoteAddress(req.socket?.remoteAddress),
    userAgent: cleanHeader(req.headers["user-agent"]),
  };
}

function getRequestSummary(body) {
  return {
    abstractModel: typeof body.model === "string" && body.model ? body.model : "assistant",
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    promptChars: estimatePromptChars(body.messages),
    stream: body.stream !== false,
  };
}

function estimatePromptChars(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const message of messages) {
    total += extractTextFromContent(message?.content).length;
  }
  return total;
}

function cleanHeader(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return "";
  return first.trim().slice(0, 200);
}

function normalizeRemoteAddress(value) {
  if (!value) return "";
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function summarizeUsers(events) {
  const byUser = new Map();

  for (const event of events) {
    const identity = event.client?.identity || "unknown-user";
    let summary = byUser.get(identity);
    if (!summary) {
      summary = {
        identity,
        user: event.client?.user || "unknown-user",
        domain: event.client?.domain || "",
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        avgDurationMs: 0,
        totalDurationMs: 0,
        totalOutputChars: 0,
        lastSeenAt: event.completedAt,
        lastHost: event.client?.host || "unknown-host",
        clients: {},
        hosts: new Set(),
      };
      byUser.set(identity, summary);
    }

    summary.requestCount += 1;
    summary.totalDurationMs += Number(event.durationMs || 0);
    summary.totalOutputChars += Number(event.metrics?.outputChars || 0);
    summary.lastSeenAt = event.completedAt > summary.lastSeenAt ? event.completedAt : summary.lastSeenAt;
    summary.lastHost = event.client?.host || summary.lastHost;
    summary.hosts.add(event.client?.host || "unknown-host");
    summary.clients[event.client?.client || "unknown"] = (summary.clients[event.client?.client || "unknown"] || 0) + 1;

    if (event.result?.status === "success") summary.successCount += 1;
    else summary.errorCount += 1;
  }

  return [...byUser.values()]
    .map((summary) => ({
      identity: summary.identity,
      user: summary.user,
      domain: summary.domain,
      requestCount: summary.requestCount,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      avgDurationMs: summary.requestCount > 0 ? Math.round(summary.totalDurationMs / summary.requestCount) : 0,
      totalOutputChars: summary.totalOutputChars,
      lastSeenAt: summary.lastSeenAt,
      lastHost: summary.lastHost,
      hostCount: summary.hosts.size,
      clients: summary.clients,
    }))
    .sort((a, b) => b.requestCount - a.requestCount || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function buildMinuteSeries(events, minutes, now = Date.now()) {
  const endMinute = Math.floor(now / 60000) * 60000;
  const startMinute = endMinute - (minutes - 1) * 60000;
  const points = Array.from({ length: minutes }, (_, index) => ({
    minuteStartMs: startMinute + index * 60000,
    label: formatMinuteLabel(startMinute + index * 60000),
    requests: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
  }));

  for (const event of events) {
    const completedAtMs = Number(event.completedAtMs || 0);
    if (completedAtMs < startMinute || completedAtMs >= endMinute + 60000) continue;
    const index = Math.floor((completedAtMs - startMinute) / 60000);
    const point = points[index];
    if (!point) continue;
    point.requests += 1;
    if (event.result?.status === "success") point.success += 1;
    else point.error += 1;
    point.totalDurationMs += Number(event.durationMs || 0);
  }

  return points.map((point) => ({
    label: point.label,
    requests: point.requests,
    success: point.success,
    error: point.error,
    avgDurationMs: point.requests > 0 ? Math.round(point.totalDurationMs / point.requests) : 0,
  }));
}

function formatMinuteLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderDashboardHtml() {
  return dashboardTemplate.replaceAll("__ANALYTICS_WINDOW_MINUTES__", String(ANALYTICS_WINDOW_MINUTES));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: "missing_url" });

    if (req.method === "GET" && req.url === "/health") {
      let routed = null;
      try {
        const model = getRoutedModel();
        const auth = await modelRegistry.getApiKeyAndHeaders(model);
        routed = {
          provider: model.provider,
          model: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
          authOk: auth.ok,
        };
      } catch (error) {
        routed = {
          provider: routedProvider,
          model: routedModelId,
          error: String(error?.message || error),
          authOk: false,
        };
      }

      return sendJson(res, 200, {
        ok: true,
        mockMode: MOCK_MODE,
        authPath,
        analyticsEventsPath,
        dashboardUrl: `http://localhost:${PORT}/dashboard`,
        routed,
      });
    }

    if (req.method === "GET" && req.url === "/dashboard") {
      return sendHtml(res, 200, renderDashboardHtml());
    }

    if (req.method === "GET" && req.url === "/analytics/summary") {
      return sendJson(res, 200, analyticsStore.getSummary());
    }

    if (req.method === "GET" && req.url === "/v1/models") {
      const token = getBearer(req);
      if (token !== GATEWAY_TOKEN) return unauthorized(res);
      return sendJson(res, 200, {
        object: "list",
        data: [
          {
            id: "assistant",
            object: "model",
            owned_by: "office-agent",
          },
        ],
      });
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      return handleChatCompletions(req, res);
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error("[gateway] error", error);
    if (!res.headersSent) {
      return sendJson(res, 500, { error: "internal_error", message: String(error?.message || error) });
    }
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[gateway] abstract model assistant -> ${MOCK_MODE ? "mock" : `${routedProvider}/${routedModelId}`}`);
  console.log(`[gateway] auth path: ${authPath}`);
  console.log(`[gateway] analytics dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[gateway] analytics log: ${analyticsEventsPath}`);
});
