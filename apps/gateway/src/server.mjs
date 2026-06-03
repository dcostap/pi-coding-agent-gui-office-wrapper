import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  OFFICE_AGENT_SQLSERVER_TOOL_EXE_ENV_NAME,
  OFFICE_AGENT_SQLSERVER_TOOL_BINARY_NAME,
  OFFICE_AGENT_SQLSERVER_TOOL_EXE_NAME,
  OFFICE_AGENT_SQLSERVER_TOOL_RESOURCE_DIR_NAME,
  OFFICE_AGENT_VFS_ROOTS,
} from "@office-agent/runtime";

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
const SQL_TOOL_ENDPOINT_PATH = "/v1/tools/castrosua_sql_read_only";
const SQL_ALLOWED_ACTIONS = new Set(["info", "list_tables", "describe", "sample", "query"]);
const SQL_DEFAULT_DATABASE = "CastrosuaIA";
const SQL_ALLOWED_DATABASES = new Set([SQL_DEFAULT_DATABASE.toUpperCase()]);
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$#@]{0,127}$/;
const SQL_DEFAULT_SAMPLE_LIMIT = 20;
const SQL_MAX_SAMPLE_LIMIT = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_MAX_SAMPLE_LIMIT, 200);
const SQL_MAX_SQL_CHARS = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_MAX_SQL_CHARS, 20_000);
const SQL_TIMEOUT_MS = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_TIMEOUT_MS, 120_000);
const SQL_MAX_STDOUT_BYTES = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_MAX_STDOUT_BYTES, 2 * 1024 * 1024);
const SQL_MAX_STDERR_BYTES = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_MAX_STDERR_BYTES, 256 * 1024);
const SQL_MAX_CONCURRENT = parsePositiveInteger(process.env.OFFICE_AGENT_SQLSERVER_MAX_CONCURRENT, 70);
const SQL_DANGEROUS_KEYWORD_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|BACKUP|RESTORE|DBCC|USE)\b/i;

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const authPath =
  process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");
const modelsPath =
  process.env.OFFICE_AGENT_GATEWAY_MODELS_PATH ||
  path.join(localAppData, "OfficeAgent", "gateway-auth", "models.json");
const analyticsDir =
  process.env.OFFICE_AGENT_GATEWAY_ANALYTICS_DIR || path.join(localAppData, "OfficeAgent", "gateway-analytics");
const analyticsEventsPath = path.join(analyticsDir, "events.jsonl");
const sqlAuditEventsPath = path.join(analyticsDir, "sql-events.jsonl");
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
let activeSqlToolRequests = 0;

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

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n");
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

function buildMockChatResult(body, text) {
  return {
    status: "success",
    finishReason: "stop",
    outputChars: text.length,
    toolCalls: 0,
    toolCallNames: [],
    firstTokenMs: 0,
    routing: {
      provider: "mock",
      model: body.model || "assistant",
      api: "mock",
    },
  };
}

function sendMockChatCompletionJson(res, body) {
  const text = buildMockText(body);
  const payload = {
    id: `chatcmpl_mock_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "assistant",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: estimateTokensFromChars(estimatePromptChars(body.messages)),
      completion_tokens: estimateTokensFromChars(text.length),
      total_tokens: estimateTokensFromChars(estimatePromptChars(body.messages)) + estimateTokensFromChars(text.length),
    },
  };
  sendJson(res, 200, payload);
  return {
    ...buildMockChatResult(body, text),
    outputTokens: payload.usage.completion_tokens,
  };
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

  return buildMockChatResult(body, text);
}

function resolveCodexUrl(baseUrl) {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : "https://chatgpt.com/backend-api";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractChatGptAccountId(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return null;
    const parsed = JSON.parse(base64UrlDecode(payload));
    return (
      parsed?.["https://api.openai.com/auth"]?.chatgpt_account_id ||
      parsed?.https?.["api.openai.com/auth"]?.chatgpt_account_id ||
      null
    );
  } catch {
    return null;
  }
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveOpenAIChatCompletionsUrl(baseUrl) {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : "https://api.openai.com/v1";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function copyFetchHeaders(headers) {
  const output = {};
  const hopByHop = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  for (const [key, value] of headers.entries()) {
    if (!hopByHop.has(key.toLowerCase())) output[key] = value;
  }
  return output;
}

function buildOpenAIChatProxyHeaders(req, model, resolvedAuth) {
  const headers = new Headers();

  const accept = firstHeaderValue(req.headers.accept);
  if (typeof accept === "string" && accept.trim()) headers.set("accept", accept.trim());
  else headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("accept-encoding", "identity");

  for (const [key, value] of Object.entries(resolvedAuth.headers || {})) {
    if (value != null) headers.set(key, String(value));
  }

  if (resolvedAuth.apiKey && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${resolvedAuth.apiKey}`);
  }

  const sessionId = firstHeaderValue(req.headers.session_id) || firstHeaderValue(req.headers["x-client-request-id"]);
  if (typeof sessionId === "string" && sessionId.trim()) {
    headers.set("session_id", sessionId.trim());
    headers.set("x-client-request-id", sessionId.trim());
  }

  headers.set("User-Agent", `office-agent-gateway (${os.platform()} ${os.release()}; ${os.arch()})`);

  if (!resolvedAuth.apiKey && !headers.has("Authorization")) {
    throw new Error(`Auth resolution returned no API token for ${model.provider}/${model.id}`);
  }

  return headers;
}

function trackOpenAIChatToolCall(stats, key, name) {
  if (!key) return;
  const cleanName = cleanMetricName(name, "unknown");
  const existing = stats.toolCallsByKey.get(key);
  if (!existing) {
    stats.toolCallsByKey.set(key, cleanName);
    stats.toolCalls = stats.toolCallsByKey.size;
    if (stats.firstTokenMs == null) stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
    return;
  }
  if (existing === "unknown" && cleanName !== "unknown") {
    stats.toolCallsByKey.set(key, cleanName);
  }
}

