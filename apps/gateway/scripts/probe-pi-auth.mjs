import os from "node:os";
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const authPath = process.env.OFFICE_AGENT_GATEWAY_AUTH_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "auth.json");
const modelsPath = process.env.OFFICE_AGENT_GATEWAY_MODELS_PATH || path.join(localAppData, "OfficeAgent", "gateway-auth", "models.json");
const provider = process.env.PROBE_PROVIDER || "openai-codex";
const modelId = process.env.PROBE_MODEL || "gpt-5.3-codex-spark";

const authStorage = AuthStorage.create(authPath);
const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
const model = modelRegistry.find(provider, modelId);

if (!model) {
  console.error(`[probe-auth] model not found: ${provider}/${modelId}`);
  process.exit(1);
}

const configured = modelRegistry.hasConfiguredAuth(model);
const credential = authStorage.get(provider);
const resolved = await modelRegistry.getApiKeyAndHeaders(model);

console.log(`[probe-auth] authPath=${authPath}`);
console.log(`[probe-auth] provider=${provider}`);
console.log(`[probe-auth] model=${model.id}`);
console.log(`[probe-auth] api=${model.api}`);
console.log(`[probe-auth] baseUrl=${model.baseUrl}`);
console.log(`[probe-auth] configuredAuth=${configured}`);
console.log(`[probe-auth] credentialType=${credential?.type ?? "none"}`);

if (!resolved.ok) {
  console.error(`[probe-auth] auth resolution failed: ${resolved.error}`);
  process.exit(1);
}

console.log(`[probe-auth] auth resolution ok`);
console.log(`[probe-auth] apiKeyPresent=${!!resolved.apiKey}`);
console.log(`[probe-auth] headersPresent=${!!resolved.headers && Object.keys(resolved.headers).length > 0}`);
if (credential?.type === "oauth") {
  console.log(`[probe-auth] oauthExpires=${new Date(credential.expires).toISOString()}`);
}
