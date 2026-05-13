const ELECTRON_REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const LEADING_ERROR_PREFIX = /^Error:\s*/i;

function stripKnownWrappers(message: string) {
  return message.trim().replace(ELECTRON_REMOTE_ERROR_PREFIX, "").replace(LEADING_ERROR_PREFIX, "");
}

function translateKnownErrorMessage(message: string) {
  if (message.includes("OfficeAgent Windows sandbox v2 setup is required before commands can run.")) {
    const issueMatches = [...message.matchAll(/setup marker is missing: ([^\n;]+)/g)];
    const issueText = issueMatches.length > 0 ? " Falta la marca de configuración del sandbox." : "";
    return `El sandbox de Windows necesita configurarse antes de ejecutar comandos.${issueText} [Configurar sandbox](office-agent://windows-sandbox/setup).`;
  }

  return message;
}

export function cleanUserErrorMessage(
  message: string | null | undefined,
  fallback = "Something went wrong.",
) {
  if (!message) {
    return fallback;
  }

  const cleaned = translateKnownErrorMessage(stripKnownWrappers(message)).replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return cleanUserErrorMessage(error instanceof Error ? error.message : null, fallback);
}