function analyzeOpenAIChatCompletionEvent(event, stats) {
  if (!event || typeof event !== "object") return;

  const usage = event.usage;
  if (usage && typeof usage === "object") {
    const outputTokens = usage.completion_tokens ?? usage.output_tokens;
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
    if (outputTokens != null) stats.outputTokens = Number(outputTokens || 0);
    if (promptTokens != null) stats.promptTokens = Number(promptTokens || 0);
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  for (const choice of choices) {
    const choiceIndex = choice?.index ?? 0;
    const delta = choice?.delta || {};
    const contentDelta = typeof delta.content === "string" ? delta.content : "";
    if (contentDelta) {
      if (stats.firstTokenMs == null) stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
      stats.outputChars += contentDelta.length;
    }

    const reasoningDelta = typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta.reasoning === "string"
        ? delta.reasoning
        : "";
    if (reasoningDelta && stats.firstTokenMs == null) {
      stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
    }

    for (const toolCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const toolKey = toolCall?.index != null
        ? `choice:${choiceIndex}:index:${toolCall.index}`
        : toolCall?.id
          ? `choice:${choiceIndex}:id:${toolCall.id}`
          : null;
      trackOpenAIChatToolCall(stats, toolKey, toolCall.function?.name);
    }

    if (choice?.finish_reason) {
      stats.finishReason = choice.finish_reason === "tool_calls" ? "tool_calls" : choice.finish_reason;
    }
  }
}

function analyzeOpenAIChatSseChunk(text, parser, stats) {
  for (const data of readSseEventsFromParser(text, parser)) {
    if (data === "[DONE]") continue;
    try {
      analyzeOpenAIChatCompletionEvent(JSON.parse(data), stats);
    } catch {
      // Analytics should never interfere with protocol proxying.
    }
  }
}

function analyzeOpenAIChatJsonPayload(text, stats) {
  try {
    const event = JSON.parse(text);
    const choices = Array.isArray(event.choices)
      ? event.choices.map((choice) => {
          const message = choice?.message || {};
          return {
            ...choice,
            delta: {
              content: typeof message.content === "string" ? message.content : "",
              reasoning_content: typeof message.reasoning_content === "string"
                ? message.reasoning_content
                : typeof message.reasoning === "string"
                  ? message.reasoning
                  : undefined,
              tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
            },
          };
        })
      : [];
    analyzeOpenAIChatCompletionEvent({ choices, usage: event.usage }, stats);
  } catch {
    // Analytics should never interfere with protocol proxying.
  }
}

async function proxyOpenAIChatCompletions(req, res, body) {
  const proxyStartedAtMs = Date.now();
  const model = getRoutedModel(body.model || "assistant");
  if (model.api !== "openai-completions") {
    const message = `OpenAI Chat endpoint cannot raw-proxy non-chat model ${model.provider}/${model.id} (${model.api})`;
    sendJson(res, 400, {
      error: "unsupported_model_api",
      message,
    });
    return {
      status: "error",
      finishReason: "stop",
      errorCode: "unsupported_model_api",
      errorMessage: message,
      outputChars: 0,
      toolCalls: 0,
      toolCallNames: [],
      firstTokenMs: null,
      routing: {
        provider: model.provider,
        model: model.id,
        api: model.api,
        baseUrl: model.baseUrl,
      },
    };
  }

  const resolvedAuth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!resolvedAuth.ok) {
    throw new Error(`Auth resolution failed for ${model.provider}/${model.id}: ${resolvedAuth.error}`);
  }

  const upstreamBody = {
    ...body,
    model: model.id,
  };

  const abortController = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded && !abortController.signal.aborted) abortController.abort();
  };
  const disposeAbortHandlers = () => {
    req.off("aborted", abortUpstream);
    res.off("close", abortUpstream);
  };
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(resolveOpenAIChatCompletionsUrl(model.baseUrl), {
      method: "POST",
      headers: buildOpenAIChatProxyHeaders(req, model, resolvedAuth),
      body: JSON.stringify(upstreamBody),
      signal: abortController.signal,
    });
  } catch (error) {
    disposeAbortHandlers();
    throw error;
  }

  const stats = {
    startedAtMs: proxyStartedAtMs,
    status: upstreamResponse.ok ? "success" : "error",
    finishReason: "stop",
    errorCode: upstreamResponse.ok ? null : `http_${upstreamResponse.status}`,
    errorMessage: upstreamResponse.ok ? null : upstreamResponse.statusText,
    outputChars: 0,
    outputTokens: null,
    promptTokens: null,
    toolCalls: 0,
    toolCallsByKey: new Map(),
    firstTokenMs: null,
  };

  const upstreamContentType = upstreamResponse.headers.get("content-type") || "";
  const isEventStream = upstreamContentType.toLowerCase().includes("text/event-stream");
  res.writeHead(upstreamResponse.status, {
    ...copyFetchHeaders(upstreamResponse.headers),
    "cache-control": upstreamResponse.headers.get("cache-control") || "no-cache",
  });

  if (!upstreamResponse.body) {
    res.end();
    disposeAbortHandlers();
  } else {
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    const parser = { buffer: "" };
    let jsonText = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        const chunkText = decoder.decode(value, { stream: true });
        if (isEventStream) {
          analyzeOpenAIChatSseChunk(chunkText, parser, stats);
        } else if (jsonText.length < VFS_MAX_OUTPUT_BYTES) {
          jsonText += chunkText;
        }
      }
      const tail = decoder.decode();
      if (tail) {
        if (isEventStream) {
          analyzeOpenAIChatSseChunk(tail, parser, stats);
        } else if (jsonText.length < VFS_MAX_OUTPUT_BYTES) {
          jsonText += tail;
        }
      }
      if (!isEventStream && jsonText) {
        analyzeOpenAIChatJsonPayload(jsonText, stats);
        if (!upstreamResponse.ok) {
          stats.errorMessage = jsonText;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Best effort.
      }
      res.end();
      disposeAbortHandlers();
    }
  }

  if (!upstreamResponse.ok && stats.errorMessage === upstreamResponse.statusText) {
    stats.errorMessage = upstreamResponse.statusText || `HTTP ${upstreamResponse.status}`;
  }

  return {
    status: stats.status,
    finishReason: stats.finishReason,
    errorCode: stats.errorCode,
    errorMessage: stats.errorMessage,
    outputChars: stats.outputChars,
    ...(stats.outputTokens != null ? { outputTokens: stats.outputTokens } : {}),
    toolCalls: stats.toolCalls,
    toolCallNames: [...stats.toolCallsByKey.values()],
    firstTokenMs: stats.firstTokenMs,
    routing: {
      provider: model.provider,
      model: model.id,
      api: model.api,
      baseUrl: model.baseUrl,
    },
  };
}

