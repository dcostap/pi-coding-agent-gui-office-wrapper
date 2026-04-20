# Gateway

Minimal A-side development gateway.

## Current scope

This first version exposes:
- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`

It accepts the abstract model `assistant` and currently routes every request to a single upstream model configured by environment variables.

## Environment variables

- `PORT` - default `8080`
- `HOST` - default `127.0.0.1`
- `GATEWAY_TOKEN` - default `dev-gateway-token`
- `UPSTREAM_API_KEY` or `OPENROUTER_API_KEY` - required for real upstream calls
- `UPSTREAM_BASE_URL` - default `https://openrouter.ai/api/v1/chat/completions`
- `UPSTREAM_MODEL` - default `openai/gpt-4o-mini`
- `OPENROUTER_HTTP_REFERER` - optional
- `OPENROUTER_X_TITLE` - optional

## Start

```bash
npm run dev --workspace @office-agent/gateway
```

## Pi-auth-backed bootstrap

To copy the local Pi OAuth entry for Codex into the gateway-owned auth store:

```bash
npm run gateway:bootstrap-auth
```

This copies `openai-codex` from your normal Pi auth file into the dedicated gateway auth file.

To verify the gateway auth can resolve the target model:

```bash
npm run gateway:probe-auth
```

By default this probes:
- provider: `openai-codex`
- model: `gpt-5.3-codex-spark`
