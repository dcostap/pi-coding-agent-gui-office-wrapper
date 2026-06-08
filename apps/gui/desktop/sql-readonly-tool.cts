import { Type, type Static } from "typebox";
import {
  OFFICE_AGENT_CLIENT_KIND_ENV_NAME,
  OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN,
  OFFICE_AGENT_DEFAULT_GATEWAY_URL,
  OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME,
  OFFICE_AGENT_GATEWAY_URL_ENV_NAME,
  OFFICE_AGENT_TOOL_FILES_ENV_NAME,
  OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME,
  OFFICE_AGENT_WINDOWS_HOST_ENV_NAME,
  OFFICE_AGENT_WINDOWS_USER_ENV_NAME,
} from "../../../packages/office-agent-runtime/src/index.ts";
import { materializeSqlRemoteFilesIfPresent } from "./sql-remote-file-materializer.cts";

const SQL_READONLY_PARAMS = Type.Object({
  action: Type.Union(
    [Type.Literal("info"), Type.Literal("list_tables"), Type.Literal("describe"), Type.Literal("sample"), Type.Literal("query")],
    { description: "Operation to run: connection info, list tables/views, describe a table, sample rows, or execute a read-only query." },
  ),
  sql: Type.Optional(Type.String({ description: "SQL text for action=query. Must be a read-only SELECT or WITH query against the default CastrosuaIA database." })),
  schema: Type.Optional(Type.String({ description: "Schema name for list_tables, describe, or sample. Usually dbo." })),
  table: Type.Optional(Type.String({ description: "Table or view name for describe or sample." })),
  includeViews: Type.Optional(Type.Boolean({ description: "Include views for action=list_tables." })),
  limit: Type.Optional(Type.Number({ description: "Maximum sample row count for action=sample. Must be an integer. Default 20." })),
});

type SqlReadonlyParams = Static<typeof SQL_READONLY_PARAMS>;

export function createCastrosuaSqlReadonlyToolDefinition(options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}) {
  const gatewayUrl = options.env[OFFICE_AGENT_GATEWAY_URL_ENV_NAME] || OFFICE_AGENT_DEFAULT_GATEWAY_URL;
  const gatewayToken = options.env[OFFICE_AGENT_GATEWAY_TOKEN_ENV_NAME] || OFFICE_AGENT_DEFAULT_GATEWAY_TOKEN;
  const sqlEndpointUrl = appendUrlPath(gatewayUrl, "tools/castrosua_sql_read_only");
  const identityHeaders = createIdentityHeaders(options.env);
  const toolFilesRoot = options.env[OFFICE_AGENT_TOOL_FILES_ENV_NAME];

  return {
    name: "castrosua_sql_read_only",
    label: "Castrosua SQL Read-only",
    description: "Read-only access to the default CastrosuaIA SQL Server database through the OfficeAgent gateway. Use for schema inspection and safe SELECT queries. Large remote results are materialized into the active workspace before returning to the agent.",
    promptSnippet: "Inspect CastrosuaIA SQL Server metadata and run read-only SELECT/WITH queries for ERP Logic/Sage articles, suppliers, delivery notes, supplier orders, and other available CastrosuaIA data.",
    promptGuidelines: [
      "Use castrosua_sql_read_only when the user asks about ERP Logic/Sage, SQL Server data, CastrosuaIA data, schemas, samples, or read-only SQL query results.",
      "The only supported database is the gateway default CastrosuaIA database. Do not provide or ask for a database parameter, and do not try to switch databases.",
      "Use castrosua_sql_read_only for article/material codes from technical documentation when they look like Logic CodigoArticulo values, usually 6-digit numeric codes.",
      "castrosua_sql_read_only is read-only: use action=query only for SELECT or WITH queries, and prefer narrow projections, filters, and TOP clauses before broad exploration.",
      "For unknown tables, call castrosua_sql_read_only list_tables and describe before writing a query.",
      "If the gateway returns a large file payload, OfficeAgent saves it under .\\officeagent-tool-files\\sql\\ in the active workspace and returns that local path.",
    ],
    parameters: SQL_READONLY_PARAMS,
    async execute(_toolCallId: string, params: SqlReadonlyParams, signal?: AbortSignal, onUpdate?: (update: unknown) => void) {
      const action = params.action;
      onUpdate?.({ content: [{ type: "text", text: `Requesting SQL Server read-only action on OfficeAgent gateway: ${action}` }] });
      const payload = await postJsonWithAbort(sqlEndpointUrl, {
        action,
        sql: params.sql,
        schema: params.schema,
        table: params.table,
        includeViews: params.includeViews,
        limit: params.limit,
      }, gatewayToken, identityHeaders, signal);
      if (!assertToolResult(payload)) {
        throw new Error("OfficeAgent SQL gateway returned an invalid tool result.");
      }
      if (hasRemoteFiles(payload) && !toolFilesRoot) {
        throw new Error("OfficeAgent SQL gateway returned a remote file payload, but this session has no OFFICE_AGENT_TOOL_FILES workspace root.");
      }
      return materializeSqlRemoteFilesIfPresent(payload, {
        workspaceRoot: options.cwd,
        toolFilesRoot: toolFilesRoot ?? options.cwd,
        sqlEndpointUrl,
        gatewayToken,
        headers: identityHeaders,
        signal,
      });
    },
  };
}

function appendUrlPath(base: string, segment: string): string {
  return base.replace(/\/+$/, "") + "/" + segment.replace(/^\/+/, "");
}

function createIdentityHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const clientKind = env[OFFICE_AGENT_CLIENT_KIND_ENV_NAME] || "gui";
  const windowsUser = env[OFFICE_AGENT_WINDOWS_USER_ENV_NAME] || env.USERNAME || env.USER || "unknown-user";
  const windowsDomain = env[OFFICE_AGENT_WINDOWS_DOMAIN_ENV_NAME] || env.USERDOMAIN || "";
  const windowsHost = env[OFFICE_AGENT_WINDOWS_HOST_ENV_NAME] || env.COMPUTERNAME || env.HOSTNAME || "unknown-host";
  const identity = windowsDomain && windowsUser ? `${windowsDomain}\\${windowsUser}` : windowsUser;
  const headers: Record<string, string> = {
    "X-OfficeAgent-Client": clientKind,
    "X-OfficeAgent-User": windowsUser,
    "X-OfficeAgent-Host": windowsHost,
    "X-OfficeAgent-Identity": identity,
  };
  if (windowsDomain) headers["X-OfficeAgent-Domain"] = windowsDomain;
  return headers;
}

async function postJsonWithAbort(
  url: string,
  body: SqlReadonlyParams,
  gatewayToken: string,
  identityHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gatewayToken}`,
      ...identityHeaders,
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) || `OfficeAgent SQL gateway request failed with HTTP ${response.status}`);
  }
  return payload;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object" && typeof (record.error as { message?: unknown }).message === "string") {
    return (record.error as { message: string }).message;
  }
  if (typeof record.message === "string") return record.message;
  return undefined;
}

function assertToolResult(payload: unknown): payload is { content: unknown; details?: unknown } {
  return Boolean(payload && typeof payload === "object" && Array.isArray((payload as { content?: unknown }).content));
}

function hasRemoteFiles(payload: { details?: unknown }): boolean {
  const details = payload.details;
  if (!details || typeof details !== "object") return false;
  const remoteFiles = (details as { remoteFiles?: unknown }).remoteFiles;
  return Array.isArray(remoteFiles) && remoteFiles.length > 0;
}
