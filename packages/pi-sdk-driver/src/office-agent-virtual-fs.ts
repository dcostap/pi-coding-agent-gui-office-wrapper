import {
  OFFICE_AGENT_CLIENT_KIND_ENV_NAME,
  OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN,
  OFFICE_AGENT_DEFAULT_GATEWAY_URL,
  OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME,
  OFFICE_AGENT_GATEWAY_URL_ENV_NAME,
  OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME,
  OFFICE_AGENT_WINDOWS_HOST_ENV_NAME,
  OFFICE_AGENT_WINDOWS_USER_ENV_NAME,
} from "@office-agent/runtime";

export const OFFICE_AGENT_VIRTUAL_FS_SCHEME = "virtual";
export const OFFICE_AGENT_VFS_URL_ENV_NAME = "OFFICE_AGENT_VFS_URL";

export interface OfficeAgentVirtualRoot {
  readonly scheme: typeof OFFICE_AGENT_VIRTUAL_FS_SCHEME;
  readonly authority: string;
  readonly uriPrefix: string;
  readonly rootId: string;
  readonly displayName: string;
  readonly readOnly: boolean;
}

export const OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS: readonly OfficeAgentVirtualRoot[] = [
  {
    scheme: OFFICE_AGENT_VIRTUAL_FS_SCHEME,
    authority: "server_iso_docs",
    uriPrefix: "virtual://server_iso_docs",
    rootId: "iso_docs",
    displayName: "ISO documentation",
    readOnly: true,
  },
];

export interface ParsedOfficeAgentVirtualUri {
  readonly scheme: typeof OFFICE_AGENT_VIRTUAL_FS_SCHEME;
  readonly authority: string;
  readonly uriPrefix: string;
  readonly rootId: string;
  readonly virtualPath: string;
  readonly root: OfficeAgentVirtualRoot;
}

export interface OfficeAgentVirtualFsReadResult {
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly nextOffset?: number;
}

export interface OfficeAgentVirtualFsListEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface OfficeAgentVirtualFsListResult {
  readonly entries: readonly OfficeAgentVirtualFsListEntry[];
  readonly limitReached?: boolean;
}

export interface OfficeAgentVirtualFsFindResult {
  readonly paths: readonly string[];
  readonly limitReached?: boolean;
}

export interface OfficeAgentVirtualFsGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly context?: boolean;
}

export interface OfficeAgentVirtualFsGrepResult {
  readonly matches: readonly OfficeAgentVirtualFsGrepMatch[];
  readonly limitReached?: boolean;
  readonly linesTruncated?: boolean;
}

