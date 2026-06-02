const DEBUG_PREFIX = "[office-agent:first-message-layout]";

export type FirstMessageLayoutDebugEntry = {
  timestamp: string;
  source: string;
  snapshot: unknown;
};

declare global {
  interface Window {
    __officeAgentFirstMessageLayoutDebug?: FirstMessageLayoutDebugEntry[];
  }
}

export function logFirstMessageLayoutDebug(source: string, snapshot: unknown) {
  const entry: FirstMessageLayoutDebugEntry = {
    timestamp: new Date().toISOString(),
    source,
    snapshot,
  };

  window.__officeAgentFirstMessageLayoutDebug = [
    ...(window.__officeAgentFirstMessageLayoutDebug ?? []),
    entry,
  ].slice(-500);

  console.log(DEBUG_PREFIX, source, entry);
}