function writeSseData(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildMockCodexText(body) {
  return `Mock Codex Responses gateway response. Requested model: ${body.model || "gpt-5.5"}.`;
}

function sendMockCodexResponsesStream(res, body) {
  const text = buildMockCodexText(body);
  const responseId = `resp_mock_${Date.now()}`;
  const itemId = `msg_mock_${Date.now()}`;
  const chunks = text.match(/.{1,24}/g) || [text];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  writeSseData(res, { type: "response.created", response: { id: responseId, status: "in_progress" } });
  if (body.reasoning?.effort) {
    const reasoningText = `Mock reasoning summary for ${body.reasoning.effort}.`;
    const reasoningItemId = `rs_mock_${Date.now()}`;
    writeSseData(res, { type: "response.output_item.added", item: { id: reasoningItemId, type: "reasoning" } });
    writeSseData(res, { type: "response.reasoning_summary_part.added", part: { type: "summary_text", text: "" } });
    writeSseData(res, { type: "response.reasoning_summary_text.delta", delta: reasoningText });
    writeSseData(res, {
      type: "response.output_item.done",
      item: { id: reasoningItemId, type: "reasoning", summary: [{ type: "summary_text", text: reasoningText }] },
    });
  }
  writeSseData(res, { type: "response.output_item.added", item: { id: itemId, type: "message", content: [] } });
  writeSseData(res, { type: "response.content_part.added", part: { type: "output_text", text: "" } });
  for (const chunk of chunks) {
    writeSseData(res, { type: "response.output_text.delta", delta: chunk });
  }
  writeSseData(res, {
    type: "response.output_item.done",
    item: { id: itemId, type: "message", content: [{ type: "output_text", text }] },
  });
  writeSseData(res, {
    type: "response.completed",
    response: {
      id: responseId,
      status: "completed",
      usage: {
        input_tokens: estimateTokensFromChars(JSON.stringify(body.input || body.messages || "")),
        output_tokens: estimateTokensFromChars(text.length),
        total_tokens: estimateTokensFromChars(JSON.stringify(body.input || body.messages || "")) + estimateTokensFromChars(text.length),
      },
    },
  });
  res.end();

  return {
    status: "success",
    finishReason: "stop",
    outputChars: text.length,
    outputTokens: estimateTokensFromChars(text.length),
    toolCalls: 0,
    toolCallNames: [],
    firstTokenMs: 0,
    routing: {
      provider: "mock",
      model: body.model || "gpt-5.5",
      api: "openai-codex-responses",
    },
  };
}

function analyzeCodexResponseEvent(event, stats) {
  const type = typeof event?.type === "string" ? event.type : "";
  if (!type) return;

  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    if (stats.firstTokenMs == null) stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
    stats.outputChars += event.delta.length;
    return;
  }

  if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
    if (stats.firstTokenMs == null) stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
    return;
  }

  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = event.item;
    if (item?.type === "function_call") {
      const key = item.id || item.call_id || `${stats.toolCallIds.size}`;
      if (!stats.toolCallIds.has(key)) {
        stats.toolCallIds.add(key);
        stats.toolCalls += 1;
        stats.toolCallNames.push(cleanMetricName(item.name, "unknown"));
      }
      if (stats.firstTokenMs == null) stats.firstTokenMs = Math.max(0, Date.now() - stats.startedAtMs);
    }
    return;
  }

  if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
    const usage = event.response?.usage;
    if (usage) {
      const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
      stats.outputTokens = Number(usage.output_tokens || 0);
      stats.promptTokens = Number(usage.input_tokens || 0) - Number(cachedTokens || 0);
    }
    stats.finishReason = type === "response.incomplete" ? "length" : "stop";
    return;
  }

  if (type === "response.failed") {
    stats.status = "error";
    stats.finishReason = "stop";
    stats.errorCode = event.response?.error?.code || "response_failed";
    stats.errorMessage = event.response?.error?.message || "Codex response failed";
  }
}

function readSseEventsFromParser(text, parser) {
  parser.buffer += text;
  const events = [];
  let separatorMatch = /\r?\n\r?\n/.exec(parser.buffer);
  while (separatorMatch?.index != null) {
    const rawEvent = parser.buffer.slice(0, separatorMatch.index);
    parser.buffer = parser.buffer.slice(separatorMatch.index + separatorMatch[0].length);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    if (data) events.push(data);
    separatorMatch = /\r?\n\r?\n/.exec(parser.buffer);
  }
  return events;
}

function analyzeCodexSseChunk(text, parser, stats) {
  for (const data of readSseEventsFromParser(text, parser)) {
    if (data === "[DONE]") continue;
    try {
      analyzeCodexResponseEvent(JSON.parse(data), stats);
    } catch {
      // Analytics should never interfere with protocol proxying.
    }
  }
}

const CODEX_PROXY_RESPONSE_STATUSES = new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress",
]);

