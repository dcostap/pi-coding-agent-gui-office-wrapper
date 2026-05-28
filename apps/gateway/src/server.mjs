import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { streamSimple as piStreamSimple } from "@earendil-works/pi-ai";
import { OFFICE_AGENT_VFS_ROOTS } from "@office-agent/runtime";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(serverDir, "..");

function loadLocalEnv() {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(gatewayRoot, fileName);
    if (!existsSync(filePath)) continue;

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] != null) continue;

      process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

loadLocalEnv();

const PORT = Number(process.env.OFFICE_AGENT_GATEWAY_PORT || process.env.PORT || 8082);
const HOST = process.env.HOST || "0.0.0.0";
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "officeagent-demo-2026";
const MOCK_MODE = process.env.MOCK_MODE === "1";
const DEFAULT_ANALYTICS_RANGE = "30m";
const ANALYTICS_RANGES = {
  "30m": { label: "Last 30 minutes", durationMs: 30 * 60 * 1000, bucketMs: 60 * 1000 },
  "24h": { label: "Last 24 hours", durationMs: 24 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
  "7d": { label: "Last 7 days", durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
};
const MAX_ANALYTICS_EVENTS = 5000;
const MAX_ANALYTICS_RECENT_EVENTS = 40;
const MAX_ANALYTICS_ERROR_MESSAGE_CHARS = 240;
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const VFS_DEFAULT_READ_LIMIT = 2000;
const VFS_DEFAULT_LIST_LIMIT = 500;
const VFS_DEFAULT_FIND_LIMIT = 1000;
const VFS_DEFAULT_GREP_LIMIT = 100;
const VFS_MAX_OUTPUT_BYTES = 1024 * 1024;
const VFS_TIMEOUT_MS = Number(process.env.OFFICE_AGENT_VFS_TIMEOUT_MS || 30_000);
const VFS_BASE_DIR = process.env.OFFICE_AGENT_VFS_BASE_DIR || "/srv/officeagent/vfs";
const VFS_ROOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const authPath =
  process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");
const modelsPath =
  process.env.OFFICE_AGENT_GATEWAY_MODELS_PATH ||
  path.join(localAppData, "OfficeAgent", "gateway-auth", "models.json");
const analyticsDir =
  process.env.OFFICE_AGENT_GATEWAY_ANALYTICS_DIR || path.join(localAppData, "OfficeAgent", "gateway-analytics");
const analyticsEventsPath = path.join(analyticsDir, "events.jsonl");
const defaultRoutedProvider = process.env.GATEWAY_UPSTREAM_PROVIDER || "openai-codex";
const sparkRoute = {
  provider: process.env.GATEWAY_SPARK_UPSTREAM_PROVIDER || defaultRoutedProvider,
  modelId: process.env.GATEWAY_SPARK_UPSTREAM_MODEL || process.env.GATEWAY_UPSTREAM_MODEL || "gpt-5.3-codex-spark",
};
const gpt55Route = {
  provider:
    process.env.GATEWAY_GPT55_UPSTREAM_PROVIDER ||
    process.env.GATEWAY_GPT_5_5_UPSTREAM_PROVIDER ||
    defaultRoutedProvider,
  modelId:
    process.env.GATEWAY_GPT55_UPSTREAM_MODEL ||
    process.env.GATEWAY_GPT_5_5_UPSTREAM_MODEL ||
    // The OfficeAgent client asks the gateway for abstract model "gpt-5.5".
    // Route that abstract model to Pi's current upstream Codex model by default.
    "gpt-5.5",
};
const requestyAbstractModelId = process.env.GATEWAY_REQUESTY_ABSTRACT_MODEL || "azure/gpt-5.4@swedencentral";
const requestyRoute = {
  provider:
    process.env.GATEWAY_REQUESTY_UPSTREAM_PROVIDER ||
    process.env.GATEWAY_GPT54_REQUESTY_UPSTREAM_PROVIDER ||
    "requesty",
  modelId:
    process.env.GATEWAY_REQUESTY_UPSTREAM_MODEL ||
    process.env.GATEWAY_GPT54_REQUESTY_UPSTREAM_MODEL ||
    "azure/gpt-5.4@swedencentral",
};
const routedProvider = sparkRoute.provider;
const routedModelId = sparkRoute.modelId;

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
          this.#pushEvent(normalizeAnalyticsEvent(JSON.parse(trimmed)));
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
    const event = normalizeAnalyticsEvent({
      schemaVersion: 2,
      id: active.id,
      startedAt: active.startedAt,
      startedAtMs: active.startedAtMs,
      completedAt: new Date(completedAtMs).toISOString(),
      completedAtMs,
      durationMs: Math.max(0, completedAtMs - active.startedAtMs),
      client: active.client,
      request: active.request,
      routing: {
        ...(result.routing || active.routing),
        mockMode: MOCK_MODE,
      },
      result: {
        status: result.status || "success",
        finishReason: result.finishReason || "stop",
        errorCode: result.errorCode || null,
        errorMessage: truncateText(result.errorMessage || null, MAX_ANALYTICS_ERROR_MESSAGE_CHARS),
      },
      metrics: {
        outputChars: Number(result.outputChars || 0),
        outputTokens: result.outputTokens == null ? estimateTokensFromChars(result.outputChars || 0) : Number(result.outputTokens),
        toolCalls: Number(result.toolCalls || 0),
        toolCallNames: Array.isArray(result.toolCallNames) ? result.toolCallNames.slice(0, 50) : [],
        firstTokenMs: result.firstTokenMs == null ? null : Number(result.firstTokenMs),
      },
    });

    this.#pushEvent(event);
    try {
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      console.warn("[gateway] analytics append warning", error);
    }
    return event;
  }

  getSummary(rangeId = DEFAULT_ANALYTICS_RANGE) {
    const now = Date.now();
    const range = resolveAnalyticsRange(rangeId, this.events, now);
    const currentEvents = filterEventsByTime(this.events, range.startMs, range.endMs);
    const previousEvents = range.previousStartMs == null
      ? []
      : filterEventsByTime(this.events, range.previousStartMs, range.previousEndMs);
    const totals = summarizeTotals(currentEvents, this.activeRequests.size);
    const previous = range.previousStartMs == null ? null : summarizeTotals(previousEvents, 0);
    const users = summarizeUsers(currentEvents);

    return {
      generatedAt: new Date(now).toISOString(),
      range: {
        id: range.id,
        label: range.label,
        startAt: new Date(range.startMs).toISOString(),
        endAt: new Date(range.endMs).toISOString(),
        bucketMs: range.bucketMs,
        previousStartAt: range.previousStartMs == null ? null : new Date(range.previousStartMs).toISOString(),
        previousEndAt: range.previousEndMs == null ? null : new Date(range.previousEndMs).toISOString(),
      },
      gateway: {
        host: HOST,
        port: PORT,
        mockMode: MOCK_MODE,
        analyticsEventsPath,
        routedProvider,
        routedModelId,
        routes: {
          assistant: sparkRoute,
          "gpt-5.5": gpt55Route,
          [requestyAbstractModelId]: requestyRoute,
        },
      },
      totals,
      previous,
      deltas: previous ? summarizeDeltas(totals, previous) : null,
      users,
      hosts: summarizeHosts(currentEvents),
      clients: summarizeClients(currentEvents),
      models: summarizeModels(currentEvents),
      tools: summarizeTools(currentEvents),
      errors: summarizeErrors(currentEvents),
      recent: currentEvents.slice(-MAX_ANALYTICS_RECENT_EVENTS).reverse(),
      active: [...this.activeRequests.values()]
        .map((request) => ({
          ...request,
          elapsedMs: Math.max(0, now - request.startedAtMs),
        }))
        .sort((a, b) => b.startedAtMs - a.startedAtMs),
      series: buildTimeSeries(currentEvents, range.startMs, range.endMs, range.bucketMs),
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

const dashboardTemplatePath = path.join(serverDir, "dashboard.html");
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

async function readJson(req, options = {}) {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error(`JSON request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getAbstractModelRoute(abstractModel) {
  if (abstractModel === "gpt-5.5") return gpt55Route;
  if (abstractModel === requestyAbstractModelId) return requestyRoute;
  return sparkRoute;
}

function getRoutedModel(abstractModel = "assistant") {
  const route = getAbstractModelRoute(abstractModel);
  authStorage.reload();
  modelRegistry.refresh();
  const model = modelRegistry.find(route.provider, route.modelId);
  if (!model) {
    const providerModels = modelRegistry
      .getAll()
      .filter((candidate) => candidate.provider === route.provider)
      .map((candidate) => candidate.id)
      .sort();
    const availableHint = providerModels.length > 0
      ? ` Available ${route.provider} models: ${providerModels.join(", ")}.`
      : ` No models are registered for provider ${route.provider}.`;
    throw new Error(
      `Routed model not found for ${abstractModel}: ${route.provider}/${route.modelId}.${availableHint}`,
    );
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
    toolCallNames: [],
    firstTokenMs: 0,
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
  const model = getRoutedModel(body.model);
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

  const streamStartedAtMs = Date.now();
  const streamId = `chatcmpl_pi_${streamStartedAtMs}`;
  let sentRole = false;
  let toolIndex = 0;
  let outputChars = 0;
  let toolCalls = 0;
  let toolCallNames = [];
  let firstTokenMs = null;
  let finishReason = "stop";

  function markFirstToken() {
    if (firstTokenMs == null) firstTokenMs = Math.max(0, Date.now() - streamStartedAtMs);
  }

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
        markFirstToken();
        outputChars += event.delta.length;
        writeOpenAIChunk(res, streamId, body.model || "assistant", { content: event.delta });
      }
      continue;
    }

    if (event.type === "toolcall_end") {
      markFirstToken();
      toolCalls += 1;
      toolCallNames.push(cleanMetricName(event.toolCall?.name, "unknown"));
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
        toolCallNames,
        firstTokenMs,
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
      markFirstToken();
      outputChars += message.length;
      writeOpenAIChunk(res, streamId, body.model || "assistant", { content: message });
      writeOpenAIChunk(res, streamId, body.model || "assistant", {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
      return {
        status: "error",
        finishReason: "stop",
        errorCode: event.reason || "upstream_error",
        errorMessage: message,
        outputChars,
        toolCalls,
        toolCallNames,
        firstTokenMs,
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
    toolCallNames,
    firstTokenMs,
    routing: {
      provider: model.provider,
      model: model.id,
      api: model.api,
      baseUrl: model.baseUrl,
    },
  };
}

async function getConfiguredVfsRoots() {
  return Object.fromEntries(
    OFFICE_AGENT_VFS_ROOTS.map((root) => [root.rootId, {
      ...root,
      rootRealPath: path.resolve(VFS_BASE_DIR, root.folderName),
    }]),
  );
}

function requireVfsAuth(req, res) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) {
    unauthorized(res);
    return false;
  }
  return true;
}

async function handleVfsRequest(req, res, operation) {
  if (!requireVfsAuth(req, res)) return;
  try {
    const body = await readJson(req, { maxBytes: MAX_JSON_BODY_BYTES });
    const roots = await getConfiguredVfsRoots();
    const result = await operation(body, roots, getClientIdentity(req));
    return sendJson(res, 200, result);
  } catch (error) {
    const status = error?.statusCode || 400;
    return sendJson(res, status, {
      ok: false,
      error: {
        code: error?.code || "vfs_error",
        message: sanitizeVfsErrorMessage(String(error?.message || error)),
      },
    });
  }
}

async function handleVfsRoots(_body, roots) {
  return {
    ok: true,
    roots: Object.keys(roots).sort().map((rootId) => ({
      scheme: "virtual",
      authority: rootId,
      uriPrefix: `virtual://${rootId}`,
      rootId,
      displayName: roots[rootId].displayName || rootId,
      ...(roots[rootId].description ? { description: roots[rootId].description } : {}),
      readOnly: true,
    })),
  };
}

