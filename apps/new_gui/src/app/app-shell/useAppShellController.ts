import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  createLocalThreadDraft,
  getLocalDraftProjectId,
  getPersistedSessionPath,
  isLocalSessionPath,
} from "../../../shared/session-paths";
import {
  createUnassignedChatProjectId,
  createUnassignedChatToken,
  UNNAMED_CHAT_TITLE,
  UNASSIGNED_CHAT_PROJECT_NAME,
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
  const [localUnassignedChatProjects, setLocalUnassignedChatProjects] = useState<Project[]>([]);
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
    if (localUnassignedChatProjects.length === 0) {
      return shellProjects;
    }

    const shellProjectIds = new Set(shellProjects.map((project) => project.id));
    const mergedProjects = new Map(shellProjects.map((project) => [project.id, project]));
    for (const localProject of localUnassignedChatProjects) {
      const persistedProject = mergedProjects.get(localProject.id);
      if (!persistedProject) {
        mergedProjects.set(localProject.id, localProject);
        continue;
      }

      const persistedSessionPaths = new Set(
        persistedProject.threads.map((thread) => thread.sessionPath).filter(Boolean),
      );
      const localOnlyThreads = localProject.threads.filter(
        (thread) => thread.sessionPath && !persistedSessionPaths.has(thread.sessionPath),
      );

      mergedProjects.set(localProject.id, {
        ...persistedProject,
        name: UNASSIGNED_CHAT_PROJECT_NAME,
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
      ...localUnassignedChatProjects.filter((project) => !shellProjectIds.has(project.id)),
    ];
  }, [localUnassignedChatProjects, shellProjects]);
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
    if (!persistedProject) {
      return;
    }

    const replacementThread = persistedProject.threads.find(
      (thread) => thread.sessionPath && !isLocalSessionPath(thread.sessionPath),
    );
    if (replacementThread?.sessionPath) {
      setLocalUnassignedChatProjects((current) =>
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
  }, [loadProjectThreads, shellProjects, state.selectedSessionPath]);

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

  const handleStartUnassignedChat = useCallback(() => {
    const projectsRoot = shellState?.appSettings.preferredProjectLocation ?? shellState?.cwd ?? "";
    if (!projectsRoot) {
      showToast("No se pudo preparar el chat sin proyecto.");
      return;
    }

    const token = createUnassignedChatToken();
    const projectId = createUnassignedChatProjectId(projectsRoot, token);
    const draft = createLocalThreadDraft(projectId, token);
    const now = Date.now();
    const localProject: Project = {
      id: projectId,
      name: UNASSIGNED_CHAT_PROJECT_NAME,
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

    setLocalUnassignedChatProjects((current) => [
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

    void loadComposerState({ projectId, composerMode: "code" }).then((nextComposerState) => {
      if (nextComposerState) {
        setComposerState(nextComposerState);
      }
    });
  }, [dispatch, loadComposerState, shellState?.appSettings.preferredProjectLocation, shellState?.cwd, showToast]);

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
    refreshChatSidebarState,
  };
}

export type AppShellController = ReturnType<typeof useAppShellController>;