function normalizeCodexResponseStatus(status) {
  if (status === "done") return "completed";
  return CODEX_PROXY_RESPONSE_STATUSES.has(status) ? status : undefined;
}

function normalizeCodexEventForOpenAIResponses(event) {
  if (!event || typeof event !== "object") return event;
  if (
    event.type !== "response.done" &&
    event.type !== "response.incomplete" &&
    event.type !== "response.completed"
  ) {
    return event;
  }

  const normalizedStatus = normalizeCodexResponseStatus(event.response?.status);
  return {
    ...event,
    type: "response.completed",
    response: event.response
      ? {
          ...event.response,
          ...(normalizedStatus === undefined ? { status: undefined } : { status: normalizedStatus }),
        }
      : event.response,
  };
}

function writeNormalizedCodexSseChunk(text, parser, stats, res) {
  for (const data of readSseEventsFromParser(text, parser)) {
    if (data === "[DONE]") {
      res.write("data: [DONE]\n\n");
      continue;
    }
    try {
      const event = normalizeCodexEventForOpenAIResponses(JSON.parse(data));
      analyzeCodexResponseEvent(event, stats);
      writeSseData(res, event);
    } catch {
      // Preserve malformed events rather than breaking the stream.
      res.write(`data: ${data}\n\n`);
    }
  }
}

