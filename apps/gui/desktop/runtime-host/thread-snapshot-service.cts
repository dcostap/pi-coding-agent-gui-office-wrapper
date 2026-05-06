import { buildThreadData } from "../../shared/thread-data.ts";
import { type SessionPathEntry, buildThreadHistorySlice } from "../../shared/thread-history.ts";
import { getPiModule } from "../pi-module.cts";

function parseSessionTimestampMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const timestampMs = Date.parse(value);
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function getLatestActivityTimestampMs(entries: SessionPathEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
    const timestampMs = parseSessionTimestampMs(entry.message?.timestamp ?? entry.timestamp);
    if (timestampMs !== null) return timestampMs;
  }
  return null;
}

export async function loadThreadSnapshot(request: {
  sessionPath: string;
  historyCompactions?: number;
}) {
  const { SessionManager } = await getPiModule();
  const manager = SessionManager.open(request.sessionPath);
  const branch = [...(manager.getBranch() as SessionPathEntry[])];
  const historySlice = buildThreadHistorySlice(branch, request.historyCompactions ?? 0);

  return {
    projectId: manager.getCwd(),
    threadId: manager.getSessionId(),
    lastActivityMs: getLatestActivityTimestampMs(branch),
    thread: buildThreadData({
      sessionPath: request.sessionPath,
      sourceMessages: historySlice.sourceMessages,
      previousMessageCount: historySlice.previousMessageCount,
      isStreaming: false,
      isCompacting: false,
    }),
  };
}