async function handleVfsRead(body, roots) {
  const { rootRealPath, virtualPath } = await resolveVfsPath(body, roots, { mustExist: true });
  const stats = await lstat(rootRealPath);
  if (!stats.isFile()) throw createVfsError("not_file", "Virtual path is not a file.");
  const buffer = await readFile(rootRealPath);
  if (buffer.includes(0)) throw createVfsError("binary_file", "Virtual path is not a UTF-8 text file.");
  const text = buffer.toString("utf8");
  if (text.includes("�")) throw createVfsError("binary_file", "Virtual path is not a UTF-8 text file.");
  const lines = text.split("\n");
  const totalLines = lines.length;
  const offset = clampInteger(body.offset, 1, Number.MAX_SAFE_INTEGER, 1);
  const limit = clampInteger(body.limit, 1, 10_000, VFS_DEFAULT_READ_LIMIT);
  if (offset > totalLines) throw createVfsError("offset_out_of_range", `Offset ${offset} is beyond end of file.`);
  const startIndex = offset - 1;
  const endIndex = Math.min(startIndex + limit, lines.length);
  const selected = lines.slice(startIndex, endIndex).join("\n");
  return {
    ok: true,
    path: virtualPath,
    text: selected,
    startLine: offset,
    endLine: endIndex,
    totalLines,
    truncated: endIndex < lines.length,
    ...(endIndex < lines.length ? { nextOffset: endIndex + 1 } : {}),
  };
}