function extractResponseInputText(item) {
  if (typeof item?.content === "string") return item.content;
  if (!Array.isArray(item?.content)) return "";
  return item.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeCodexToolForUpstream(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool;
  if (tool.type !== "function") return tool;
  return {
    ...tool,
    strict: null,
  };
}

function normalizeCodexProxyRequestBody(body, model, options = {}) {
  const upstreamBody = {
    ...body,
    model: model.id,
  };

  if (!upstreamBody.instructions && options.fromOpenAIResponsesClient && Array.isArray(upstreamBody.input)) {
    const [first, ...rest] = upstreamBody.input;
    if (first?.role === "developer" || first?.role === "system") {
      const instructions = extractResponseInputText(first);
      if (instructions) {
        upstreamBody.instructions = instructions;
        upstreamBody.input = rest;
      }
    }
  }

  delete upstreamBody.prompt_cache_retention;
  if (Array.isArray(upstreamBody.tools)) {
    upstreamBody.tools = upstreamBody.tools.map(normalizeCodexToolForUpstream);
  }
  upstreamBody.text ??= { verbosity: "low" };
  upstreamBody.tool_choice ??= "auto";
  upstreamBody.parallel_tool_calls ??= true;
  if (upstreamBody.reasoning && !Array.isArray(upstreamBody.include)) {
    upstreamBody.include = ["reasoning.encrypted_content"];
  }

  return upstreamBody;
}

function buildCodexProxyHeaders(req, model, resolvedAuth) {
  const upstreamToken = resolvedAuth.apiKey;
  if (!upstreamToken) {
    throw new Error(`Auth resolution returned no API token for ${model.provider}/${model.id}`);
  }

  const accountId = extractChatGptAccountId(upstreamToken);
  if (!accountId) {
    throw new Error(`Could not extract ChatGPT account id for ${model.provider}/${model.id}`);
  }

  const headers = new Headers(resolvedAuth.headers || {});
  for (const [key, value] of Object.entries(model.headers || {})) {
    headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${upstreamToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "pi");
  headers.set("User-Agent", `office-agent-gateway (${os.platform()} ${os.release()}; ${os.arch()})`);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");

  const sessionId = firstHeaderValue(req.headers.session_id) || firstHeaderValue(req.headers["x-client-request-id"]);
  if (typeof sessionId === "string" && sessionId.trim()) {
    headers.set("session_id", sessionId.trim());
    headers.set("x-client-request-id", sessionId.trim());
  }

  return headers;
}

async function proxyCodexResponses(req, res, body, options = {}) {
  const model = getRoutedModel(body.model || "gpt-5.5");
  if (model.api !== "openai-codex-responses") {
    throw new Error(`Native Codex endpoint cannot route to non-Codex model ${model.provider}/${model.id} (${model.api})`);
  }

  const resolvedAuth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!resolvedAuth.ok) {
    throw new Error(`Auth resolution failed for ${model.provider}/${model.id}: ${resolvedAuth.error}`);
  }

  const upstreamBody = normalizeCodexProxyRequestBody(body, model, options);
  const upstreamResponse = await fetch(resolveCodexUrl(model.baseUrl), {
    method: "POST",
    headers: buildCodexProxyHeaders(req, model, resolvedAuth),
    body: JSON.stringify(upstreamBody),
  });

  const stats = {
    startedAtMs: Date.now(),
    status: upstreamResponse.ok ? "success" : "error",
    finishReason: "stop",
    errorCode: upstreamResponse.ok ? null : `http_${upstreamResponse.status}`,
    errorMessage: upstreamResponse.ok ? null : upstreamResponse.statusText,
    outputChars: 0,
    outputTokens: null,
    promptTokens: null,
    toolCalls: 0,
    toolCallNames: [],
    toolCallIds: new Set(),
    firstTokenMs: null,
  };

  const upstreamContentType = upstreamResponse.headers.get("content-type") || "";
  if (!upstreamResponse.ok && !upstreamContentType.toLowerCase().includes("text/event-stream")) {
    const errorText = await upstreamResponse.text();
    stats.errorMessage = errorText || upstreamResponse.statusText || stats.errorMessage;
    res.writeHead(upstreamResponse.status, {
      "content-type": upstreamContentType || "text/plain; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(errorText);
    return {
      status: stats.status,
      finishReason: stats.finishReason,
      errorCode: stats.errorCode,
      errorMessage: stats.errorMessage,
      outputChars: 0,
      toolCalls: 0,
      toolCallNames: [],
      firstTokenMs: null,
      routing: {
        provider: model.provider,
        model: model.id,
        api: model.api,
        baseUrl: model.baseUrl,
      },
    };
  }

  const responseHeaders = {
    "content-type": upstreamContentType || "text/event-stream; charset=utf-8",
    "cache-control": upstreamResponse.headers.get("cache-control") || "no-cache",
    connection: "keep-alive",
  };
  res.writeHead(upstreamResponse.status, responseHeaders);

  if (!upstreamResponse.body) {
    res.end();
  } else {
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    const parser = { buffer: "" };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        if (options.normalizeForOpenAIResponsesClient) {
          writeNormalizedCodexSseChunk(chunkText, parser, stats, res);
        } else {
          analyzeCodexSseChunk(chunkText, parser, stats);
          res.write(Buffer.from(value));
        }
      }
      const tail = decoder.decode();
      if (tail) {
        if (options.normalizeForOpenAIResponsesClient) {
          writeNormalizedCodexSseChunk(tail, parser, stats, res);
        } else {
          analyzeCodexSseChunk(tail, parser, stats);
          res.write(tail);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Best effort.
      }
      res.end();
    }
  }

  return {
    status: stats.status,
    finishReason: stats.finishReason,
    errorCode: stats.errorCode,
    errorMessage: stats.errorMessage,
    outputChars: stats.outputChars,
    ...(stats.outputTokens != null ? { outputTokens: stats.outputTokens } : {}),
    toolCalls: stats.toolCalls,
    toolCallNames: stats.toolCallNames,
    firstTokenMs: stats.firstTokenMs,
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function handleSqlReadonlyRequest(req, res) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) return unauthorized(res);

  let body;
  try {
    body = await readJson(req, { maxBytes: MAX_JSON_BODY_BYTES });
  } catch (error) {
    return sendJson(res, 400, {
      error: "bad_request",
      message: sanitizeSqlToolText(String(error?.message || error)),
    });
  }

  const startedAtMs = Date.now();
  const client = getClientIdentity(req);
  const validation = validateSqlReadonlyParams(body);
  if (!validation.ok) {
    const result = createSqlToolErrorResult({
      action: validation.action,
      database: validation.database,
      errorCode: validation.code,
      message: validation.message,
    });
    await appendSqlAuditEvent(createSqlAuditEvent({
      startedAtMs,
      client,
      action: validation.action,
      database: validation.database,
      status: "validation_error",
      errorCode: validation.code,
    }));
    return sendJson(res, 200, result);
  }

  const normalized = validation.value;
  if (activeSqlToolRequests >= SQL_MAX_CONCURRENT) {
    const result = createSqlToolErrorResult({
      action: normalized.action,
      database: normalized.database,
      errorCode: "busy",
      message: "SQL Server read-only gateway is busy. Try again shortly.",
    });
    await appendSqlAuditEvent(createSqlAuditEvent({
      startedAtMs,
      client,
      action: normalized.action,
      database: normalized.database,
      status: "busy",
      errorCode: "busy",
      sql: normalized.sql,
    }));
    return sendJson(res, 200, result);
  }

  const exe = resolveSqlToolExe();
  if (!exe) {
    const result = createSqlToolErrorResult({
      action: normalized.action,
      database: normalized.database,
      errorCode: "missing_sql_tool",
      message: `Server-side SQL Server CLI was not found. Configure ${OFFICE_AGENT_SQLSERVER_TOOL_EXE_ENV_NAME} on the gateway host.`,
    });
    await appendSqlAuditEvent(createSqlAuditEvent({
      startedAtMs,
      client,
      action: normalized.action,
      database: normalized.database,
      status: "missing_sql_tool",
      errorCode: "missing_sql_tool",
      sql: normalized.sql,
    }));
    return sendJson(res, 200, result);
  }

  activeSqlToolRequests += 1;
  let completed = false;
  const abortController = new AbortController();
  const onClientClosed = () => {
    if (!completed && !res.writableEnded) abortController.abort();
  };
  res.on("close", onClientClosed);

  try {
    const runResult = await runSqlTool(exe, normalized.args, {
      signal: abortController.signal,
      timeoutMs: SQL_TIMEOUT_MS,
      maxStdoutBytes: SQL_MAX_STDOUT_BYTES,
      maxStderrBytes: SQL_MAX_STDERR_BYTES,
    });
    completed = true;
    const stdout = runResult.stdout.trim();
    const stderr = runResult.stderr.trim();
    const payload = parseSqlToolPayload(stdout);

    if (runResult.code !== 0) {
      const message = sanitizeSqlToolText(stderr || stdout || "SQL Server read-only CLI failed with exit code " + runResult.code, normalized.sql);
      const result = createSqlToolErrorResult({
        action: normalized.action,
        database: normalized.database,
        errorCode: "cli_exit_" + runResult.code,
        message,
        stderr: sanitizeSqlToolText(stderr, normalized.sql),
        extraDetails: {
          exitCode: runResult.code,
          stdoutBytes: Buffer.byteLength(runResult.stdout, "utf8"),
          ...extractSanitizedSqlStdoutError(payload, normalized.sql),
        },
      });
      await appendSqlAuditEvent(createSqlAuditEvent({
        startedAtMs,
        client,
        action: normalized.action,
        database: normalized.database,
        status: "cli_error",
        errorCode: "cli_exit_" + runResult.code,
        stdoutBytes: Buffer.byteLength(runResult.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(runResult.stderr, "utf8"),
        sql: normalized.sql,
      }));
      if (!res.destroyed) return sendJson(res, 200, result);
      return;
    }

    const result = {
      content: [{ type: "text", text: summarizeSqlToolResult(normalized.action, payload) }],
      details: {
        action: normalized.action,
        database: normalized.database,
        result: payload,
        ...(stderr ? { stderr: sanitizeSqlToolText(stderr, normalized.sql) } : {}),
      },
    };
    await appendSqlAuditEvent(createSqlAuditEvent({
      startedAtMs,
      client,
      action: normalized.action,
      database: normalized.database,
      status: "success",
      stdoutBytes: Buffer.byteLength(runResult.stdout, "utf8"),
      stderrBytes: Buffer.byteLength(runResult.stderr, "utf8"),
      sql: normalized.sql,
    }));
    if (!res.destroyed) return sendJson(res, 200, result);
  } catch (error) {
    completed = true;
    const code = cleanMetricName(error?.code, "sql_tool_error");
    const result = createSqlToolErrorResult({
      action: normalized.action,
      database: normalized.database,
      errorCode: code,
      message: sanitizeSqlToolText(String(error?.message || error), normalized.sql),
    });
    await appendSqlAuditEvent(createSqlAuditEvent({
      startedAtMs,
      client,
      action: normalized.action,
      database: normalized.database,
      status: "runtime_error",
      errorCode: code,
      sql: normalized.sql,
    }));
    if (!res.destroyed) return sendJson(res, 200, result);
  } finally {
    completed = true;
    activeSqlToolRequests = Math.max(0, activeSqlToolRequests - 1);
    res.off("close", onClientClosed);
  }
}

function validateSqlReadonlyParams(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sqlValidationError("invalid_body", "SQL tool request body must be a JSON object.");
  }

  const allowedKeys = new Set(["action", "database", "sql", "schema", "table", "includeViews", "limit"]);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    return sqlValidationError("unknown_field", `Unknown SQL tool field: ${unknownKey}`);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!SQL_ALLOWED_ACTIONS.has(action)) {
    return sqlValidationError("invalid_action", "Invalid SQL tool action.", action || "unknown");
  }

  const databaseInput = body.database == null || body.database === "" ? SQL_DEFAULT_DATABASE : body.database;
  if (typeof databaseInput !== "string") {
    return sqlValidationError("invalid_database", "SQL database must be a string.", action);
  }
  const database = databaseInput.trim();
  if (!SQL_ALLOWED_DATABASES.has(database.toUpperCase())) {
    return sqlValidationError("invalid_database", "Only the default CastrosuaIA SQL database is supported.", action, database || "unknown");
  }

  if (body.includeViews != null && typeof body.includeViews !== "boolean") {
    return sqlValidationError("invalid_include_views", "includeViews must be a boolean.", action, database);
  }

  let limit = SQL_DEFAULT_SAMPLE_LIMIT;
  if (body.limit != null) {
    if (!Number.isInteger(body.limit)) {
      return sqlValidationError("invalid_limit", "limit must be an integer.", action, database);
    }
    if (body.limit < 1 || body.limit > SQL_MAX_SAMPLE_LIMIT) {
      return sqlValidationError("invalid_limit", `limit must be between 1 and ${SQL_MAX_SAMPLE_LIMIT}.`, action, database);
    }
    limit = body.limit;
  }

  const schemaResult = normalizeSqlIdentifier(body.schema, "schema");
  if (!schemaResult.ok) return sqlValidationError(schemaResult.code, schemaResult.message, action, database);
  const tableResult = normalizeSqlIdentifier(body.table, "table");
  if (!tableResult.ok) return sqlValidationError(tableResult.code, tableResult.message, action, database);
  const schema = schemaResult.value;
  const table = tableResult.value;

  if ((action === "describe" || action === "sample") && !table) {
    return sqlValidationError("missing_table", `${action} requires table.`, action, database);
  }

  let sql;
  if (action === "query") {
    if (typeof body.sql !== "string" || !body.sql.trim()) {
      return sqlValidationError("missing_sql", "query requires non-empty sql.", action, database);
    }
    sql = body.sql.trim();
    const sqlSafety = validateReadOnlySql(sql);
    if (!sqlSafety.ok) return sqlValidationError(sqlSafety.code, sqlSafety.message, action, database);
  }

  return {
    ok: true,
    value: {
      action,
      database,
      sql,
      args: buildSqlToolArgs({
        action,
        database,
        sql,
        schema,
        table,
        includeViews: body.includeViews === true,
        limit,
      }),
    },
  };
}

function sqlValidationError(code, message, action = "unknown", database = SQL_DEFAULT_DATABASE) {
  return { ok: false, code, message, action, database };
}

function normalizeSqlIdentifier(value, label) {
  if (value == null || value === "") return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return { ok: false, code: "invalid_" + label, message: `${label} must be a string.` };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!SQL_IDENTIFIER_PATTERN.test(trimmed)) {
    return {
      ok: false,
      code: "invalid_" + label,
      message: `${label} must be a simple SQL Server identifier without dots, separators, semicolons, or control characters.`,
    };
  }
  return { ok: true, value: trimmed };
}

