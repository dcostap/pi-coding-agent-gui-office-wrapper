import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TitleBarCommandId, TitleBarMenuId } from "../../../shared/desktop-ipc";
import { getPersistedSessionPath, isLocalSessionPath } from "../../../shared/session-paths";
import { Tooltip } from "../components/common/Tooltip";
import { Sidebar } from "../components/sidebar/Sidebar";
import { TerminalPanel } from "../components/workspace/TerminalPanel";
import { defaultDiffBaseline } from "../components/workspace/composer/diff-baseline";
import type { ProjectDiffBaseline, ProjectDiffRenderMode } from "../desktop/types";
import { useAnimatedPresence } from "../hooks/useAnimatedPresence";
import { AppShellOverlays } from "./AppShellOverlays";
import { AppShellWorkspace } from "./AppShellWorkspace";
import { appShellRootClass } from "./layout-classes";
import { SmallWindowOverlay } from "./SmallWindowOverlay";
import type { AppShellController } from "./useAppShellController";
import { useAppShellLayoutState } from "./useAppShellLayoutState";

const TERMINAL_DRAWER_WIDTH = "min(28rem, calc(100% - 2.5rem))";

const titleBarMenuItems: Array<{ id: TitleBarMenuId; label: string }> = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

type TitleBarMenuEntry =
  | { type: "separator" }
  | { type?: "item"; label: string; commandId?: TitleBarCommandId; disabled?: boolean };

const titleBarMenuEntries: Record<TitleBarMenuId, TitleBarMenuEntry[]> = {
  file: [
    { label: "Close", commandId: "file.close" },
    { type: "separator" },
    { label: "Quit", commandId: "file.quit" },
  ],
  edit: [
    { label: "Undo", commandId: "edit.undo" },
    { label: "Redo", commandId: "edit.redo" },
    { type: "separator" },
    { label: "Cut", commandId: "edit.cut" },
    { label: "Copy", commandId: "edit.copy" },
    { label: "Paste", commandId: "edit.paste" },
    { type: "separator" },
    { label: "Select All", commandId: "edit.selectAll" },
  ],
  view: [
    { label: "Reload", commandId: "view.reload" },
    { label: "Force Reload", commandId: "view.forceReload" },
    { label: "Toggle DevTools", commandId: "view.toggleDevTools" },
    { type: "separator" },
    { label: "Reset Zoom", commandId: "view.resetZoom" },
    { label: "Zoom In", commandId: "view.zoomIn" },
    { label: "Zoom Out", commandId: "view.zoomOut" },
    { type: "separator" },
    { label: "Toggle Full Screen", commandId: "view.toggleFullscreen" },
  ],
  window: [
    { label: "Minimize", commandId: "window.minimize" },
    { label: "Close", commandId: "window.close" },
  ],
  help: [{ label: "OfficeAgent v0.1", disabled: true }],
};

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
  const [openMenuId, setOpenMenuId] = useState<TitleBarMenuId | null>(null);
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

  const runTitleBarCommand = (commandId: TitleBarCommandId | undefined) => {
    setOpenMenuId(null);
    if (commandId) {
      void window.piDesktop?.runTitleBarCommand?.(commandId);
    }
  };

  return (
    <header
      ref={titleBarRef}
      className="app-titlebar flex h-9 shrink-0 items-center bg-[color:var(--bg)] pr-[142px] pl-1.5"
    >
      <Tooltip content={sidebarToggleLabel} placement="right">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted)] transition-colors hover:bg-[rgba(255,255,255,0.075)] hover:text-[color:var(--text)]"
          onClick={onToggleSidebar}
          aria-label={sidebarToggleLabel}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </Tooltip>
      <nav className="ml-2 flex h-full items-center gap-0.5" aria-label="Application menu">
        {titleBarMenuItems.map((item) => {
          const isOpen = openMenuId === item.id;
          return (
            <div key={item.id} className="relative flex h-full items-center">
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[13px] font-medium text-[color:var(--muted)] transition-colors hover:bg-[rgba(255,255,255,0.075)] hover:text-[color:var(--text)] focus-visible:bg-[rgba(255,255,255,0.075)] focus-visible:text-[color:var(--text)] focus-visible:outline-none data-[open=true]:bg-[rgba(255,255,255,0.075)] data-[open=true]:text-[color:var(--text)]"
                data-open={isOpen ? "true" : "false"}
                onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                onPointerEnter={() => {
                  setOpenMenuId((current) => (current ? item.id : current));
                }}
                aria-haspopup="menu"
                aria-expanded={isOpen}
              >
                {item.label}
              </button>
              {isOpen ? (
                <div
                  className="app-titlebar-menu-popover absolute top-[calc(100%+2px)] left-0 z-50 min-w-44 rounded-lg border border-[rgba(255,255,255,0.09)] bg-[rgba(34,34,34,0.88)] p-1.5 text-[13px] text-[color:var(--text)] shadow-[0_16px_42px_rgba(0,0,0,0.38)] backdrop-blur-[22px]"
                  role="menu"
                  aria-label={item.label}
                >
                  {titleBarMenuEntries[item.id].map((entry, index) =>
                    entry.type === "separator" ? (
                      <div
                        key={`${item.id}-separator-${index}`}
                        className="my-1 h-px bg-[rgba(255,255,255,0.075)]"
                        role="separator"
                      />
                    ) : (
                      <button
                        key={entry.label}
                        type="button"
                        className="flex h-7 w-full items-center rounded-md px-2 text-left text-[color:var(--muted)] transition-colors hover:bg-[rgba(255,255,255,0.075)] hover:text-[color:var(--text)] disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent disabled:hover:text-[color:var(--muted)]"
                        disabled={entry.disabled}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runTitleBarCommand(entry.commandId)}
                        role="menuitem"
                      >
                        {entry.label}
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
        <div className="flex min-h-0 flex-1 overflow-hidden bg-[color:var(--bg)]">
          <div
            className="relative min-w-0 shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
            style={{ width: sidebarCollapsed ? 0 : 300, opacity: sidebarCollapsed ? 0 : 1 }}
          >
          {sidebarCollapsed ? null : (
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
              selectedProjectId={state.selectedProjectId}
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
                void handleAction("thread.new", { chatGroupId: groupId });
              }}
              onStartUnassignedChat={controller.handleStartUnassignedChat}
              onRefreshChatSidebar={controller.refreshChatSidebarState}
              onProjectSelect={handleProjectSelect}
              onProjectReorder={handleProjectReorder}
              onLoadProjectThreads={controller.handleLoadProjectThreads}
              onSelectInboxThread={controller.handleSelectInboxThread}
              onThreadOpen={handleThreadOpen}
              onToggleProjectCollapse={handleToggleProjectCollapse}
            />
          )}
        </div>

          <section
            ref={mainSectionRef}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl border-t border-l border-[color:var(--border)] bg-[color:var(--workspace)]"
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
                onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
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
        </div>
      </div>
      <SmallWindowOverlay />
      {controller.toast ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-2xl border border-[color:var(--border-strong)] bg-[rgba(14,18,28,0.94)] px-4 py-2 text-[13px] text-[color:var(--text)] shadow-[0_16px_40px_rgba(0,0,0,0.32)] backdrop-blur-sm">
          {controller.toast}
        </div>
      ) : null}
    </>
  );
}
