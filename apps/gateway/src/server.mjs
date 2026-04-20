import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { streamSimple as piStreamSimple } from "@mariozechner/pi-ai";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "dev-gateway-token";
const MOCK_MODE = process.env.MOCK_MODE === "1";

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const authPath = process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");
const modelsPath = process.env.OFFICE_AGENT_GATEWAY_MODELS_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "models.json");
const routedProvider = process.env.GATEWAY_UPSTREAM_PROVIDER || "openai-codex";
const routedModelId = process.env.GATEWAY_UPSTREAM_MODEL || "gpt-5.3-codex-spark";

const authStorage = AuthStorage.create(authPath);
const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
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
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => p.text).join("\n");
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
        writeOpenAIChunk(res, streamId, body.model || "assistant", { content: event.delta });
      }
      continue;
    }

    if (event.type === "toolcall_end") {
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
      writeOpenAIChunk(res, streamId, body.model || "assistant", {}, mapFinishReason(event.reason));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (event.type === "error") {
      if (!sentRole) {
        writeOpenAIChunk(res, streamId, body.model || "assistant", { role: "assistant" });
        sentRole = true;
      }
      const message = event.error?.errorMessage || `Gateway upstream error (${event.reason})`;
      writeOpenAIChunk(res, streamId, body.model || "assistant", { content: message });
      writeOpenAIChunk(res, streamId, body.model || "assistant", {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
  }

  writeOpenAIChunk(res, streamId, body.model || "assistant", {}, "stop");
  res.write("data: [DONE]\n\n");
  res.end();
}

async function handleChatCompletions(req, res) {
  const token = getBearer(req);
  if (token !== GATEWAY_TOKEN) return unauthorized(res);

  const body = await readJson(req);

  if (MOCK_MODE) {
    console.log("[gateway] chat.completions mock", {
      requestedModel: body.model,
      stream: !!body.stream,
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    });
    return sendMockStream(res, body);
  }

  if (body.stream === false) {
    return sendJson(res, 400, {
      error: "unsupported_mode",
      message: "This gateway currently supports only stream=true requests.",
    });
  }

  return streamViaPiAuth(res, body);
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
        routed,
      });
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
});