function validateReadOnlySql(sql) {
  if (sql.length > SQL_MAX_SQL_CHARS) {
    return { ok: false, code: "sql_too_long", message: `SQL text exceeds ${SQL_MAX_SQL_CHARS} characters.` };
  }
  const leading = stripLeadingSqlComments(sql);
  if (!leading.ok) return leading;
  const firstKeyword = /^([A-Za-z]+)/.exec(leading.text)?.[1]?.toUpperCase();
  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    return { ok: false, code: "sql_not_read_only", message: "Only SELECT or WITH queries are allowed." };
  }

  const masked = maskSqlLiteralsAndComments(sql);
  const trimmed = masked.trim();
  const semicolonIndexes = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === ";") semicolonIndexes.push(index);
  }
  if (semicolonIndexes.length > 1 || (semicolonIndexes.length === 1 && semicolonIndexes[0] !== trimmed.length - 1)) {
    return { ok: false, code: "multiple_statements", message: "Multiple SQL statements are not allowed." };
  }
  if (SQL_DANGEROUS_KEYWORD_PATTERN.test(masked)) {
    return { ok: false, code: "sql_not_read_only", message: "SQL contains a disallowed write/admin keyword." };
  }
  return { ok: true };
}

function stripLeadingSqlComments(sql) {
  let text = sql.trimStart();
  while (text.startsWith("--") || text.startsWith("/*")) {
    if (text.startsWith("--")) {
      const nextLine = text.search(/\r?\n/);
      text = nextLine === -1 ? "" : text.slice(nextLine).trimStart();
      continue;
    }
    const end = text.indexOf("*/", 2);
    if (end === -1) {
      return { ok: false, code: "unterminated_comment", message: "SQL starts with an unterminated block comment." };
    }
    text = text.slice(end + 2).trimStart();
  }
  return { ok: true, text };
}