export interface OfficeAgentVirtualFsClient {
  read(input: {
    readonly rootId: string;
    readonly path: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<OfficeAgentVirtualFsReadResult>;
  list(input: {
    readonly rootId: string;
    readonly path: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<OfficeAgentVirtualFsListResult>;
  find(input: {
    readonly rootId: string;
    readonly path: string;
    readonly pattern: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<OfficeAgentVirtualFsFindResult>;
  grep(input: {
    readonly rootId: string;
    readonly path: string;
    readonly pattern: string;
    readonly glob?: string;
    readonly ignoreCase?: boolean;
    readonly literal?: boolean;
    readonly context?: number;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<OfficeAgentVirtualFsGrepResult>;
}

export function parseOfficeAgentVirtualUri(
  input: unknown,
  roots: readonly OfficeAgentVirtualRoot[] = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS,
): ParsedOfficeAgentVirtualUri | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  if (!value.startsWith(`${OFFICE_AGENT_VIRTUAL_FS_SCHEME}://`)) {
    if (/^virtual:\/\//i.test(value)) {
      throw new Error(`Virtual URI scheme is case-sensitive: ${value}`);
    }
    return undefined;
  }
  if (value.includes("\0")) {
    throw new Error("Virtual path contains a NUL byte.");
  }
  if (value.includes("\\")) {
    throw new Error("Virtual paths must use '/' separators, not backslashes.");
  }

  const authorityMatch = /^virtual:\/\/([^/?#]*)(?:[/?#]|$)/.exec(value);
  const rawAuthority = authorityMatch?.[1] ?? "";
  if (!rawAuthority || rawAuthority !== rawAuthority.toLowerCase()) {
    throw new Error(`Virtual root names are case-sensitive: ${rawAuthority || value}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Malformed virtual path: ${value}`);
  }
  if (parsed.protocol !== `${OFFICE_AGENT_VIRTUAL_FS_SCHEME}:`) {
    throw new Error(`Unsupported virtual path scheme: ${parsed.protocol}`);
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error(`Malformed virtual path: ${value}`);
  }
  const root = roots.find((entry) => entry.authority === parsed.hostname);
  if (!root) {
    throw new Error(`Unknown OfficeAgent virtual root: ${parsed.hostname}`);
  }

  const decodedPath = decodeURIComponent(parsed.pathname || "/");
  if (!decodedPath.startsWith("/")) {
    throw new Error(`Malformed virtual path: ${value}`);
  }
  if (/[A-Za-z]:/.test(decodedPath) || decodedPath.startsWith("//")) {
    throw new Error(`Virtual path contains a host filesystem path fragment: ${value}`);
  }
  const segments = decodedPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Virtual path traversal is not allowed: ${value}`);
  }

  return {
    scheme: OFFICE_AGENT_VIRTUAL_FS_SCHEME,
    authority: root.authority,
    uriPrefix: root.uriPrefix,
    rootId: root.rootId,
    virtualPath: segments.length === 0 ? "/" : `/${segments.join("/")}`,
    root,
  };
}

export function containsOfficeAgentVirtualUri(value: string, roots: readonly OfficeAgentVirtualRoot[] = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS): boolean {
  return roots.some((root) => value.includes(root.uriPrefix));
}

export function getOfficeAgentVirtualUriBashAdvisory(
  value: string,
  roots: readonly OfficeAgentVirtualRoot[] = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS,
): string | undefined {
  const root = roots.find((entry) => value.includes(entry.uriPrefix));
  if (!root) return undefined;
  return `NOTE: ${root.uriPrefix} is an OfficeAgent virtual filesystem URI, not a local folder. Bash cannot access it. Use read, ls, find, or grep with that virtual path instead.`;
}

export function getOfficeAgentVirtualFsPromptContext(roots: readonly OfficeAgentVirtualRoot[] = OFFICE_AGENT_DEFAULT_VIRTUAL_ROOTS): string {
  const rootLines = roots.map((root) => `- ${root.uriPrefix}/: ${root.displayName} hosted on the OfficeAgent server.`).join("\n");
  const rootRefs = roots.map((root) => root.uriPrefix).join(", ");
  return [
    "OfficeAgent exposes read-only server virtual folders through normal read-only tools.",
    "Available virtual folders:",
    rootLines,
    "",
    `Use read, ls, find, and grep with paths under ${rootRefs} to inspect this content.`,
    "Virtual folders are not real local folders: bash cannot access them as remote content, and edit/write are blocked.",
    "When find or grep returns virtual://... paths, use those exact paths in follow-up read calls.",
    "Do not search virtual folders unless the task calls for company documentation or the user asks for it.",
  ].join("\n");
}

export function createOfficeAgentVirtualFsClient(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
} = {}): OfficeAgentVirtualFsClient {
  const env = options.env ?? process.env;
  const baseUrl = resolveOfficeAgentVfsBaseUrl(env);
  const token = env[OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME] || OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN;
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(appendUrlPath(baseUrl, path), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...createOfficeAgentIdentityHeaders(env),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => undefined) as unknown;
      if (!response.ok) {
        const message = extractVfsErrorMessage(payload) || `OfficeAgent VFS request failed (${response.status})`;
        throw new Error(message);
      }
      if (payload && typeof payload === "object" && "ok" in payload && (payload as { ok?: unknown }).ok === false) {
        throw new Error(extractVfsErrorMessage(payload) || "OfficeAgent VFS request failed");
      }
      return payload as T;
    } catch (error) {
      if (controller.signal.aborted || signal?.aborted) {
        throw new Error("OfficeAgent VFS request timed out or was aborted.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    read: (input) => {
      const { signal, ...body } = input;
      return post("read", body, signal);
    },
    list: (input) => {
      const { signal, ...body } = input;
      return post("list", body, signal);
    },
    find: (input) => {
      const { signal, ...body } = input;
      return post("find", body, signal);
    },
    grep: (input) => {
      const { signal, ...body } = input;
      return post("grep", body, signal);
    },
  };
}

function resolveOfficeAgentVfsBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env[OFFICE_AGENT_VFS_URL_ENV_NAME]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const gateway = (env[OFFICE_AGENT_GATEWAY_URL_ENV_NAME] || OFFICE_AGENT_DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
  return appendUrlPath(gateway, "vfs");
}

function appendUrlPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function extractVfsErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof record.message === "string") return record.message;
  return undefined;
}

function createOfficeAgentIdentityHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  setHeader(headers, "X-OfficeAgent-Client", env[OFFICE_AGENT_CLIENT_KIND_ENV_NAME]);
  setHeader(headers, "X-OfficeAgent-User", env[OFFICE_AGENT_WINDOWS_USER_ENV_NAME] || env.USERNAME || env.USER);
  setHeader(headers, "X-OfficeAgent-Domain", env[OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME] || env.USERDOMAIN);
  setHeader(headers, "X-OfficeAgent-Host", env[OFFICE_AGENT_WINDOWS_HOST_ENV_NAME] || env.COMPUTERNAME || env.HOSTNAME);
  return headers;
}

function setHeader(headers: Record<string, string>, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) headers[key] = trimmed;
}
