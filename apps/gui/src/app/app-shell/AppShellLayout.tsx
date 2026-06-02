import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPersistedSessionPath, isLocalSessionPath } from "../../../shared/session-paths";
import { GlobalToasts } from "../components/common/GlobalToasts";
import { TextSelectionContextMenu } from "../components/common/TextSelectionContextMenu";
import { Tooltip } from "../components/common/Tooltip";
import { Sidebar } from "../components/sidebar/Sidebar";
import { TerminalPanel } from "../components/workspace/TerminalPanel";
import { ProjectFileBrowserPanel } from "../components/workspace/project-files/ProjectFileBrowserPanel";
import {
  getAttachedFilePathsFromMessages,
  getProjectFilesPanelLabels,
} from "../components/workspace/project-files/projectFilePanelUtils";
import { defaultDiffBaseline } from "../components/workspace/composer/diff-baseline";
import { cleanUserErrorMessage } from "../desktop/error-messages";
import type { ProjectDiffBaseline, ProjectDiffRenderMode } from "../desktop/types";
import { useAnimatedPresence } from "../hooks/useAnimatedPresence";
import { showGlobalToast } from "../hooks/useToast";
import { cn } from "../utils/cn";
import { AppShellOverlays } from "./AppShellOverlays";
import { AppShellWorkspace } from "./AppShellWorkspace";
import { appShellRootClass } from "./layout-classes";
import { ShellSideDock } from "./ShellSideDock";
import type { AppShellController } from "./useAppShellController";
import { useAppShellLayoutState } from "./useAppShellLayoutState";

const TERMINAL_DRAWER_WIDTH = "min(28rem, calc(100% - 2.5rem))";
const PROJECT_FILES_DOCK_WIDTH = 400;
const PROJECT_FILES_DOCKED_MIN_WIDTH = 1180;

let automaticWindowsSandboxSetupStarted = false;

function formatAutomaticSandboxSetupFailure(error: string | null | undefined) {
  const message = cleanUserErrorMessage(error, "No se pudo configurar el sandbox de Windows.");
  return `${message} La app volverá a intentarlo al abrirse de nuevo; también puedes configurarlo desde Ajustes.`;
}

function startAutomaticWindowsSandboxSetupIfNeeded() {
  if (automaticWindowsSandboxSetupStarted) {
    return;
  }
  automaticWindowsSandboxSetupStarted = true;

  const desktopApi = window.piDesktop;
  if (!desktopApi?.getWindowsSandboxSetupStatus || !desktopApi.runWindowsSandboxSetup) {
    return;
  }

  void (async () => {
    const status = await desktopApi.getWindowsSandboxSetupStatus?.();
    if (!status || status.ready) {
      return;
    }
    if (!status.available) {
      showGlobalToast({
        message: formatAutomaticSandboxSetupFailure(status.error),
        tone: "error",
        timeoutMs: 9000,
      });
      return;
    }

    showGlobalToast({
      message:
        "El sandbox de Windows necesita una configuración inicial. Se solicitarán permisos de administrador…",
      tone: "info",
    });
    const result = await desktopApi.runWindowsSandboxSetup?.("setup");
    if (result?.readyAfterRun) {
      showGlobalToast({
        message: "Sandbox configurado correctamente. Ya puedes ejecutar comandos.",
        tone: "success",
      });
      return;
    }
    if (result?.ok === false) {
      showGlobalToast({
        message: formatAutomaticSandboxSetupFailure(result.error),
        tone: "error",
        timeoutMs: 9000,
      });
      return;
    }
    if (result?.readyAfterRun !== true) {
      showGlobalToast({
        message:
          "La configuración del sandbox no se completó. La app volverá a intentarlo al abrirse de nuevo; también puedes configurarlo desde Ajustes.",
        tone: "warning",
        timeoutMs: 9000,
      });
    }
  })().catch((error) => {
    showGlobalToast({
      message: formatAutomaticSandboxSetupFailure(
        error instanceof Error ? error.message : undefined,
      ),
      tone: "error",
      timeoutMs: 9000,
    });
  });
}