function maskSqlLiteralsAndComments(sql) {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      output += "  ";
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < sql.length) {
        if (sql[index] === "*" && sql[index + 1] === "/") {
          output += "  ";
          index += 2;
          break;
        }
        output += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    if (char === "'") {
      output += " ";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          output += "  ";
          index += 2;
          continue;
        }
        const current = sql[index];
        output += current === "\n" ? "\n" : " ";
        index += 1;
        if (current === "'") break;
      }
      continue;
    }
    if (char === "[") {
      output += " ";
      index += 1;
      while (index < sql.length) {
        const current = sql[index];
        output += current === "\n" ? "\n" : " ";
        index += 1;
        if (current === "]") break;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function buildSqlToolArgs(params) {
  const databaseArgs = ["--database", params.database];
  switch (params.action) {
    case "info":
      return ["info", ...databaseArgs];
    case "list_tables": {
      const args = ["list-tables", ...databaseArgs];
      if (params.schema) args.push("--schema", params.schema);
      if (params.includeViews) args.push("--include-views");
      return args;
    }
    case "describe":
      return ["describe", ...databaseArgs, ...(params.schema ? ["--schema", params.schema] : []), "--table", params.table];
    case "sample":
      return [
        "sample",
        ...databaseArgs,
        ...(params.schema ? ["--schema", params.schema] : []),
        "--table",
        params.table,
        "--limit",
        String(params.limit),
      ];
    case "query":
      return ["query", ...databaseArgs, params.sql];
    default:
      throw new Error("Unsupported SQL action: " + params.action);
  }
}

function resolveSqlToolExe() {
  const configured = process.env[OFFICE_AGENT_SQLSERVER_TOOL_EXE_ENV_NAME]?.trim();
  if (configured && existsSync(configured)) return configured;

  const resourceRoots = [
    path.join(gatewayRoot, "resources", OFFICE_AGENT_SQLSERVER_TOOL_RESOURCE_DIR_NAME),
    path.resolve(process.cwd(), "resources", OFFICE_AGENT_SQLSERVER_TOOL_RESOURCE_DIR_NAME),
    path.resolve(process.cwd(), "apps", "gateway", "resources", OFFICE_AGENT_SQLSERVER_TOOL_RESOURCE_DIR_NAME),
  ];
  const fileNames = process.platform === "win32"
    ? [OFFICE_AGENT_SQLSERVER_TOOL_EXE_NAME, OFFICE_AGENT_SQLSERVER_TOOL_BINARY_NAME]
    : [OFFICE_AGENT_SQLSERVER_TOOL_BINARY_NAME, OFFICE_AGENT_SQLSERVER_TOOL_EXE_NAME];
  const candidates = resourceRoots.flatMap((root) => fileNames.map((fileName) => path.join(root, fileName)));
  return candidates.find((candidate) => existsSync(candidate));
}

function runSqlTool(exe, args, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    function cleanup() {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }

    function fail(code, message) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        child.kill();
      } catch {
        // ignore kill errors after process exit
      }
      const error = new Error(message);
      error.code = code;
      reject(error);
    }

    function onAbort() {
      fail("cancelled", "SQL Server read-only request was cancelled.");
    }

    const timeout = setTimeout(() => {
      fail("timeout", "SQL Server read-only request timed out.");
    }, options.timeoutMs);

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxStdoutBytes) {
        fail("stdout_limit", "SQL Server read-only stdout exceeded the configured limit.");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > options.maxStderrBytes) {
        fail("stderr_limit", "SQL Server read-only stderr exceeded the configured limit.");
        return;
      }
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      fail("spawn_failed", "SQL Server read-only CLI failed to start: " + sanitizeSqlToolText(error.message));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function parseSqlToolPayload(stdout) {
  if (!stdout) return "";
  try {
    return JSON.parse(stdout);
  } catch {
    return { stdout };
  }
}

function summarizeSqlToolResult(action, payload) {
  const json = JSON.stringify(payload, null, 2) ?? String(payload ?? "");
  return [
    "SQL Server read-only tool completed action: " + action,
    "",
    json.length > 30000 ? json.slice(0, 30000) + "\n... [truncated in display; full JSON is in details]" : json,
  ].join("\n");
}

function createSqlToolErrorResult(options) {
  return {
    isError: true,
    content: [{ type: "text", text: options.message }],
    details: {
      action: options.action,
      database: options.database,
      errorCode: options.errorCode,
      ...(options.stderr ? { stderr: options.stderr } : {}),
      ...(options.extraDetails || {}),
    },
  };
}

function extractSanitizedSqlStdoutError(payload, sql) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const error = payload.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return {};
  const code = typeof error.code === "string" ? cleanMetricName(error.code, "error") : "error";
  const message = typeof error.message === "string" ? sanitizeSqlToolText(error.message, sql) : undefined;
  return {
    stdoutError: {
      code,
      ...(message ? { message } : {}),
    },
  };
}

