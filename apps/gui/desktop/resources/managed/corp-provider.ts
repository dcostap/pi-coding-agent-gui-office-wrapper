import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const gatewayUrl = process.env.OFFICE_AGENT_GATEWAY_URL || "http://127.0.0.1:8082/v1";
const gatewayToken = process.env.OFFICE_AGENT_GATEWAY_TOKEN || "dev-gateway-token";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("corp", {
    baseUrl: gatewayUrl,
    api: "openai-completions",
    apiKey: gatewayToken,
    authHeader: true,
    models: [
      {
        id: "assistant",
        name: "Assistant",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
}
