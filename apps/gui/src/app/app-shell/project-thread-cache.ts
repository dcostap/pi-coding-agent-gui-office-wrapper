import { isLocalSessionPath } from "../../../shared/session-paths";
import type { ShellState, Thread } from "../desktop/types";
import { desktopQueryKeys } from "../query/desktop-query";

type QueryClientLike = {
  setQueryData: (queryKey: readonly unknown[], updater: (current: unknown) => unknown) => void;
};

type ApplyProjectThreadOptions = {
  replaceSessionPath?: string | null;
  revealProject?: boolean;
  preserveLastModified?: boolean;
};

function sameThread(left: Thread, right: Thread, replaceSessionPath: string | null) {
  if (left.id === right.id) {
    return true;
  }

  if (left.sessionPath && right.sessionPath && left.sessionPath === right.sessionPath) {
    return true;
  }

  return Boolean(replaceSessionPath && left.sessionPath === replaceSessionPath);
}

function mergeThread(
  existing: Thread | undefined,
  next: Thread,
  options: { preserveLastModified: boolean },
): Thread {
  return {
    ...existing,
    ...next,
    age: options.preserveLastModified && existing ? existing.age : next.age,
    lastModifiedMs:
      options.preserveLastModified && existing ? existing.lastModifiedMs : next.lastModifiedMs,
    pinned: existing?.pinned ?? next.pinned,
    unread: next.unread ?? existing?.unread,
  };
}

export function applyProjectThreadToShellState(
  queryClient: QueryClientLike,
  projectId: string,
  thread: Thread,
  options: ApplyProjectThreadOptions = {},
) {
  const replaceSessionPath = options.replaceSessionPath ?? null;
  const revealProject = options.revealProject ?? false;
  const preserveLastModified = options.preserveLastModified ?? false;

  queryClient.setQueryData(desktopQueryKeys.shellState(), (current) => {
    const currentState = current as ShellState | null | undefined;
    if (!currentState) {
      return currentState ?? null;
    }

    return {
      ...currentState,
      projects: currentState.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        const existingThread = project.threads.find((candidate) =>
          sameThread(candidate, thread, replaceSessionPath),
        );
        const nextThread = mergeThread(existingThread, thread, { preserveLastModified });
        const remainingThreads = project.threads.filter(
          (candidate) => !sameThread(candidate, thread, replaceSessionPath),
        );
        const threads = [nextThread, ...remainingThreads];

        return {
          ...project,
          threads,
          threadCount: Math.max(project.threadCount ?? 0, threads.length),
          threadsLoaded: true,
          latestModifiedMs: Math.max(project.latestModifiedMs ?? 0, thread.lastModifiedMs ?? 0),
          collapsed: revealProject ? false : project.collapsed,
        };
      }),
    };
  });
}

export function getDraftReplacementSessionPath(
  selectedSessionPath: string | null,
  selectedProjectId: string,
  eventProjectId: string,
) {
  return selectedProjectId === eventProjectId && isLocalSessionPath(selectedSessionPath)
    ? selectedSessionPath
    : null;
}

function getNextThreadCount(project: ShellState["projects"][number], threads: Thread[]) {
  const removedThreadCount = project.threads.length - threads.length;
  const indexedThreadCount = project.threadCount ?? project.threads.length;
  return indexedThreadCount > project.threads.length
    ? indexedThreadCount
    : Math.max(threads.length, indexedThreadCount - removedThreadCount);
}

export function removeProjectThreadFromShellState(
  queryClient: QueryClientLike,
  projectId: string,
  sessionPath: string,
) {
  queryClient.setQueryData(desktopQueryKeys.shellState(), (current) => {
    const currentState = current as ShellState | null | undefined;
    if (!currentState) {
      return currentState ?? null;
    }

    return {
      ...currentState,
      projects: currentState.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        const threads = project.threads.filter((thread) => thread.sessionPath !== sessionPath);

        return {
          ...project,
          threads,
          threadCount: getNextThreadCount(project, threads),
        };
      }),
    };
  });
}

export function removeProjectThreadByIdFromShellState(
  queryClient: QueryClientLike,
  projectId: string,
  threadId: string,
) {
  queryClient.setQueryData(desktopQueryKeys.shellState(), (current) => {
    const currentState = current as ShellState | null | undefined;
    if (!currentState) {
      return currentState ?? null;
    }

    return {
      ...currentState,
      projects: currentState.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        const threads = project.threads.filter((thread) => thread.id !== threadId);

        return {
          ...project,
          threads,
          threadCount: getNextThreadCount(project, threads),
        };
      }),
    };
  });
}

export function removeThreadByIdFromShellState(queryClient: QueryClientLike, threadId: string) {
  queryClient.setQueryData(desktopQueryKeys.shellState(), (current) => {
    const currentState = current as ShellState | null | undefined;
    if (!currentState) {
      return currentState ?? null;
    }

    return {
      ...currentState,
      projects: currentState.projects.map((project) => {
        const threads = project.threads.filter((thread) => thread.id !== threadId);
        if (threads.length === project.threads.length) {
          return project;
        }

        return {
          ...project,
          threads,
          threadCount: getNextThreadCount(project, threads),
        };
      }),
    };
  });
}