function sanitizeSqlToolText(message, sql) {
  let text = String(message ?? "");
  if (sql && sql.length > 8) {
    text = text.split(sql).join("<sql>");
  }
  return text
    .replace(/\b(Password|Pwd)\s*=\s*[^;\r\n]+/gi, "$1=<redacted>")
    .replace(/\b(User\s*Id|UserID|UID)\s*=\s*[^;\r\n]+/gi, "$1=<redacted>")
    .replace(/\b(Server|Data Source|Address|Addr|Network Address)\s*=\s*[^;\r\n]+/gi, "$1=<redacted>")
    .replace(/[A-Za-z]:\\[^\r\n\t]+/g, "<path>")
    .replace(/\/[^\r\n\t ]*officeagent[^\r\n\t ]*/gi, "<path>")
    .slice(0, 2000);
}

function createSqlAuditEvent(options) {
  const completedAtMs = Date.now();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    startedAt: new Date(options.startedAtMs).toISOString(),
    startedAtMs: options.startedAtMs,
    completedAt: new Date(completedAtMs).toISOString(),
    completedAtMs,
    durationMs: Math.max(0, completedAtMs - options.startedAtMs),
    client: options.client,
    action: options.action,
    database: options.database,
    status: options.status,
    errorCode: options.errorCode || null,
    stdoutBytes: Number(options.stdoutBytes || 0),
    stderrBytes: Number(options.stderrBytes || 0),
    activeSqlToolRequests,
    sql: options.sql
      ? {
          length: options.sql.length,
          sha256: createHash("sha256").update(options.sql).digest("hex"),
        }
      : null,
  };
}

async function appendSqlAuditEvent(event) {
  try {
    await mkdir(path.dirname(sqlAuditEventsPath), { recursive: true });
    await appendFile(sqlAuditEventsPath, JSON.stringify(event) + "\n", "utf8");
  } catch (error) {
    console.warn("[gateway] SQL audit append warning", error);
  }
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
      api: MOCK_MODE ? "mock" : "openai-completions",
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
      const result = body.stream === false
        ? sendMockChatCompletionJson(res, body)
        : sendMockStream(res, body);
      await analyticsStore.finishRequest(active, result);
      return;
    }

    const result = await proxyOpenAIChatCompletions(req, res, body);
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

async function handleCodexResponses(req, res, options = {}) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) return unauthorized(res);

  const body = await readJson(req);
  const client = getClientIdentity(req);
  const request = getCodexResponsesRequestSummary(body);
  const route = getAbstractModelRoute(body.model || "gpt-5.5");
  const active = analyticsStore.startRequest({
    client,
    request,
    routing: {
      provider: MOCK_MODE ? "mock" : route.provider,
      model: MOCK_MODE ? body.model || "gpt-5.5" : route.modelId,
      api: MOCK_MODE ? "mock" : "openai-codex-responses",
    },
  });

  try {
    if (MOCK_MODE) {
      console.log("[gateway] codex.responses mock", {
        requestedModel: body.model,
        inputCount: Array.isArray(body.input) ? body.input.length : 0,
        identity: client.identity,
        client: client.client,
      });
      const result = sendMockCodexResponsesStream(res, body);
      await analyticsStore.finishRequest(active, result);
      return;
    }

    const result = await proxyCodexResponses(req, res, body, options);
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

function getCodexResponsesRequestSummary(body) {
  const toolNames = extractToolNames(body.tools);
  const promptChars = estimateCodexInputChars(body.input);
  return {
    abstractModel: typeof body.model === "string" && body.model ? body.model : "gpt-5.5",
    messageCount: Array.isArray(body.input) ? body.input.length : 0,
    toolCount: toolNames.length,
    toolDefinitionCount: toolNames.length,
    toolNames,
    promptChars,
    promptTokens: estimateTokensFromChars(promptChars),
    hasImages: codexInputHasImages(body.input),
    stream: body.stream !== false,
    reasoningEffort: body.reasoning?.effort || body.reasoning_effort || null,
    maxTokens: body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? null,
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

function estimateCodexInputChars(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateCodexInputChars(item), 0);
  if (typeof value !== "object") return 0;

  let total = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === "encrypted_content" || key === "data" || key === "image_url") continue;
    if ((key === "text" || key === "content" || key === "input_text" || key === "output_text") && typeof child === "string") {
      total += child.length;
      continue;
    }
    total += estimateCodexInputChars(child);
  }
  return total;
}

function codexInputHasImages(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(codexInputHasImages);
  if (typeof value !== "object") return false;
  const record = value;
  if (record.type === "input_image" || record.type === "image" || record.image_url) return true;
  return Object.values(record).some(codexInputHasImages);
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
        sqlAuditEventsPath,
        dashboardUrl: `http://localhost:${PORT}/dashboard`,
        sqlTool: {
          configured: Boolean(resolveSqlToolExe()),
          maxConcurrent: SQL_MAX_CONCURRENT,
          active: activeSqlToolRequests,
        },
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
            api: "openai-responses",
            endpoints: ["/v1/responses", "/v1/codex/responses"],
          },
          {
            id: requestyAbstractModelId,
            object: "model",
            owned_by: "office-agent",
            api: "openai-completions",
            endpoints: ["/v1/chat/completions"],
          },
          {
            id: "assistant",
            object: "model",
            owned_by: "office-agent",
            api: "openai-codex-responses",
            endpoints: ["/v1/codex/responses"],
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

    if (req.method === "POST" && url.pathname === SQL_TOOL_ENDPOINT_PATH) {
      return handleSqlReadonlyRequest(req, res);
    }

    if (req.method === "POST" && (url.pathname === "/v1/responses" || url.pathname === "/responses")) {
      return handleCodexResponses(req, res, {
        fromOpenAIResponsesClient: true,
        normalizeForOpenAIResponsesClient: true,
      });
    }

    if (req.method === "POST" && (url.pathname === "/v1/codex/responses" || url.pathname === "/codex/responses")) {
      return handleCodexResponses(req, res);
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
  console.log(`[gateway] SQL audit log: ${sqlAuditEventsPath}`);
  console.log(`[gateway] SQL tool configured: ${resolveSqlToolExe() ? "yes" : "no"}`);
});