function useProjectFilesDockedMode() {
  const [docked, setDocked] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= PROJECT_FILES_DOCKED_MIN_WIDTH,
  );

  useEffect(() => {
    let animationFrame: number | null = null;
    const updateDockedMode = () => setDocked(window.innerWidth >= PROJECT_FILES_DOCKED_MIN_WIDTH);
    const scheduleDockedModeUpdate = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateDockedMode();
      });
    };

    updateDockedMode();
    window.addEventListener("resize", scheduleDockedModeUpdate);
    return () => {
      window.removeEventListener("resize", scheduleDockedModeUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return docked;
}

type TakeoverTerminalKeyState = {
  key: string;
  projectId: string;
  threadId: string | null;
  sessionPath: string | null;
};

function isLocalToPersistedTakeoverTransition(
  previous: TakeoverTerminalKeyState,
  nextProjectId: string,
  nextThreadId: string | null,
  nextSessionPath: string | null,
) {
  return (
    previous.projectId === nextProjectId &&
    previous.threadId !== null &&
    previous.threadId === nextThreadId &&
    isLocalSessionPath(previous.sessionPath) &&
    getPersistedSessionPath(nextSessionPath) !== null
  );
}

function AppTitleBar({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const titleBarRef = useRef<HTMLElement>(null);
  const sidebarToggleLabel = sidebarCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral";

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!titleBarRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [openMenuId]);

  return (
    <header
      ref={titleBarRef}
      className="app-titlebar relative z-[80] flex h-9 shrink-0 items-center bg-[color:var(--bg)] pr-[142px] pl-1.5"
    >
      <Tooltip content={sidebarToggleLabel} placement="right">
        <button
          type="button"
          className="app-titlebar-sidebar-toggle inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.075)]"
          onClick={onToggleSidebar}
          aria-label={sidebarToggleLabel}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </Tooltip>
      <div className="ml-2 select-none text-[14px] font-medium tracking-[0.01em] text-[#9a9a9a]">
        Castrosua IA
      </div>
      <div className="min-w-0 flex-1" />
    </header>
  );
}

function areDiffBaselinesEqual(left: ProjectDiffBaseline, right: ProjectDiffBaseline) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "commit" && right.kind === "commit") {
    return left.sha === right.sha;
  }

  if (left.kind === "last-opened" && right.kind === "last-opened") {
    return left.rev === right.rev;
  }

  return true;
}

function isSameDraftPromotion({
  activeThreadId,
  messageCount,
  previousSessionPath,
  previousThreadId,
  nextSessionPath,
}: {
  activeThreadId: string | null;
  messageCount: number | null;
  previousSessionPath: string | null;
  previousThreadId: string | null;
  nextSessionPath: string | null;
}) {
  return (
    isLocalSessionPath(previousSessionPath) &&
    previousThreadId !== null &&
    previousThreadId.startsWith("local-thread-") &&
    activeThreadId !== null &&
    getPersistedSessionPath(nextSessionPath) !== null &&
    (messageCount === null || messageCount <= 1)
  );
}

type AppShellLayoutProps = {
  controller: AppShellController;
};

