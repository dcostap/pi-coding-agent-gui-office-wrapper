import type { DesktopAppState, SessionRecord, WorkspaceRecord } from "./desktop-state";

export interface ThreadEnvironmentMeta {
  readonly kind: "local";
  readonly label: string;
}

export interface ThreadListEntry {
  readonly workspaceId: string;
  readonly session: SessionRecord;
  readonly environment: ThreadEnvironmentMeta;
}

export interface ThreadGroup {
  readonly rootWorkspace: WorkspaceRecord;
  readonly threads: readonly ThreadListEntry[];
  readonly archivedThreads: readonly ThreadListEntry[];
}

export function buildThreadGroups(state: DesktopAppState): readonly ThreadGroup[] {
  const order = state.workspaceOrder;
  const sortedWorkspaces = [...state.workspaces].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1;
    if (bi === -1) return 1;
    return ai - bi;
  });

  return sortedWorkspaces.map((workspace) =>
    partitionThreads(
      workspace,
      workspace.sessions.map((session) => ({
        workspaceId: workspace.id,
        session,
        environment: {
          kind: "local" as const,
          label: "Local",
        },
      })),
    ),
  );
}

function partitionThreads(rootWorkspace: WorkspaceRecord, entries: readonly ThreadListEntry[]): ThreadGroup {
  return {
    rootWorkspace,
    threads: entries.filter((entry) => !entry.session.archivedAt),
    archivedThreads: entries.filter((entry) => Boolean(entry.session.archivedAt)),
  };
}