async function handleVfsList(body, roots) {
  const { rootRealPath } = await resolveVfsPath(body, roots, { mustExist: true });
  const stats = await lstat(rootRealPath);
  if (!stats.isDirectory()) throw createVfsError("not_directory", "Virtual path is not a directory.");
  const limit = clampInteger(body.limit, 1, 5000, VFS_DEFAULT_LIST_LIMIT);
  const names = (await readdir(rootRealPath)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const entries = [];
  let limitReached = false;
  for (const name of names) {
    if (entries.length >= limit) {
      limitReached = true;
      break;
    }
    if (name === "." || name === "..") continue;
    const fullPath = path.join(rootRealPath, name);
    const entryStats = await lstat(fullPath).catch(() => undefined);
    if (!entryStats || entryStats.isSymbolicLink()) continue;
    entries.push({ name, isDirectory: entryStats.isDirectory() });
  }
  return { ok: true, entries, limitReached };
}

async function handleVfsFind(body, roots) {
  const { rootRealPath, virtualPath } = await resolveVfsPath(body, roots, { mustExist: true });
  const stats = await lstat(rootRealPath);
  if (!stats.isDirectory()) throw createVfsError("not_directory", "Virtual path is not a directory.");
  const pattern = requireString(body.pattern, "pattern");
  const limit = clampInteger(body.limit, 1, 10_000, VFS_DEFAULT_FIND_LIMIT);
  const { stdout, killedDueToLimit } = await runCommand("rg", [
    "--files",
    "--hidden",
    "--no-require-git",
    "--glob",
    pattern,
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/node_modules/**",
  ], { cwd: rootRealPath, maxBytes: VFS_MAX_OUTPUT_BYTES, allowExitOne: true });
  const paths = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((line) => !line.split("/").includes(".."))
    .slice(0, limit)
    .map((line) => joinVfsRelativePath(virtualPath, line));
  return { ok: true, paths, limitReached: killedDueToLimit || paths.length >= limit };
}

async function handleVfsGrep(body, roots) {
  const { rootRealPath, virtualPath } = await resolveVfsPath(body, roots, { mustExist: true });
  const stats = await lstat(rootRealPath);
  if (!stats.isDirectory() && !stats.isFile()) throw createVfsError("invalid_path", "Virtual grep path is not searchable.");
  const pattern = requireString(body.pattern, "pattern");
  const limit = clampInteger(body.limit, 1, 5000, VFS_DEFAULT_GREP_LIMIT);
  const context = clampInteger(body.context, 0, 20, 0);
  const args = ["--json", "--line-number", "--color=never", "--hidden", "--no-require-git", "--max-filesize", "2M"];
  const searchCwd = stats.isFile() ? path.dirname(rootRealPath) : rootRealPath;
  const searchTarget = stats.isFile() ? path.basename(rootRealPath) : ".";
  const virtualBasePath = stats.isFile() ? path.posix.dirname(virtualPath) : virtualPath;
  if (body.ignoreCase) args.push("--ignore-case");
  if (body.literal) args.push("--fixed-strings");
  if (typeof body.glob === "string" && body.glob.trim()) args.push("--glob", body.glob.trim());
  if (context > 0) args.push("--context", String(context));
  args.push("--", pattern, searchTarget);
  let stdout;
  let killedDueToLimit;
  try {
    ({ stdout, killedDueToLimit } = await runCommand("rg", args, { cwd: searchCwd, maxBytes: VFS_MAX_OUTPUT_BYTES, allowExitOne: true }));
  } catch (error) {
    if (error?.code !== "command_failed" || !String(error?.message || "").includes("failed to start")) {
      throw error;
    }
    return grepWithNodeFallback({
      rootRealPath,
      virtualBasePath,
      searchCwd,
      searchTarget,
      pattern,
      ignoreCase: Boolean(body.ignoreCase),
      literal: Boolean(body.literal),
      glob: typeof body.glob === "string" ? body.glob.trim() : "",
      context,
      limit,
    });
  }
  const matches = [];
  let linesTruncated = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== "match" && event?.type !== "context") continue;
    const rawPath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    const text = String(event.data?.lines?.text ?? "").replace(/\r?\n$/, "");
    if (typeof rawPath !== "string" || typeof lineNumber !== "number") continue;
    if (matches.length >= limit) break;
    const trimmedText = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    if (trimmedText !== text) linesTruncated = true;
    matches.push({
      path: joinVfsRelativePath(virtualBasePath, rawPath.replace(/^[.][\\/]/, "").replaceAll("\\", "/")),
      line: lineNumber,
      text: trimmedText,
      context: event.type === "context",
    });
  }
  return { ok: true, matches, limitReached: killedDueToLimit || matches.length >= limit, linesTruncated };
}

async function grepWithNodeFallback(options) {
  const matcher = createTextMatcher(options.pattern, options.ignoreCase, options.literal);
  const globMatcher = options.glob ? createGlobMatcher(options.glob) : undefined;
  const files = [];
  const startPath = path.resolve(options.searchCwd, options.searchTarget);
  await collectGrepFiles(startPath, options.searchCwd, files, globMatcher);

  const matches = [];
  let linesTruncated = false;
  let limitReached = false;
  for (const filePath of files) {
    if (matches.length >= options.limit) {
      limitReached = true;
      break;
    }
    const text = await readFile(filePath, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const matchedLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher(lines[index])) matchedLines.push(index + 1);
    }
    const emitted = new Set();
    for (const lineNumber of matchedLines) {
      const start = Math.max(1, lineNumber - options.context);
      const end = Math.min(lines.length, lineNumber + options.context);
      for (let current = start; current <= end; current += 1) {
        if (matches.length >= options.limit) {
          limitReached = true;
          break;
        }
        const key = `${filePath}:${current}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        const rawText = lines[current - 1] ?? "";
        const trimmedText = rawText.length > 500 ? `${rawText.slice(0, 500)}…` : rawText;
        if (trimmedText !== rawText) linesTruncated = true;
        const relativePath = path.relative(options.searchCwd, filePath).replaceAll("\\", "/");
        matches.push({
          path: joinVfsRelativePath(options.virtualBasePath, relativePath),
          line: current,
          text: trimmedText,
          context: current !== lineNumber,
        });
      }
      if (limitReached) break;
    }
  }
  return { ok: true, matches, limitReached, linesTruncated, fallback: "node" };
}

async function collectGrepFiles(candidate, baseDir, files, globMatcher) {
  const stats = await lstat(candidate).catch(() => undefined);
  if (!stats || stats.isSymbolicLink()) return;
  if (stats.isFile()) {
    if (stats.size > 2 * 1024 * 1024) return;
    const relativePath = path.relative(baseDir, candidate).replaceAll("\\", "/");
    if (!globMatcher || globMatcher(relativePath) || globMatcher(path.basename(candidate))) files.push(candidate);
    return;
  }
  if (!stats.isDirectory()) return;
  const baseName = path.basename(candidate);
  if (baseName === ".git" || baseName === "node_modules") return;
  const entries = await readdir(candidate).catch(() => []);
  for (const entry of entries) {
    await collectGrepFiles(path.join(candidate, entry), baseDir, files, globMatcher);
  }
}

function createTextMatcher(pattern, ignoreCase, literal) {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  let regex;
  try {
    regex = new RegExp(pattern, ignoreCase ? "i" : "");
  } catch {
    throw createVfsError("invalid_request", "Invalid grep regex pattern.");
  }
  return (line) => regex.test(line);
}

function createGlobMatcher(glob) {
  const normalized = glob.replaceAll("\\", "/");
  const regexText = normalized
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${regexText}$`);
  return (value) => regex.test(value.replaceAll("\\", "/"));
}

async function resolveVfsPath(body, roots, options = {}) {
  const rootId = requireString(body.rootId, "rootId");
  if (!VFS_ROOT_ID_PATTERN.test(rootId)) throw createVfsError("invalid_root", `Invalid virtual root: ${rootId}`, 400);
  const root = roots[rootId];
  const rootPath = root?.rootRealPath;
  if (!rootPath) throw createVfsError("unknown_root", `Unknown virtual root: ${rootId}`, 404);
  const rootReal = await realpath(rootPath).catch(() => {
    throw createVfsError("root_unavailable", `Virtual root is not configured: ${rootId}`, 503);
  });
  const virtualPath = normalizeVfsPath(body.path ?? "/");
  const candidate = path.resolve(rootReal, `.${virtualPath}`);
  const existing = await realpath(candidate).catch((error) => {
    if (options.mustExist) throw createVfsError("not_found", `Virtual path not found: ${virtualPath}`, 404);
    throw error;
  });
  if (!isPathWithin(rootReal, existing)) throw createVfsError("forbidden", "Virtual path escapes its root.", 403);
  return { rootRealPath: existing, rootRealRoot: rootReal, virtualPath };
}

function normalizeVfsPath(value) {
  if (typeof value !== "string") throw createVfsError("invalid_path", "path must be a string");
  if (value.includes("\0") || value.includes("\\") || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    throw createVfsError("invalid_path", "Invalid virtual path.");
  }
  const rawSegments = value.split("/").filter(Boolean);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw createVfsError("invalid_path", "Virtual path traversal is not allowed.");
  }
  const normalized = path.posix.normalize(value.startsWith("/") ? value : `/${value}`);
  if (normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  return `/${segments.join("/")}`;
}

function joinVfsRelativePath(baseVirtualPath, relativePath) {
  const cleanRelative = String(relativePath || "").replace(/^\/+/, "");
  const base = baseVirtualPath === "/" ? "" : baseVirtualPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const joined = [base, cleanRelative].filter(Boolean).join("/");
  return joined ? `/${joined}` : "/";
}

function isPathWithin(parentPath, candidatePath) {
  const rel = path.relative(parentPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw createVfsError("invalid_request", `${name} is required`);
  return value.trim();
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function createVfsError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sanitizeVfsErrorMessage(message) {
  return String(message).replace(/[A-Za-z]:\\[^\s]+/g, "<path>").replace(/\/[^\s]*officeagent[^\s]*/gi, "<path>").slice(0, 500);
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killedDueToLimit = false;
    const timeout = setTimeout(() => {
      killedDueToLimit = true;
      child.kill();
    }, VFS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > options.maxBytes) {
        killedDueToLimit = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(createVfsError("command_failed", `${command} failed to start: ${sanitizeVfsErrorMessage(error.message)}`, 500));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killedDueToLimit) return resolve({ stdout, killedDueToLimit: true });
      if (code === 0 || (options.allowExitOne && code === 1)) return resolve({ stdout, killedDueToLimit: false });
      reject(createVfsError("command_failed", `${command} failed: ${sanitizeVfsErrorMessage(stderr || `exit code ${code}`)}`, 500));
    });
  });
}

