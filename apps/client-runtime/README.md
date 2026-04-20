# Client Runtime

This package holds the **pinned local Pi runtime** used by the project.

## Important property

This runtime is intentionally separate from any globally-installed `pi` the developer may already use via npm.

We do **not** rely on the machine's global `pi` binary.

Instead, we run the locally pinned CLI directly from:

- `./node_modules/@mariozechner/pi-coding-agent/dist/cli.js`

## Scripts

### Run raw pinned local Pi

```bash
npm run pi --workspace @office-agent/client-runtime
```

### Run managed local Pi with our provider extension and app-specific Pi data dir

```bash
npm run pi:managed --workspace @office-agent/client-runtime
```

That managed script:
- uses the locally pinned Pi runtime
- loads `extensions/corp-provider.ts`
- defaults to `corp/assistant`
- uses an app-specific Pi data dir under `%LOCALAPPDATA%\\OfficeAgent\\pi-agent-dev`

## Environment variables

- `OFFICE_AGENT_GATEWAY_URL` - default: `http://127.0.0.1:8080/v1`
- `OFFICE_AGENT_GATEWAY_TOKEN` - default: `dev-gateway-token`
- `PI_CODING_AGENT_DIR` - optional override for Pi state location
