import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  createLocalThreadDraft,
  getLocalDraftChatGroupId,
  getLocalDraftProjectId,
  getPersistedSessionPath,
  isLocalSessionPath,
} from "../../../shared/session-paths";
import {
  createUnassignedChatProjectId,
  createUnassignedChatToken,
  UNNAMED_CHAT_TITLE,
  UNASSIGNED_CHAT_PROJECT_NAME,
  isUnassignedChatProjectId,
} from "../../../shared/unassigned-chats";
import type { ArchivedThread, ComposerState, ProjectGitState, ThreadData } from "../desktop/types";
import type { Project } from "../types";
import { useDesktopBridge } from "../hooks/useDesktopBridge";
import { useDesktopInbox } from "../hooks/useDesktopInbox";
import { useDesktopShell } from "../hooks/useDesktopShell";
import { useDesktopThread } from "../hooks/useDesktopThread";
import { useToast } from "../hooks/useToast";
import { createInitialWorkspaceState, workspaceReducer } from "../state/workspace";
import { deriveControllerViewModel } from "./controller-view-model";
import { useAppShellCommands } from "./useAppShellCommands";
import { useAppShellEffects } from "./useAppShellEffects";
import { useDesktopActionHandlers } from "./useDesktopActionHandlers";
import { useInboxAutoReadSync } from "./useInboxAutoReadSync";
import { useProjectRepoOriginRefresh } from "./useProjectRepoOriginRefresh";
import { useRunningTerminalSessions } from "./useRunningTerminalSessions";
import { useScopedProjectViewSync } from "./useScopedProjectViewSync";
import { createChatGroupQuery, getChatSidebarStateQuery } from "../query/desktop-query";