async function handleChatCompletions(req, res) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) return unauthorized(res);

  const body = await readJson(req);
  const client = getClientIdentity(req);
  const request = getRequestSummary(body);
  const route = getAbstractModelRoute(body.model);
  const active = analyticsStore.startRequest({
    client,
    request,
    routing: {
      provider: MOCK_MODE ? "mock" : route.provider,
      model: MOCK_MODE ? body.model || "assistant" : route.modelId,
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
        errorCode: "unsupported_mode",
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
      errorCode: "gateway_error",
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
  const toolNames = extractToolNames(body.tools);
  const promptChars = estimatePromptChars(body.messages);
  return {
    abstractModel: typeof body.model === "string" && body.model ? body.model : "assistant",
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    toolCount: toolNames.length,
    toolDefinitionCount: toolNames.length,
    toolNames,
    promptChars,
    promptTokens: estimateTokensFromChars(promptChars),
    hasImages: requestHasImages(body.messages),
    stream: body.stream !== false,
    reasoningEffort: body.reasoning_effort || body.reasoning?.effort || null,
    maxTokens: body.max_completion_tokens ?? body.max_tokens ?? null,
  };
}

function extractToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => cleanMetricName(tool?.function?.name || tool?.name, ""))
    .filter(Boolean)
    .slice(0, 100);
}