export function AppShellLayout({ controller }: AppShellLayoutProps) {
  const controllerRef = useRef(controller);
  const resizeSettledTimerRef = useRef<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const projectFilesDocked = useProjectFilesDockedMode();
  const [projectFilesOpen, setProjectFilesOpen] = useState(true);
  const [projectFilesOverlayOpen, setProjectFilesOverlayOpen] = useState(false);
  const [diffBaselineState, setDiffBaselineState] = useState<{
    projectId: string;
    threadId: string | null;
    sessionPath: string | null;
    baseline: ProjectDiffBaseline;
    source: "init" | "override" | "default";
  }>({
    projectId: "",
    threadId: null,
    sessionPath: null,
    baseline: defaultDiffBaseline,
    source: "init",
  });
  const [diffRenderModeState, setDiffRenderModeState] = useState<{
    projectId: string;
    threadId: string | null;
    sessionPath: string | null;
    renderMode: ProjectDiffRenderMode;
    source: "init" | "override" | "default";
  }>({
    projectId: "",
    threadId: null,
    sessionPath: null,
    renderMode: "stacked",
    source: "init",
  });

  useEffect(() => {
    startAutomaticWindowsSandboxSetupIfNeeded();
  }, []);

  useEffect(() => {
    if (projectFilesDocked) {
      setProjectFilesOverlayOpen(false);
    }
  }, [projectFilesDocked]);

  useEffect(() => {
    const clearResizeState = () => {
      resizeSettledTimerRef.current = null;
      document.body.removeAttribute("data-app-resizing");
    };

    const handleResize = () => {
      document.body.setAttribute("data-app-resizing", "true");
      if (resizeSettledTimerRef.current !== null) {
        window.clearTimeout(resizeSettledTimerRef.current);
      }
      resizeSettledTimerRef.current = window.setTimeout(clearResizeState, 140);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeSettledTimerRef.current !== null) {
        window.clearTimeout(resizeSettledTimerRef.current);
      }
      document.body.removeAttribute("data-app-resizing");
    };
  }, []);

  const {
    activeComposerState,
    activeThreadData,
    collapsedProjectIds,
    composerProjectId,
    currentProjectName,
    handleAction,
    handleProjectReorder,
    handleProjectSelect,
    handleShowView,
    handleThreadOpen,
    handleToggleProjectCollapse,
    handleToggleSettings,
    projects,
    extensionsProjectScopeActive,
    skillsProjectScopeActive,
    state,
  } = controller;
  const projectScopeLockActive = extensionsProjectScopeActive || skillsProjectScopeActive;
  const effectiveCollapsedProjectIds = projectScopeLockActive
    ? Object.fromEntries(projects.map((project) => [project.id, true]))
    : collapsedProjectIds;

  const terminalSessionPath =
    state.activeView === "chat" || state.activeView === "thread" || state.activeView === "gitops"
      ? state.selectedSessionPath
      : null;
  const activeThreadId =
    state.activeView === "chat" || state.activeView === "thread" || state.activeView === "gitops"
      ? state.selectedThreadId
      : null;
  const takeoverVisible = state.takeoverVisible;
  const terminalDrawerVisible = state.activeView === "thread" && state.terminalVisible;
  const terminalDrawerPresent = useAnimatedPresence(terminalDrawerVisible);
  const diffBaseline =
    diffBaselineState.projectId === composerProjectId &&
    diffBaselineState.threadId === activeThreadId &&
    diffBaselineState.sessionPath === terminalSessionPath
      ? diffBaselineState.baseline
      : (controller.activeThreadData?.diffPreferences?.baseline ??
        controller.shellState?.appSettings.gitDiffBaselineDefault ??
        defaultDiffBaseline);
  const diffRenderMode =
    diffRenderModeState.projectId === composerProjectId &&
    diffRenderModeState.threadId === activeThreadId &&
    diffRenderModeState.sessionPath === terminalSessionPath
      ? diffRenderModeState.renderMode
      : (controller.activeThreadData?.diffPreferences?.renderMode ??
        controller.shellState?.appSettings.gitDiffRenderModeDefault ??
        "stacked");
  const { mainSectionRef, takeoverPresent, workspaceContentClass } = useAppShellLayoutState({
    takeoverVisible,
  });
  const projectFilesPanelLabels = getProjectFilesPanelLabels(composerProjectId);
  const attachedFilePaths = useMemo(
    () => getAttachedFilePathsFromMessages(activeThreadData?.messages ?? []),
    [activeThreadData?.messages],
  );
  const projectFilesAvailable =
    state.activeView !== "chat" && state.activeView !== "claw" && state.activeView !== "work";
  const effectiveProjectFilesOpen = projectFilesDocked ? projectFilesOpen : projectFilesOverlayOpen;
  const handleToggleProjectFiles = useCallback(() => {
    if (projectFilesDocked) {
      setProjectFilesOpen((open) => !open);
      return;
    }
    setProjectFilesOverlayOpen((open) => !open);
  }, [projectFilesDocked]);
  const handleCloseProjectFiles = useCallback(() => {
    if (projectFilesDocked) {
      setProjectFilesOpen(false);
      return;
    }
    setProjectFilesOverlayOpen(false);
  }, [projectFilesDocked]);
  const takeoverTerminalKeyRef = useRef<TakeoverTerminalKeyState | null>(null);
  const nextTakeoverTerminalKey = `${composerProjectId}:${
    state.selectedThreadId ?? terminalSessionPath ?? "none"
  }`;
  const nextTakeoverTerminalKeyState: TakeoverTerminalKeyState = {
    key: nextTakeoverTerminalKey,
    projectId: composerProjectId,
    threadId: state.selectedThreadId,
    sessionPath: terminalSessionPath,
  };

  if (takeoverVisible && takeoverTerminalKeyRef.current === null) {
    takeoverTerminalKeyRef.current = nextTakeoverTerminalKeyState;
  } else if (
    takeoverVisible &&
    takeoverTerminalKeyRef.current !== null &&
    takeoverTerminalKeyRef.current.key !== nextTakeoverTerminalKey &&
    !isLocalToPersistedTakeoverTransition(
      takeoverTerminalKeyRef.current,
      composerProjectId,
      state.selectedThreadId,
      terminalSessionPath,
    )
  ) {
    takeoverTerminalKeyRef.current = nextTakeoverTerminalKeyState;
  } else if (!takeoverVisible && !takeoverPresent) {
    takeoverTerminalKeyRef.current = null;
  }

  const takeoverTerminalKey = takeoverTerminalKeyRef.current?.key ?? nextTakeoverTerminalKey;
  controllerRef.current = controller;

  useEffect(() => {
    setDiffBaselineState((current) => {
      const nextBaseline =
        controller.activeThreadData?.diffPreferences?.baseline ??
        controller.shellState?.appSettings.gitDiffBaselineDefault ??
        defaultDiffBaseline;
      if (
        current.projectId === composerProjectId &&
        current.source === "override" &&
        isSameDraftPromotion({
          activeThreadId,
          messageCount: controller.activeThreadData?.messages.length ?? null,
          previousSessionPath: current.sessionPath,
          previousThreadId: current.threadId,
          nextSessionPath: terminalSessionPath,
        })
      ) {
        const appDefault = controllerRef.current.shellState?.appSettings.gitDiffBaselineDefault;
        const nextBaseline =
          appDefault && areDiffBaselinesEqual(current.baseline, appDefault)
            ? null
            : current.baseline;
        void controllerRef.current.handleAction("workspace.diff-preferences", {
          diffBaseline: nextBaseline,
        });
        return {
          ...current,
          threadId: activeThreadId,
          sessionPath: terminalSessionPath,
        };
      }

      if (
        current.projectId === composerProjectId &&
        current.threadId === activeThreadId &&
        current.sessionPath === terminalSessionPath &&
        (current.source === "override" || areDiffBaselinesEqual(current.baseline, nextBaseline))
      ) {
        return current;
      }

      return {
        projectId: composerProjectId,
        threadId: activeThreadId,
        sessionPath: terminalSessionPath,
        baseline: nextBaseline,
        source: "init",
      };
    });
  }, [
    activeThreadId,
    composerProjectId,
    controller.activeThreadData,
    controller.shellState,
    terminalSessionPath,
  ]);

  useEffect(() => {
    setDiffRenderModeState((current) => {
      const nextRenderMode =
        controller.activeThreadData?.diffPreferences?.renderMode ??
        controller.shellState?.appSettings.gitDiffRenderModeDefault ??
        "stacked";
      if (
        current.projectId === composerProjectId &&
        current.source === "override" &&
        isSameDraftPromotion({
          activeThreadId,
          messageCount: controller.activeThreadData?.messages.length ?? null,
          previousSessionPath: current.sessionPath,
          previousThreadId: current.threadId,
          nextSessionPath: terminalSessionPath,
        })
      ) {
        const appDefault = controllerRef.current.shellState?.appSettings.gitDiffRenderModeDefault;
        const nextRenderMode = appDefault === current.renderMode ? null : current.renderMode;
        void controllerRef.current.handleAction("workspace.diff-preferences", {
          diffRenderMode: nextRenderMode,
        });
        return {
          ...current,
          threadId: activeThreadId,
          sessionPath: terminalSessionPath,
        };
      }

      if (
        current.projectId === composerProjectId &&
        current.threadId === activeThreadId &&
        current.sessionPath === terminalSessionPath &&
        (current.source === "override" || current.renderMode === nextRenderMode)
      ) {
        return current;
      }

      return {
        projectId: composerProjectId,
        threadId: activeThreadId,
        sessionPath: terminalSessionPath,
        renderMode: nextRenderMode,
        source: "init",
      };
    });
  }, [
    activeThreadId,
    composerProjectId,
    controller.activeThreadData,
    controller.shellState,
    terminalSessionPath,
  ]);

  const handleSetDiffBaseline = useCallback(
    (baseline: ProjectDiffBaseline) => {
      const appDefault = controllerRef.current.shellState?.appSettings.gitDiffBaselineDefault;
      const nextBaseline =
        appDefault && areDiffBaselinesEqual(baseline, appDefault) ? null : baseline;
      setDiffBaselineState({
        projectId: composerProjectId,
        threadId: activeThreadId,
        sessionPath: terminalSessionPath,
        baseline,
        source: nextBaseline ? "override" : "default",
      });
      void controllerRef.current.handleAction("workspace.diff-preferences", {
        diffBaseline: nextBaseline,
      });
    },
    [activeThreadId, composerProjectId, terminalSessionPath],
  );

  const handleSetDiffRenderMode = useCallback(
    (renderMode: ProjectDiffRenderMode) => {
      const appDefault = controllerRef.current.shellState?.appSettings.gitDiffRenderModeDefault;
      const nextRenderMode = appDefault === renderMode ? null : renderMode;
      setDiffRenderModeState({
        projectId: composerProjectId,
        threadId: activeThreadId,
        sessionPath: terminalSessionPath,
        renderMode,
        source: nextRenderMode ? "override" : "default",
      });
      void controllerRef.current.handleAction("workspace.diff-preferences", {
        diffRenderMode: nextRenderMode,
      });
    },
    [activeThreadId, composerProjectId, terminalSessionPath],
  );

  const handleOpenGitOpsFromTakeover = useCallback(async () => {
    controllerRef.current.handleOpenGitOpsView();
    await controllerRef.current.handleCloseTakeoverTerminal({
      preserveSessionOverride: true,
      refreshThread: false,
    });
  }, []);

  return (
    <>
      <div className={appShellRootClass}>
        <AppTitleBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        />
        <div className="app-shell-chrome flex min-h-0 flex-1 overflow-hidden bg-[color:var(--sidebar)]">
          <ShellSideDock side="left" collapsed={sidebarCollapsed} width={305}>
            <Sidebar
              projects={projects}
              inboxThreads={controller.inboxThreads}
              appLaunchedAtMs={controller.appLaunchedAtMs}
              appSettings={
                controller.shellState?.appSettings ?? {
                  chatModel: null,
                  chatThinkingLevel: null,
                  codeModel: null,
                  codeThinkingLevel: null,
                  gitCommitMessageModel: null,
                  gitCommitMessageThinkingLevel: "off",
                  skillCreatorModel: null,
                  skillCreatorThinkingLevel: "off",
                  composerStreamingBehavior: "followUp",
                  dictationModelId: null,
                  dictationMaxDurationSeconds: 180,
                  showDictationButton: true,
                  favoriteFolders: [],
                  projectImportState: null,
                  preferredProjectLocation: null,
                  initializeGitOnProjectCreate: false,
                  gitOpsDefaultMode: "commit",
                  gitDiffBaselineDefault: { kind: "head" },
                  gitDiffRenderModeDefault: "stacked",
                  gitDiffFileTreeDefaultVisible: true,
                  projectDeletionMode: "pi-only",
                  useAgentsSkillsPaths: false,
                  piTuiTakeover: false,
                }
              }
              chatSidebarState={controller.chatSidebarState}
              activeView={state.activeView}
              protectedProjectId={
                controller.shellState?.resolvedCwd ?? controller.shellState?.cwd ?? null
              }
              selectedInboxSessionPath={state.selectedInboxSessionPath}
              selectedThreadId={state.selectedThreadId}
              selectedChatGroupId={controller.selectedChatGroupId}
              settingsOpen={state.settingsOpen}
              projectScopeLockActive={projectScopeLockActive}
              terminalRunningProjectIds={controller.terminalRunningProjectIds}
              terminalRunningSessionPaths={controller.terminalRunningSessionPaths}
              collapsedProjectIds={effectiveCollapsedProjectIds}
              onAction={handleAction}
              onShowView={handleShowView}
              onToggleSettings={handleToggleSettings}
              onOpenExtensionsView={() => {
                handleShowView("extensions");
              }}
              onOpenSkillsView={() => {
                handleShowView("skills");
              }}
              onOpenSettingsPanel={() => {
                handleShowView("settings");
              }}
              onOpenArchivedThreads={() => {
                handleShowView("archived");
              }}
              onDismissInboxThread={controller.handleDismissInboxThread}
              onCreateChatGroup={controller.handleCreateChatGroup}
              onSelectChatGroup={controller.handleSelectChatGroup}
              onNewChat={(groupId) => {
                controller.handleSelectChatGroup(groupId);
                controller.handleStartChatModeChat(groupId);
              }}
              onStartUnassignedChat={controller.handleStartUnassignedChat}
              onStartProjectChat={controller.handleStartProjectChat}
              onRefreshChatSidebar={controller.refreshChatSidebarState}
              onProjectSelect={handleProjectSelect}
              onProjectReorder={handleProjectReorder}
              onLoadProjectThreads={controller.handleLoadProjectThreads}
              onSelectInboxThread={controller.handleSelectInboxThread}
              onThreadOpen={handleThreadOpen}
              onToggleProjectCollapse={handleToggleProjectCollapse}
            />
          </ShellSideDock>

          <section
            ref={mainSectionRef}
            className={cn(
              "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl border-l border-[color:var(--border)] bg-[color:var(--workspace)] transition-[border-color,border-radius] duration-200 ease-out",
              projectFilesOpen &&
                projectFilesAvailable &&
                "rounded-tr-xl border-r border-[color:var(--border)]",
            )}
          >
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                data-open={!takeoverVisible ? "true" : "false"}
                className="motion-desktop-workspace flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <AppShellWorkspace
                  controller={controller}
                  activeComposerState={activeComposerState}
                  activeThreadData={activeThreadData}
                  composerProjectId={composerProjectId}
                  currentProjectName={currentProjectName}
                  diffBaseline={diffBaseline}
                  diffRenderMode={diffRenderMode}
                  terminalDrawerVisible={terminalDrawerVisible}
                  terminalSessionPath={terminalSessionPath}
                  workspaceContentClass={workspaceContentClass}
                  onSetDiffBaseline={handleSetDiffBaseline}
                  onSetDiffRenderMode={handleSetDiffRenderMode}
                  sidebarCollapsed={sidebarCollapsed}
                  projectFilesOpen={effectiveProjectFilesOpen}
                  projectFilesDocked={projectFilesDocked}
                  onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
                  onToggleProjectFiles={handleToggleProjectFiles}
                  onCloseProjectFiles={handleCloseProjectFiles}
                />
              </div>

              <AppShellOverlays
                controller={controller}
                composerProjectId={composerProjectId}
                diffBaseline={diffBaseline}
                takeoverPresent={takeoverPresent}
                takeoverVisible={takeoverVisible}
                takeoverTerminalKey={takeoverTerminalKey}
                terminalDrawerVisible={terminalDrawerVisible}
                terminalSessionPath={terminalSessionPath}
                workspaceContentClass={workspaceContentClass}
                onOpenGitOps={handleOpenGitOpsFromTakeover}
                onSetDiffBaseline={handleSetDiffBaseline}
              />

              <TextSelectionContextMenu />

              {terminalDrawerPresent ? (
                <div
                  className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 max-w-full overflow-hidden"
                  style={{ width: TERMINAL_DRAWER_WIDTH }}
                >
                  <div
                    data-open={terminalDrawerVisible ? "true" : "false"}
                    className={`motion-terminal-drawer absolute inset-0 min-h-0 min-w-0 ${terminalDrawerVisible ? "pointer-events-auto" : "pointer-events-none"}`}
                  >
                    <TerminalPanel
                      projectId={composerProjectId}
                      sessionPath={terminalSessionPath}
                      onClose={controller.handleCloseTerminalDrawer}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <ShellSideDock
            side="right"
            collapsed={!projectFilesOpen || !projectFilesAvailable}
            width={PROJECT_FILES_DOCK_WIDTH}
            className="bg-[color:var(--sidebar-solid)]"
            contentClassName="w-[400px]"
            keepMounted
          >
            <ProjectFileBrowserPanel
              docked
              open={projectFilesOpen && projectFilesAvailable}
              projectId={composerProjectId}
              title={projectFilesPanelLabels.title}
              subtitle={projectFilesPanelLabels.subtitle}
              closeLabel={projectFilesPanelLabels.closeLabel}
              attachedFilePaths={attachedFilePaths}
              onClose={() => setProjectFilesOpen(false)}
            />
          </ShellSideDock>
        </div>
      </div>
      <GlobalToasts toasts={controller.toasts} onDismiss={controller.dismissToast} />
    </>
  );
}
