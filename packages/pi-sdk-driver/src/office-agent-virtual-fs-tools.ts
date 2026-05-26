import {
  getOfficeAgentVirtualUriBashAdvisory,
  isOfficeAgentVirtualRootNamespacePath,
  parseOfficeAgentVirtualUri,
  type OfficeAgentVirtualFsClient,
  type OfficeAgentVirtualRoot,
} from "./office-agent-virtual-fs.js";

type ToolDefinitionLike = {
  readonly name?: string;
  readonly description?: string;
  readonly promptGuidelines?: string[];
  readonly execute: (...args: any[]) => Promise<any>;
  readonly renderCall?: (...args: any[]) => any;
  readonly [key: string]: any;
};

type ToolFactory = (cwd: string, options?: any) => any;

export interface OfficeAgentVirtualToolOptions {
  readonly cwd: string;
  readonly roots: readonly OfficeAgentVirtualRoot[];
  readonly client: OfficeAgentVirtualFsClient;
}

export function createOfficeAgentVirtualReadTool(
  createReadToolDefinition: ToolFactory,
  options: OfficeAgentVirtualToolOptions & { readonly readOptions?: unknown },
): ToolDefinitionLike {
  const localTool = createReadToolDefinition(options.cwd, options.readOptions);
  return {
    ...localTool,
    description: `${localTool.description} OfficeAgent virtual filesystem URIs such as ${formatRootExamples(options.roots)} are also supported for read-only server content.`,
    promptGuidelines: [
      ...(localTool.promptGuidelines ?? []),
      `Use read with ${formatRootExamples(options.roots)} paths for OfficeAgent server virtual filesystem content.`,
    ],
    async execute(toolCallId: string, params: { path: string; offset?: number; limit?: number }, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      const virtual = parseOfficeAgentVirtualUri(params.path, options.roots);
      if (!virtual) {
        return localTool.execute(toolCallId, params, signal, onUpdate, ctx);
      }
      const result = await options.client.read({
        rootId: virtual.rootId,
        path: virtual.virtualPath,
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        content: [{ type: "text" as const, text: formatReadResult(virtual.uriPrefix, result) }],
        details: result.truncated ? { truncation: { truncated: true } } : undefined,
      };
    },
  };
}

export function createOfficeAgentVirtualLsTool(
  createLsToolDefinition: ToolFactory,
  options: OfficeAgentVirtualToolOptions & { readonly lsOptions?: unknown },
): ToolDefinitionLike {
  const localTool = createLsToolDefinition(options.cwd, options.lsOptions);
  return {
    ...localTool,
    description: `${localTool.description} Lists OfficeAgent virtual filesystem URIs such as ${formatRootExamples(options.roots)} when requested.`,
    promptGuidelines: [
      ...(localTool.promptGuidelines ?? []),
      `Use ls with ${formatRootExamples(options.roots)} to discover OfficeAgent server virtual filesystem content.`,
    ],
    async execute(toolCallId: string, params: { path?: string; limit?: number } = {}, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      if (isOfficeAgentVirtualRootNamespacePath(params.path)) {
        const rootsResult = await options.client.roots(signal ? { signal } : undefined).catch(() => ({ roots: options.roots }));
        return {
          content: [{ type: "text" as const, text: formatVirtualRootListing(rootsResult.roots) || "No OfficeAgent virtual roots are currently available." }],
        };
      }

      const virtual = parseOfficeAgentVirtualUri(params.path, options.roots);
      if (virtual) {
        const result = await options.client.list({
          rootId: virtual.rootId,
          path: virtual.virtualPath,
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(signal ? { signal } : {}),
        });
        return {
          content: [{ type: "text" as const, text: formatListResult(result.entries, result.limitReached) }],
          details: result.limitReached ? { entryLimitReached: params.limit } : undefined,
        };
      }

      const localResult = await localTool.execute(toolCallId, params, signal, onUpdate, ctx);
      if (params.path === undefined || params.path === "" || params.path === ".") {
        const rootsResult = await options.client.roots(signal ? { signal } : undefined).catch(() => ({ roots: options.roots }));
        const virtualRootListing = formatVirtualRootListing(rootsResult.roots);
        return virtualRootListing ? appendTextToToolResult(localResult, virtualRootListing) : localResult;
      }
      return localResult;
    },
  };
}

export function createOfficeAgentVirtualFindTool(
  createFindToolDefinition: ToolFactory,
  options: OfficeAgentVirtualToolOptions & { readonly findOptions?: unknown },
): ToolDefinitionLike {
  const localTool = createFindToolDefinition(options.cwd, options.findOptions);
  return {
    ...localTool,
    description: `${localTool.description} Searches OfficeAgent virtual filesystem URIs such as ${formatRootExamples(options.roots)} when requested.`,
    promptGuidelines: [
      ...(localTool.promptGuidelines ?? []),
      `Use find with an explicit ${formatRootExamples(options.roots)} path to search OfficeAgent server virtual filesystem content.`,
    ],
    async execute(toolCallId: string, params: { pattern: string; path?: string; limit?: number }, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      const virtual = parseOfficeAgentVirtualUri(params.path, options.roots);
      if (!virtual) {
        return localTool.execute(toolCallId, params, signal, onUpdate, ctx);
      }
      const result = await options.client.find({
        rootId: virtual.rootId,
        path: virtual.virtualPath,
        pattern: params.pattern,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(signal ? { signal } : {}),
      });
      const lines = result.paths.map((entry) => toVirtualDisplayPath(virtual.uriPrefix, entry));
      return {
        content: [{ type: "text" as const, text: lines.length ? lines.join("\n") : "No files found matching pattern" }],
        details: result.limitReached ? { resultLimitReached: params.limit } : undefined,
      };
    },
  };
}

export function createOfficeAgentVirtualGrepTool(
  createGrepToolDefinition: ToolFactory,
  options: OfficeAgentVirtualToolOptions & { readonly grepOptions?: unknown },
): ToolDefinitionLike {
  const localTool = createGrepToolDefinition(options.cwd, options.grepOptions);
  return {
    ...localTool,
    description: `${localTool.description} Searches OfficeAgent virtual filesystem URIs such as ${formatRootExamples(options.roots)} when requested.`,
    promptGuidelines: [
      ...(localTool.promptGuidelines ?? []),
      `Use grep with an explicit ${formatRootExamples(options.roots)} path to search OfficeAgent server virtual filesystem content.`,
    ],
    async execute(
      toolCallId: string,
      params: { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number },
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown,
    ) {
      const virtual = parseOfficeAgentVirtualUri(params.path, options.roots);
      if (!virtual) {
        return localTool.execute(toolCallId, params, signal, onUpdate, ctx);
      }
      const result = await options.client.grep({
        rootId: virtual.rootId,
        path: virtual.virtualPath,
        pattern: params.pattern,
        ...(params.glob !== undefined ? { glob: params.glob } : {}),
        ...(params.ignoreCase !== undefined ? { ignoreCase: params.ignoreCase } : {}),
        ...(params.literal !== undefined ? { literal: params.literal } : {}),
        ...(params.context !== undefined ? { context: params.context } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(signal ? { signal } : {}),
      });
      const lines = result.matches.map((match) => {
        const separator = match.context ? "-" : ":";
        return `${toVirtualDisplayPath(virtual.uriPrefix, match.path)}${separator}${match.line}${separator} ${match.text}`;
      });
      return {
        content: [{ type: "text" as const, text: lines.length ? lines.join("\n") : "No matches found" }],
        details: result.limitReached || result.linesTruncated
          ? {
              ...(result.limitReached ? { matchLimitReached: params.limit } : {}),
              ...(result.linesTruncated ? { linesTruncated: true } : {}),
            }
          : undefined,
      };
    },
  };
}

export function withOfficeAgentVirtualWriteGuard(tool: ToolDefinitionLike, roots: readonly OfficeAgentVirtualRoot[]): ToolDefinitionLike {
  return {
    ...tool,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      `Do not use write with OfficeAgent virtual filesystem URIs such as ${formatRootExamples(roots)}; they are read-only.`,
    ],
    async execute(toolCallId: string, params: { path?: string; file_path?: string }, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      assertNotVirtualWritePath(params.path ?? params.file_path, roots);
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

export function withOfficeAgentVirtualEditGuard(tool: ToolDefinitionLike, roots: readonly OfficeAgentVirtualRoot[]): ToolDefinitionLike {
  return {
    ...tool,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      `Do not use edit with OfficeAgent virtual filesystem URIs such as ${formatRootExamples(roots)}; they are read-only.`,
    ],
    async execute(toolCallId: string, params: { path?: string; file_path?: string }, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      assertNotVirtualWritePath(params.path ?? params.file_path, roots);
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args: any, theme: any, context: any) {
      if (parseOfficeAgentVirtualUri(args?.path ?? args?.file_path, roots)) {
        return tool.renderCall?.({ path: args?.path ?? args?.file_path }, theme, context);
      }
      return tool.renderCall?.(args, theme, context);
    },
  };
}

export function withOfficeAgentVirtualBashAdvisory(tool: ToolDefinitionLike, roots: readonly OfficeAgentVirtualRoot[]): ToolDefinitionLike {
  return {
    ...tool,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      `Bash cannot access OfficeAgent virtual filesystem URIs such as ${formatRootExamples(roots)}. Use read, ls, find, or grep instead.`,
    ],
    async execute(toolCallId: string, params: { command?: string }, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) {
      const advisory = typeof params.command === "string" ? getOfficeAgentVirtualUriBashAdvisory(params.command, roots) : undefined;
      try {
        const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
        return advisory ? appendTextToToolResult(result, advisory) : result;
      } catch (error) {
        if (!advisory) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\n\n${advisory}`);
      }
    },
  };
}

export function assertNoReservedOfficeAgentToolNames(
  tools: readonly unknown[] | undefined,
  reservedNames = ["read", "ls", "find", "grep", "edit", "write", "bash", "copy_file_into_workspace"],
): void {
  if (!tools) return;
  const reserved = new Set(reservedNames);
  const duplicate = tools.find((tool) => {
    const name = typeof (tool as { name?: unknown })?.name === "string" ? (tool as { name: string }).name : undefined;
    return name ? reserved.has(name) : false;
  });
  if (duplicate) {
    throw new Error(`OfficeAgent managed runtime does not allow custom tools to override reserved tool name: ${(duplicate as { name: string }).name}`);
  }
}

function assertNotVirtualWritePath(path: unknown, roots: readonly OfficeAgentVirtualRoot[]): void {
  const virtual = parseOfficeAgentVirtualUri(path, roots);
  if (!virtual) return;
  throw new Error(`${virtual.uriPrefix} is read-only remote content. Use read, ls, find, or grep for ${virtual.uriPrefix} paths.`);
}

function formatReadResult(uriPrefix: string, result: { text: string; startLine: number; endLine: number; totalLines: number; truncated: boolean; nextOffset?: number }): string {
  if (!result.truncated || result.nextOffset === undefined) return result.text;
  const suffix = `\n\n[Showing lines ${result.startLine}-${result.endLine} of ${result.totalLines}. Use read with path=${uriPrefix}/... and offset=${result.nextOffset} to continue.]`;
  return `${result.text}${suffix}`;
}

function formatListResult(entries: readonly { name: string; isDirectory: boolean }[], limitReached?: boolean): string {
  const text = entries.length > 0
    ? entries.map((entry) => `${entry.name}${entry.isDirectory ? "/" : ""}`).join("\n")
    : "(empty directory)";
  return limitReached ? `${text}\n\n[Entry limit reached. Use a higher limit for more.]` : text;
}

function formatVirtualRootListing(roots: readonly OfficeAgentVirtualRoot[]): string {
  return roots.length > 0 ? roots.map(formatVirtualRootListingEntry).join("\n") : "";
}

function formatVirtualRootListingEntry(root: OfficeAgentVirtualRoot): string {
  const description = root.description?.trim();
  const suffix = root.displayName && root.displayName !== root.rootId ? ` - ${root.displayName}` : "";
  return description ? `${root.uriPrefix}/${suffix}\n  Description: ${description}` : `${root.uriPrefix}/${suffix}`;
}

function appendTextToToolResult(result: any, text: string): any {
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  const lastText = [...content].reverse().find((entry) => entry?.type === "text") as { type: "text"; text: string } | undefined;
  if (lastText) {
    return {
      ...result,
      content: content.map((entry) => entry === lastText ? { ...entry, text: joinText(entry.text, text) } : entry),
    };
  }
  return {
    ...result,
    content: [...content, { type: "text", text }],
  };
}

function joinText(left: string, right: string): string {
  const base = left?.trimEnd() ?? "";
  return base ? `${base}\n${right}` : right;
}

function toVirtualDisplayPath(uriPrefix: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${uriPrefix}${normalized}`;
}

function formatRootExamples(roots: readonly OfficeAgentVirtualRoot[]): string {
  return roots.length > 0 ? roots.map((root) => root.uriPrefix).join(", ") : "virtual://<root>";
}