function estimatePromptChars(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const message of messages) {
    total += extractTextFromContent(message?.content).length;
  }
  return total;
}

function estimateTokensFromChars(chars) {
  const value = Number(chars || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 4);
}

function requestHasImages(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    const content = message?.content;
    return Array.isArray(content) && content.some((part) => part?.type === "image_url" || part?.type === "image");
  });
}

function cleanHeader(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return "";
  return first.trim().slice(0, 200);
}

function cleanMetricName(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : fallback;
}

function truncateText(value, maxChars) {
  if (value == null) return null;
  const text = String(value);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function normalizeRemoteAddress(value) {
  if (!value) return "";
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function normalizeAnalyticsEvent(event) {
  const completedAtMs = Number(event.completedAtMs || Date.parse(event.completedAt) || Date.now());
  const startedAtMs = Number(event.startedAtMs || Date.parse(event.startedAt) || completedAtMs - Number(event.durationMs || 0));
  const toolNames = Array.isArray(event.request?.toolNames)
    ? event.request.toolNames.map((name) => cleanMetricName(name, "")).filter(Boolean)
    : [];

  return {
    schemaVersion: Number(event.schemaVersion || 1),
    id: event.id || randomUUID(),
    startedAt: event.startedAt || new Date(startedAtMs).toISOString(),
    startedAtMs,
    completedAt: event.completedAt || new Date(completedAtMs).toISOString(),
    completedAtMs,
    durationMs: Number(event.durationMs || Math.max(0, completedAtMs - startedAtMs)),
    client: {
      identity: event.client?.identity || "unknown-user",
      user: event.client?.user || "unknown-user",
      domain: event.client?.domain || "",
      host: event.client?.host || "unknown-host",
      client: event.client?.client || "unknown",
      remoteAddress: event.client?.remoteAddress || "",
      userAgent: event.client?.userAgent || "",
      appVersion: event.client?.appVersion || null,
    },
    request: {
      abstractModel: event.request?.abstractModel || "assistant",
      stream: event.request?.stream !== false,
      messageCount: Number(event.request?.messageCount || 0),
      toolCount: Number(event.request?.toolCount ?? event.request?.toolDefinitionCount ?? toolNames.length),
      toolDefinitionCount: Number(event.request?.toolDefinitionCount ?? event.request?.toolCount ?? toolNames.length),
      toolNames,
      promptChars: Number(event.request?.promptChars || 0),
      promptTokens: event.request?.promptTokens == null
        ? estimateTokensFromChars(event.request?.promptChars || 0)
        : Number(event.request.promptTokens),
      hasImages: Boolean(event.request?.hasImages),
      reasoningEffort: event.request?.reasoningEffort || null,
      maxTokens: event.request?.maxTokens ?? null,
    },
    routing: {
      provider: event.routing?.provider || "unknown",
      model: event.routing?.model || "unknown",
      api: event.routing?.api || "unknown",
      baseUrl: event.routing?.baseUrl || null,
      mockMode: Boolean(event.routing?.mockMode),
    },
    result: {
      status: event.result?.status === "error" ? "error" : "success",
      finishReason: event.result?.finishReason || "stop",
      errorCode: event.result?.errorCode || null,
      errorMessage: truncateText(event.result?.errorMessage || null, MAX_ANALYTICS_ERROR_MESSAGE_CHARS),
    },
    metrics: {
      outputChars: Number(event.metrics?.outputChars || 0),
      outputTokens: event.metrics?.outputTokens == null
        ? estimateTokensFromChars(event.metrics?.outputChars || 0)
        : Number(event.metrics.outputTokens),
      toolCalls: Number(event.metrics?.toolCalls || 0),
      toolCallNames: Array.isArray(event.metrics?.toolCallNames)
        ? event.metrics.toolCallNames.map((name) => cleanMetricName(name, "")).filter(Boolean).slice(0, 50)
        : [],
      firstTokenMs: event.metrics?.firstTokenMs == null ? null : Number(event.metrics.firstTokenMs),
    },
  };
}

function resolveAnalyticsRange(rangeId, events, now) {
  const requested = String(rangeId || DEFAULT_ANALYTICS_RANGE).toLowerCase();
  if (requested === "all") {
    const firstEventMs = events.reduce((min, event) => Math.min(min, Number(event.completedAtMs || now)), now);
    const startMs = events.length > 0 ? firstEventMs : now - ANALYTICS_RANGES[DEFAULT_ANALYTICS_RANGE].durationMs;
    return {
      id: "all",
      label: "All retained events",
      startMs,
      endMs: now,
      bucketMs: chooseBucketMs(Math.max(1, now - startMs)),
      previousStartMs: null,
      previousEndMs: null,
    };
  }

  const definition = ANALYTICS_RANGES[requested] || ANALYTICS_RANGES[DEFAULT_ANALYTICS_RANGE];
  const id = ANALYTICS_RANGES[requested] ? requested : DEFAULT_ANALYTICS_RANGE;
  const startMs = now - definition.durationMs;
  return {
    id,
    label: definition.label,
    startMs,
    endMs: now,
    bucketMs: definition.bucketMs,
    previousStartMs: startMs - definition.durationMs,
    previousEndMs: startMs,
  };
}

function chooseBucketMs(durationMs) {
  const buckets = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
  return buckets.find((bucketMs) => durationMs / bucketMs <= 160) || buckets[buckets.length - 1];
}

function filterEventsByTime(events, startMs, endMs) {
  return events.filter((event) => {
    const completedAtMs = Number(event.completedAtMs || 0);
    return completedAtMs >= startMs && completedAtMs <= endMs;
  });
}

function summarizeTotals(events, activeRequests) {
  const completedRequests = events.length;
  const successCount = events.filter((event) => event.result?.status === "success").length;
  const errorCount = completedRequests - successCount;
  const durations = events.map((event) => Number(event.durationMs || 0));
  const firstTokenValues = events
    .map((event) => event.metrics?.firstTokenMs)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);
  const totalFirstTokenMs = firstTokenValues.reduce((sum, value) => sum + value, 0);
  const uniqueUsers = new Set(events.map((event) => event.client?.identity || "unknown-user")).size;

  return {
    completedRequests,
    activeRequests,
    uniqueUsers,
    successCount,
    errorCount,
    successRate: completedRequests > 0 ? successCount / completedRequests : 1,
    avgDurationMs: completedRequests > 0 ? Math.round(totalDurationMs / completedRequests) : 0,
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
    p99DurationMs: percentile(durations, 99),
    avgFirstTokenMs: firstTokenValues.length > 0 ? Math.round(totalFirstTokenMs / firstTokenValues.length) : 0,
    totalDurationMs,
    totalPromptChars: events.reduce((sum, event) => sum + Number(event.request?.promptChars || 0), 0),
    totalOutputChars: events.reduce((sum, event) => sum + Number(event.metrics?.outputChars || 0), 0),
    totalPromptTokens: events.reduce((sum, event) => sum + Number(event.request?.promptTokens || 0), 0),
    totalOutputTokens: events.reduce((sum, event) => sum + Number(event.metrics?.outputTokens || 0), 0),
    totalTokens: events.reduce((sum, event) => sum + Number(event.request?.promptTokens || 0) + Number(event.metrics?.outputTokens || 0), 0),
    avgTokensPerRequest: completedRequests > 0
      ? Math.round(events.reduce((sum, event) => sum + Number(event.request?.promptTokens || 0) + Number(event.metrics?.outputTokens || 0), 0) / completedRequests)
      : 0,
    totalToolCalls: events.reduce((sum, event) => sum + Number(event.metrics?.toolCalls || 0), 0),
    imageRequestCount: events.filter((event) => event.request?.hasImages).length,
  };
}

function percentile(values, percentileValue) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function summarizeDeltas(current, previous) {
  const keys = [
    "completedRequests",
    "uniqueUsers",
    "totalTokens",
    "totalPromptTokens",
    "totalOutputTokens",
    "avgTokensPerRequest",
    "totalDurationMs",
    "successRate",
    "avgDurationMs",
    "totalOutputChars",
    "totalToolCalls",
  ];
  return Object.fromEntries(keys.map((key) => [key, deltaMetric(current[key], previous[key])]));
}

function deltaMetric(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const value = current - previous;
  return {
    value,
    percent: previous === 0 ? (current === 0 ? 0 : 1) : value / previous,
  };
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
        durations: [],
        totalDurationMs: 0,
        totalPromptTokens: 0,
        totalOutputTokens: 0,
        totalOutputChars: 0,
        totalToolCalls: 0,
        lastSeenAt: event.completedAt,
        lastHost: event.client?.host || "unknown-host",
        clients: {},
        hosts: new Set(),
      };
      byUser.set(identity, summary);
    }

    summary.requestCount += 1;
    summary.durations.push(Number(event.durationMs || 0));
    summary.totalDurationMs += Number(event.durationMs || 0);
    summary.totalPromptTokens += Number(event.request?.promptTokens || 0);
    summary.totalOutputTokens += Number(event.metrics?.outputTokens || 0);
    summary.totalOutputChars += Number(event.metrics?.outputChars || 0);
    summary.totalToolCalls += Number(event.metrics?.toolCalls || 0);
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
      successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
      avgDurationMs: average(summary.durations),
      p95DurationMs: percentile(summary.durations, 95),
      totalDurationMs: summary.totalDurationMs,
      totalPromptTokens: summary.totalPromptTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalTokens: summary.totalPromptTokens + summary.totalOutputTokens,
      avgTokensPerRequest: summary.requestCount > 0 ? Math.round((summary.totalPromptTokens + summary.totalOutputTokens) / summary.requestCount) : 0,
      totalOutputChars: summary.totalOutputChars,
      totalToolCalls: summary.totalToolCalls,
      lastSeenAt: summary.lastSeenAt,
      lastHost: summary.lastHost,
      hostCount: summary.hosts.size,
      clients: summary.clients,
    }))
    .sort((a, b) => b.requestCount - a.requestCount || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function summarizeHosts(events) {
  const byHost = new Map();
  for (const event of events) {
    const host = event.client?.host || "unknown-host";
    const summary = getOrCreateGroup(byHost, host, () => ({ host, requestCount: 0, successCount: 0, errorCount: 0, durations: [], users: new Set(), lastSeenAt: event.completedAt }));
    summary.requestCount += 1;
    summary.durations.push(Number(event.durationMs || 0));
    summary.users.add(event.client?.identity || "unknown-user");
    summary.lastSeenAt = event.completedAt > summary.lastSeenAt ? event.completedAt : summary.lastSeenAt;
    if (event.result?.status === "success") summary.successCount += 1;
    else summary.errorCount += 1;
  }
  return [...byHost.values()].map((summary) => ({
    host: summary.host,
    requestCount: summary.requestCount,
    uniqueUsers: summary.users.size,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
    avgDurationMs: average(summary.durations),
    p95DurationMs: percentile(summary.durations, 95),
    lastSeenAt: summary.lastSeenAt,
  })).sort(sortByRequestCount);
}

function summarizeClients(events) {
  const byClient = new Map();
  for (const event of events) {
    const client = event.client?.client || "unknown";
    const summary = getOrCreateGroup(byClient, client, () => ({ client, requestCount: 0, successCount: 0, errorCount: 0, durations: [] }));
    summary.requestCount += 1;
    summary.durations.push(Number(event.durationMs || 0));
    if (event.result?.status === "success") summary.successCount += 1;
    else summary.errorCount += 1;
  }
  return [...byClient.values()].map((summary) => ({
    client: summary.client,
    requestCount: summary.requestCount,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
    avgDurationMs: average(summary.durations),
  })).sort(sortByRequestCount);
}

function summarizeModels(events) {
  const byModel = new Map();
  for (const event of events) {
    const provider = event.routing?.provider || "unknown";
    const model = event.routing?.model || "unknown";
    const key = `${provider}/${model}`;
    const summary = getOrCreateGroup(byModel, key, () => ({ provider, model, requestCount: 0, successCount: 0, errorCount: 0, durations: [], totalTokens: 0 }));
    summary.requestCount += 1;
    summary.durations.push(Number(event.durationMs || 0));
    summary.totalTokens += Number(event.request?.promptTokens || 0) + Number(event.metrics?.outputTokens || 0);
    if (event.result?.status === "success") summary.successCount += 1;
    else summary.errorCount += 1;
  }
  return [...byModel.values()].map((summary) => ({
    provider: summary.provider,
    model: summary.model,
    requestCount: summary.requestCount,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    successRate: summary.requestCount > 0 ? summary.successCount / summary.requestCount : 1,
    avgDurationMs: average(summary.durations),
    p95DurationMs: percentile(summary.durations, 95),
    totalTokens: summary.totalTokens,
  })).sort(sortByRequestCount);
}

function summarizeTools(events) {
  const byTool = new Map();
  for (const event of events) {
    for (const name of event.request?.toolNames || []) {
      const summary = getOrCreateGroup(byTool, name, () => ({ name, definedCount: 0, callCount: 0 }));
      summary.definedCount += 1;
    }
    const callNames = event.metrics?.toolCallNames || [];
    for (const name of callNames) {
      const summary = getOrCreateGroup(byTool, name, () => ({ name, definedCount: 0, callCount: 0 }));
      summary.callCount += 1;
    }
    if (Number(event.metrics?.toolCalls || 0) > 0 && callNames.length === 0) {
      const summary = getOrCreateGroup(byTool, "unknown", () => ({ name: "unknown", definedCount: 0, callCount: 0 }));
      summary.callCount += Number(event.metrics?.toolCalls || 0);
    }
  }
  return [...byTool.values()].sort((a, b) => b.callCount - a.callCount || b.definedCount - a.definedCount || a.name.localeCompare(b.name));
}

function summarizeErrors(events) {
  const byError = new Map();
  for (const event of events) {
    if (event.result?.status !== "error") continue;
    const errorCode = event.result?.errorCode || "error";
    const errorMessage = event.result?.errorMessage || "Unknown error";
    const key = `${errorCode}\n${errorMessage}`;
    const summary = getOrCreateGroup(byError, key, () => ({ errorCode, errorMessage, count: 0, lastSeenAt: event.completedAt }));
    summary.count += 1;
    summary.lastSeenAt = event.completedAt > summary.lastSeenAt ? event.completedAt : summary.lastSeenAt;
  }
  return [...byError.values()].sort((a, b) => b.count - a.count || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function buildTimeSeries(events, startMs, endMs, bucketMs) {
  const firstBucketMs = Math.floor(startMs / bucketMs) * bucketMs;
  const points = [];
  for (let bucketStartMs = firstBucketMs; bucketStartMs < endMs; bucketStartMs += bucketMs) {
    points.push({
      bucketStart: new Date(bucketStartMs).toISOString(),
      bucketStartMs,
      label: formatBucketLabel(bucketStartMs, bucketMs),
      requests: 0,
      success: 0,
      error: 0,
      durations: [],
      promptTokens: 0,
      outputTokens: 0,
      outputChars: 0,
      toolCalls: 0,
    });
  }

  for (const event of events) {
    const completedAtMs = Number(event.completedAtMs || 0);
    const index = Math.floor((completedAtMs - firstBucketMs) / bucketMs);
    const point = points[index];
    if (!point) continue;
    point.requests += 1;
    if (event.result?.status === "success") point.success += 1;
    else point.error += 1;
    point.durations.push(Number(event.durationMs || 0));
    point.promptTokens += Number(event.request?.promptTokens || 0);
    point.outputTokens += Number(event.metrics?.outputTokens || 0);
    point.outputChars += Number(event.metrics?.outputChars || 0);
    point.toolCalls += Number(event.metrics?.toolCalls || 0);
  }

  return points.map((point) => ({
    bucketStart: point.bucketStart,
    label: point.label,
    requests: point.requests,
    success: point.success,
    error: point.error,
    avgDurationMs: average(point.durations),
    p50DurationMs: percentile(point.durations, 50),
    p95DurationMs: percentile(point.durations, 95),
    p99DurationMs: percentile(point.durations, 99),
    promptTokens: point.promptTokens,
    outputTokens: point.outputTokens,
    totalTokens: point.promptTokens + point.outputTokens,
    outputChars: point.outputChars,
    toolCalls: point.toolCalls,
  }));
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return 0;
  return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function getOrCreateGroup(map, key, create) {
  let value = map.get(key);
  if (!value) {
    value = create();
    map.set(key, value);
  }
  return value;
}

function sortByRequestCount(a, b) {
  return b.requestCount - a.requestCount;
}

function formatBucketLabel(timestamp, bucketMs) {
  const date = new Date(timestamp);
  if (bucketMs >= 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderDashboardHtml() {
  const defaultWindowMinutes = Math.round(ANALYTICS_RANGES[DEFAULT_ANALYTICS_RANGE].durationMs / 60000);
  return dashboardTemplate.replaceAll("__ANALYTICS_WINDOW_MINUTES__", String(defaultWindowMinutes));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: "missing_url" });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      let routed = null;
      try {
        const model = getRoutedModel(url.searchParams.get("model") || "gpt-5.5");
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
          provider: gpt55Route.provider,
          model: gpt55Route.modelId,
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

    if (req.method === "GET" && url.pathname === "/dashboard") {
      return sendHtml(res, 200, renderDashboardHtml());
    }

    if (req.method === "GET" && url.pathname === "/analytics/summary") {
      return sendJson(res, 200, analyticsStore.getSummary(url.searchParams.get("range") || DEFAULT_ANALYTICS_RANGE));
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      const token = getBearer(req);
      if (token !== GATEWAY_TOKEN) return unauthorized(res);
      return sendJson(res, 200, {
        object: "list",
        data: [
          {
            id: "gpt-5.5",
            object: "model",
            owned_by: "office-agent",
          },
          {
            id: requestyAbstractModelId,
            object: "model",
            owned_by: "office-agent",
          },
          {
            id: "assistant",
            object: "model",
            owned_by: "office-agent",
          },
        ],
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/vfs/read") {
      return handleVfsRequest(req, res, handleVfsRead);
    }

    if (req.method === "POST" && url.pathname === "/v1/vfs/list") {
      return handleVfsRequest(req, res, handleVfsList);
    }

    if (req.method === "POST" && url.pathname === "/v1/vfs/find") {
      return handleVfsRequest(req, res, handleVfsFind);
    }

    if (req.method === "POST" && url.pathname === "/v1/vfs/grep") {
      return handleVfsRequest(req, res, handleVfsGrep);
    }

    if (req.method === "GET" && url.pathname === "/v1/vfs/roots") {
      if (!requireVfsAuth(req, res)) return;
      return sendJson(res, 200, await handleVfsRoots({}, await getConfiguredVfsRoots()));
    }

    if (req.method === "POST" && url.pathname === "/v1/vfs/roots") {
      return handleVfsRequest(req, res, handleVfsRoots);
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
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
  console.log(`[gateway] abstract model assistant -> ${MOCK_MODE ? "mock" : `${sparkRoute.provider}/${sparkRoute.modelId}`}`);
  console.log(`[gateway] abstract model gpt-5.5 -> ${MOCK_MODE ? "mock" : `${gpt55Route.provider}/${gpt55Route.modelId}`}`);
  console.log(`[gateway] abstract model ${requestyAbstractModelId} -> ${MOCK_MODE ? "mock" : `${requestyRoute.provider}/${requestyRoute.modelId}`}`);
  console.log(`[gateway] auth path: ${authPath}`);
  console.log(`[gateway] analytics dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[gateway] analytics log: ${analyticsEventsPath}`);
});