export function useAppShellController() {
  const queryClient = useQueryClient();
  const [appLaunchedAtMs] = useState(() => Date.now());
  const [state, dispatch] = useReducer(workspaceReducer, [], createInitialWorkspaceState);
  const [archivedThreads, setArchivedThreads] = useState<ArchivedThread[]>([]);
  const [composerState, setComposerState] = useState<ComposerState | null>(null);
  const [liveThreadData, setLiveThreadData] = useState<ThreadData | null>(null);
  const [projectGitState, setProjectGitState] = useState<ProjectGitState | null>(null);
  const [extensionsProjectScopeActive, setExtensionsProjectScopeActive] = useState(false);
  const [skillsProjectScopeActive, setSkillsProjectScopeActive] = useState(false);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);
  const [threadHistoryCompactions, setThreadHistoryCompactions] = useState(0);
  const [selectedChatGroupId, setSelectedChatGroupId] = useState<string | null>(null);
  const [chatSidebarState, setChatSidebarState] =
    useState<Awaited<ReturnType<typeof getChatSidebarStateQuery>>>(null);
  const [localDraftProjects, setLocalDraftProjects] = useState<Project[]>([]);
  const { toast, showToast } = useToast();
  const {
    shellState,
    loadArchivedThreads,
    loadComposerState,
    listComposerAttachmentEntries,
    loadProjectGitState,
    loadProjectThreads,
    applyProjectOrder,
    pickComposerAttachments,
    refreshShellState,
    scheduleShellStateRefresh,
  } = useDesktopShell();
  const invokeDesktopAction = useDesktopBridge();
  const shellProjects = shellState?.projects ?? [];
  const projects = useMemo(() => {
    if (localDraftProjects.length === 0) {
      return shellProjects;
    }

    const shellProjectIds = new Set(shellProjects.map((project) => project.id));
    const mergedProjects = new Map(shellProjects.map((project) => [project.id, project]));
    for (const localProject of localDraftProjects) {
      const persistedProject = mergedProjects.get(localProject.id);
      if (!persistedProject) {
        mergedProjects.set(localProject.id, localProject);
        continue;
      }

      const persistedSessionPaths = new Set(
        persistedProject.threads.map((thread) => thread.sessionPath).filter(Boolean),
      );
      const localDraftReplaced = persistedProject.threads.some(
        (thread) =>
          !isLocalSessionPath(thread.sessionPath) &&
          (thread.lastModifiedMs ?? 0) >= (localProject.latestModifiedMs ?? 0),
      );
      const localOnlyThreads = localDraftReplaced
        ? []
        : localProject.threads.filter(
            (thread) => thread.sessionPath && !persistedSessionPaths.has(thread.sessionPath),
          );

      mergedProjects.set(localProject.id, {
        ...persistedProject,
        name: isUnassignedChatProjectId(localProject.id)
          ? UNASSIGNED_CHAT_PROJECT_NAME
          : (persistedProject.name || localProject.name),
        threads: [...localOnlyThreads, ...persistedProject.threads],
        threadsLoaded: persistedProject.threadsLoaded || localProject.threadsLoaded,
        threadCount: Math.max(
          persistedProject.threadCount ?? 0,
          persistedProject.threads.length + localOnlyThreads.length,
        ),
        collapsed: false,
      });
    }

    return [
      ...shellProjects.map((project) => mergedProjects.get(project.id) ?? project),
      ...localDraftProjects.filter((project) => !shellProjectIds.has(project.id)),
    ];
  }, [localDraftProjects, shellProjects]);
  const threadData = useDesktopThread(
    state.selectedSessionPath,
    threadRefreshKey,
    threadHistoryCompactions,
  );
  const selectedPersistedSessionPath = getPersistedSessionPath(state.selectedSessionPath);
  const effectiveThreadData =
    threadHistoryCompactions === 0 && liveThreadData?.sessionPath === selectedPersistedSessionPath
      ? liveThreadData
      : threadData;
  const inboxQuery = useDesktopInbox();
  const inboxThreads = inboxQuery.data ?? [];
  const selectedInboxThread = useMemo(
    () =>
      inboxThreads.find((thread) => thread.sessionPath === state.selectedInboxSessionPath) ?? null,
    [inboxThreads, state.selectedInboxSessionPath],
  );

  useEffect(() => {
    const localDraftProjectId = getLocalDraftProjectId(state.selectedSessionPath);
    if (!localDraftProjectId) {
      return;
    }

    const persistedProject = shellProjects.find((project) => project.id === localDraftProjectId);
    const localDraftProject = localDraftProjects.find((project) => project.id === localDraftProjectId);
    if (!persistedProject || !localDraftProject) {
      return;
    }

    const replacementThread = persistedProject.threads.find(
      (thread) =>
        thread.sessionPath &&
        !isLocalSessionPath(thread.sessionPath) &&
        (thread.lastModifiedMs ?? 0) >= (localDraftProject.latestModifiedMs ?? 0),
    );
    if (replacementThread?.sessionPath) {
      setLocalDraftProjects((current) =>
        current.filter((project) => project.id !== localDraftProjectId),
      );
      dispatch({
        type: "open-thread",
        projectId: localDraftProjectId,
        threadId: replacementThread.id,
        sessionPath: replacementThread.sessionPath,
      });
      return;
    }

    if (!persistedProject.threadsLoaded && (persistedProject.threadCount ?? 0) > 0) {
      void loadProjectThreads(localDraftProjectId);
    }
  }, [loadProjectThreads, localDraftProjects, shellProjects, state.selectedSessionPath]);

  const { terminalRunningProjectIds, terminalRunningSessionPaths } = useRunningTerminalSessions();
  const refreshChatSidebarState = useCallback(
    async (groupId = selectedChatGroupId) => {
      const nextState = await getChatSidebarStateQuery(groupId);
      setChatSidebarState(nextState);
      return nextState;
    },
    [selectedChatGroupId],
  );
  const handleCreateChatGroup = async (name: string) => {
    const nextState = await createChatGroupQuery(name);
    setChatSidebarState(nextState);
    if (nextState?.selectedGroupId) setSelectedChatGroupId(nextState.selectedGroupId);
    return nextState;
  };

  useEffect(() => {
    if (state.activeView === "chat") {
      void getChatSidebarStateQuery(selectedChatGroupId).then(setChatSidebarState);
    }
  }, [state.activeView, selectedChatGroupId]);

  const {
    activeComposerState,
    activeThreadData,
    collapsedProjectIds,
    composerProjectId,
    currentProjectName,
    currentTitle,
  } = useMemo(
    () =>
      deriveControllerViewModel({
        projects,
        workspaceState: state,
        threadData: effectiveThreadData,
        shellCwd: shellState?.cwd,
        composerState,
        shellComposerState: shellState?.composer,
      }),
    [composerState, effectiveThreadData, projects, shellState?.composer, shellState?.cwd, state],
  );

  useAppShellEffects({
    projects,
    collapsedProjectIds,
    workspaceState: state,
    selectedInboxThread,
    composerProjectId,
    shellComposerState: shellState?.composer,
    shellAppSettings: shellState?.appSettings,
    loadProjectThreads,
    loadArchivedThreads,
    loadComposerState,
    loadProjectGitState,
    scheduleShellStateRefresh,
    refreshChatSidebarState,
    queryClient,
    dispatch,
    setArchivedThreads,
    setComposerState,
    setLiveThreadData,
    setProjectGitState,
    setThreadHistoryCompactions,
  });

  const { handleAction, runDesktopAction } = useDesktopActionHandlers({
    activeView: state.activeView,
    composerProjectId,
    dispatch,
    invokeDesktopAction,
    loadArchivedThreads,
    loadComposerState,
    loadProjectGitState,
    loadProjectThreads,
    refreshShellState,
    selectedSessionPath: state.selectedSessionPath,
    setArchivedThreads,
    setComposerState,
    setLiveThreadData,
    setProjectGitState,
    showToast,
    workspaceState: state,
  });

  useProjectRepoOriginRefresh({
    projects,
    selectedProjectId: state.selectedProjectId,
    runDesktopAction,
  });

  useScopedProjectViewSync({
    activeView: state.activeView,
    extensionsProjectScopeActive,
    setExtensionsProjectScopeActive,
    setSkillsProjectScopeActive,
    skillsProjectScopeActive,
  });

  useInboxAutoReadSync({
    dispatch,
    inboxQueryIsSuccess: inboxQuery.isSuccess,
    inboxThreads,
    invokeDesktopAction,
    loadProjectThreads,
    queryClient,
    workspaceState: state,
  });

  const commands = useAppShellCommands({
    applyProjectOrder,
    collapsedProjectIds,
    composerProjectId,
    dispatch,
    handleAction,
    queryClient,
    runDesktopAction,
    scheduleShellStateRefresh,
    setThreadHistoryCompactions,
    setThreadRefreshKey,
    shellState,
    workspaceState: state,
  });

  const openLocalDraftThread = useCallback(
    ({
      projectId,
      projectName,
      token,
      chatGroupId = null,
      composerMode = "code",
    }: {
      projectId: string;
      projectName: string;
      token?: string;
      chatGroupId?: string | null;
      composerMode?: "chat" | "code";
    }) => {
      const currentDraftProjectId = getLocalDraftProjectId(state.selectedSessionPath);
      if (currentDraftProjectId === projectId) {
        dispatch({ type: "show-view", view: composerMode === "chat" ? "chat" : "thread" });
        return;
      }

      const existingDraftProject = localDraftProjects.find((project) => project.id === projectId);
      const existingDraftProjectReplaced = shellProjects
        .find((project) => project.id === projectId)
        ?.threads.some(
          (thread) =>
            !isLocalSessionPath(thread.sessionPath) &&
            (thread.lastModifiedMs ?? 0) >= (existingDraftProject?.latestModifiedMs ?? 0),
        );
      const existingDraft = existingDraftProjectReplaced
        ? undefined
        : existingDraftProject?.threads.find(
            (thread) => getLocalDraftChatGroupId(thread.sessionPath) === (chatGroupId ?? null),
          );
      if (existingDraftProjectReplaced) {
        setLocalDraftProjects((current) => current.filter((project) => project.id !== projectId));
      }
      if (existingDraft?.sessionPath) {
        dispatch({
          type: "open-thread",
          projectId,
          threadId: existingDraft.id,
          sessionPath: existingDraft.sessionPath,
          view: composerMode === "chat" ? "chat" : "thread",
        });
        return;
      }

      const draft = createLocalThreadDraft(projectId, token, { chatGroupId });
      const now = Date.now();
      const localProject: Project = {
        id: projectId,
        name: projectName,
        threads: [
          {
            id: draft.threadId,
            title: UNNAMED_CHAT_TITLE,
            age: "Ahora",
            lastModifiedMs: now,
            sessionPath: draft.sessionPath,
          },
        ],
        latestModifiedMs: now,
        collapsed: false,
        threadsLoaded: true,
        threadCount: 1,
      };

      setLocalDraftProjects((current) => [
        localProject,
        ...current.filter((project) => project.id !== projectId),
      ]);
      setThreadHistoryCompactions(0);
      dispatch({
        type: "open-thread",
        projectId: draft.projectId,
        threadId: draft.threadId,
        sessionPath: draft.sessionPath,
      });

      void loadComposerState({ projectId, composerMode }).then((nextComposerState) => {
        if (nextComposerState) {
          setComposerState(nextComposerState);
        }
      });
    },
    [dispatch, loadComposerState, localDraftProjects, shellProjects, state.selectedSessionPath],
  );

  const handleStartProjectChat = useCallback(
    (projectId: string, projectName?: string) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      const resolvedProjectName = projectName?.trim() || project?.name || projectId.split(/[\\/]+/).pop() || projectId;

      openLocalDraftThread({ projectId, projectName: resolvedProjectName });
    },
    [openLocalDraftThread, projects],
  );

  const handleStartChatModeChat = useCallback(
    (groupId: string | null) => {
      const projectId = composerProjectId || shellState?.cwd || "";
      if (!projectId) {
        showToast("La aplicacion aun esta preparando el chat. Intentalo de nuevo en un momento.");
        return;
      }

      const currentDraftProjectId = getLocalDraftProjectId(state.selectedSessionPath);
      const currentDraftGroupId = getLocalDraftChatGroupId(state.selectedSessionPath);
      if (currentDraftProjectId === projectId && currentDraftGroupId === (groupId ?? null)) {
        dispatch({ type: "show-view", view: "chat" });
        return;
      }

      openLocalDraftThread({
        projectId,
        projectName: "Chat",
        chatGroupId: groupId,
        composerMode: "chat",
      });
    },
    [composerProjectId, dispatch, openLocalDraftThread, shellState?.cwd, showToast, state.selectedSessionPath],
  );

  const handleStartUnassignedChat = useCallback(() => {
    const projectsRoot = shellState?.appSettings.preferredProjectLocation ?? shellState?.cwd ?? "";
    if (!projectsRoot) {
      showToast("La aplicacion aun esta preparando los chats sin proyecto. Intentalo de nuevo en un momento.");
      return;
    }

    const currentDraftProjectId = getLocalDraftProjectId(state.selectedSessionPath);
    if (currentDraftProjectId && isUnassignedChatProjectId(currentDraftProjectId)) {
      dispatch({ type: "show-view", view: "thread" });
      return;
    }

    const existingUnassignedDraft = localDraftProjects.find((project) => isUnassignedChatProjectId(project.id));
    const existingUnassignedDraftReplaced = existingUnassignedDraft
      ? shellProjects
          .find((project) => project.id === existingUnassignedDraft.id)
          ?.threads.some(
            (thread) =>
              !isLocalSessionPath(thread.sessionPath) &&
              (thread.lastModifiedMs ?? 0) >= (existingUnassignedDraft.latestModifiedMs ?? 0),
          )
      : false;
    if (existingUnassignedDraftReplaced && existingUnassignedDraft) {
      setLocalDraftProjects((current) => current.filter((project) => project.id !== existingUnassignedDraft.id));
    }
    const existingUnassignedThread = existingUnassignedDraftReplaced ? undefined : existingUnassignedDraft?.threads[0];
    if (existingUnassignedDraft && existingUnassignedThread?.sessionPath) {
      dispatch({
        type: "open-thread",
        projectId: existingUnassignedDraft.id,
        threadId: existingUnassignedThread.id,
        sessionPath: existingUnassignedThread.sessionPath,
      });
      return;
    }

    const token = createUnassignedChatToken();
    openLocalDraftThread({
      projectId: createUnassignedChatProjectId(projectsRoot, token),
      projectName: UNASSIGNED_CHAT_PROJECT_NAME,
      token,
    });
  }, [dispatch, localDraftProjects, openLocalDraftThread, shellProjects, shellState?.appSettings.preferredProjectLocation, shellState?.cwd, showToast, state.selectedSessionPath]);

  return {
    activeComposerState,
    activeThreadData,
    archivedThreads,
    collapsedProjectIds,
    composerProjectId,
    currentProjectName,
    currentTitle,
    handleAction,
    ...commands,
    inboxThreads,
    handleSetSkillsProjectScopeActive: setSkillsProjectScopeActive,
    handleSetExtensionsProjectScopeActive: setExtensionsProjectScopeActive,
    handleLoadProjectThreads: loadProjectThreads,
    listComposerAttachmentEntries,
    pickComposerAttachments,
    extensionsProjectScopeActive,
    appLaunchedAtMs,
    projects,
    projectGitState,
    shellState,
    skillsProjectScopeActive,
    state,
    selectedInboxThread,
    terminalRunningProjectIds,
    terminalRunningSessionPaths,
    toast,
    chatSidebarState,
    selectedChatGroupId,
    handleCreateChatGroup,
    handleSelectChatGroup: setSelectedChatGroupId,
    handleStartUnassignedChat,
    handleStartProjectChat,
    handleStartChatModeChat,
    refreshChatSidebarState,
  };
}

export type AppShellController = ReturnType<typeof useAppShellController>;
