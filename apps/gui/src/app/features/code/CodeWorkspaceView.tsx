import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FolderGit2, PanelRightOpen } from "lucide-react";
import type { AppShellController } from "../../app-shell/useAppShellController";
import { defaultPiSettings } from "../../../../shared/default-pi-settings";
import { parseComposerAttachmentBlock } from "../../../../shared/composer-attachment-prompt";
import { isUnassignedChatProjectId } from "../../../../shared/unassigned-chats";
import { Composer } from "../../components/workspace/Composer";
import { DiffPanel } from "../../components/workspace/DiffPanel";
import { GitOpsComposerPanel } from "../../components/workspace/GitOpsComposerPanel";
import { QueuedPromptsCard } from "../../components/workspace/composer/QueuedPromptsCard";
import { Tooltip } from "../../components/common/Tooltip";
import { ProjectFileBrowserPanel } from "../../components/workspace/project-files/ProjectFileBrowserPanel";
import type { ProjectDiffBaseline, ProjectDiffRenderMode } from "../../desktop/types";
import type { Message } from "../../types";
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence";
import { useDesktopDiff } from "../../hooks/useDesktopDiff";
import { compactIconButtonClass, mainPanelClass } from "../../ui/classes";
import { cn } from "../../utils/cn";
import { CodeWorkspaceMainView } from "./CodeWorkspaceMainView";
import { useDiffCommentController } from "./useDiffCommentController";
import { useQueuedPromptRestore } from "./useQueuedPromptRestore";
import { useWorkspaceFooterHeight } from "./useWorkspaceFooterHeight";

type CodeWorkspaceViewProps = {
  controller: AppShellController;
  activeComposerState: AppShellController["activeComposerState"];
  activeThreadData: AppShellController["activeThreadData"];
  composerProjectId: string;
  currentProjectName: string;
  diffBaseline: ProjectDiffBaseline;
  diffRenderMode: ProjectDiffRenderMode;
  terminalDrawerVisible: boolean;
  terminalSessionPath: string | null;
  workspaceContentClass: string;
  onSetDiffBaseline: (baseline: ProjectDiffBaseline) => void;
  onSetDiffRenderMode: (renderMode: ProjectDiffRenderMode) => void;
  sidebarCollapsed: boolean;
  projectFilesOpen: boolean;
  projectFilesDocked: boolean;
  onToggleSidebar: () => void;
  onToggleProjectFiles: () => void;
  onCloseProjectFiles: () => void;
};

const TERMINAL_DRAWER_OFFSET = "min(28rem, calc(100% - 2.5rem))";
const projectFilesExpandButtonClass =
  "pointer-events-auto h-6 w-6 shrink-0 rounded-full bg-[rgba(146,153,184,0.22)] hover:bg-[rgba(146,153,184,0.32)]";

function getReplyActivityKey(messages: readonly Message[]) {
  return messages
    .filter((message) => message.role !== "user")
    .map((message) => message.id)
    .join("|");
}

export function CodeWorkspaceView({
  controller,
  activeComposerState,
  activeThreadData,
  composerProjectId,
  currentProjectName,
  diffBaseline,
  diffRenderMode,
  terminalDrawerVisible,
  terminalSessionPath,
  workspaceContentClass,
  onSetDiffBaseline,
  onSetDiffRenderMode,
  projectFilesOpen,
  projectFilesDocked,
  onToggleProjectFiles,
  onCloseProjectFiles,
}: CodeWorkspaceViewProps) {
  const [composerPromptResetKey, setComposerPromptResetKey] = useState(0);
  const [gitOpsFileTreeVisibilityByThread, setGitOpsFileTreeVisibilityByThread] = useState<
    Record<string, boolean>
  >({});
  const [composerLayoutVersion, setComposerLayoutVersion] = useState(0);
  const projectFilesOverlayPresent = useAnimatedPresence(!projectFilesDocked && projectFilesOpen);
  const footerRef = useRef<HTMLElement>(null);
  const mainViewRef = useRef<HTMLElement>(null);
  const {
    handleAction,
    handleLoadEarlierMessages,
    handleCloseGitOpsView,
    handleOpenGitOpsView,
    handleOpenWorktreeDiffFile,
    handleShowTakeoverTerminal,
    handleToggleTerminal,
    listComposerAttachmentEntries,
    projectGitState,
    shellState,
    state,
  } = controller;
  const showPromptComposer = state.activeView === "thread" || state.activeView === "code";
  const showWorkspaceFooter = showPromptComposer || state.activeView === "gitops";
  const showThreadFooter = state.activeView === "thread";
  const showDiffInMainView = state.activeView === "gitops";
  const showDesktopTerminalDrawer = state.activeView === "thread" && terminalDrawerVisible;
  const gitOpsFileTreeStateKey = `${composerProjectId}:${terminalSessionPath ?? "project"}`;
  const gitOpsFileTreeVisible =
    gitOpsFileTreeVisibilityByThread[gitOpsFileTreeStateKey] ??
    shellState?.appSettings.gitDiffFileTreeDefaultVisible ??
    true;
  const toggleGitOpsFileTree = () => {
    setGitOpsFileTreeVisibilityByThread((current) => ({
      ...current,
      [gitOpsFileTreeStateKey]: !(current[gitOpsFileTreeStateKey] ?? gitOpsFileTreeVisible),
    }));
  };
  const { error: diffLoadError } = useDesktopDiff(
    composerProjectId,
    diffBaseline,
    showDiffInMainView && (projectGitState?.isGitRepo ?? false),
  );
  const footerHeight = useWorkspaceFooterHeight({
    footerRef,
    visible: showWorkspaceFooter,
  });
  const hasThreadConversation = showThreadFooter && (activeThreadData?.messages.length ?? 0) > 0;
  const showLandingComposer = state.activeView === "code" || (showThreadFooter && !hasThreadConversation);
  const [threadContentVisible, setThreadContentVisible] = useState(hasThreadConversation);
  const previousHasThreadConversationRef = useRef(hasThreadConversation);
  const centerThreadFooter = showPromptComposer && !hasThreadConversation;
  const footerInset = showWorkspaceFooter && !centerThreadFooter ? footerHeight : 0;

  useEffect(() => {
    if (!projectFilesOpen || projectFilesDocked) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseProjectFiles();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCloseProjectFiles, projectFilesDocked, projectFilesOpen]);

  useEffect(() => {
    if (!hasThreadConversation) {
      previousHasThreadConversationRef.current = false;
      setThreadContentVisible(false);
      return;
    }

    if (previousHasThreadConversationRef.current) {
      setThreadContentVisible(true);
      return;
    }

    previousHasThreadConversationRef.current = true;
    const timeout = window.setTimeout(() => setThreadContentVisible(true), 300);
    return () => window.clearTimeout(timeout);
  }, [hasThreadConversation]);
  const {
    diffCommentCount,
    diffCommentError,
    diffComments,
    diffCommentsSending,
    handleSelectDiffComment,
    handleSendDiffComments,
    selectedDiffCommentId,
    selectedDiffCommentJumpKey,
  } = useDiffCommentController({
    composerProjectId,
    handleAction,
    handleOpenWorktreeDiffFile,
    setComposerPromptResetKey,
    shellState,
  });
  const {
    handleEditQueuedPrompt,
    handleRemoveQueuedPrompt,
    markRestoredQueuedPromptApplied,
    pendingQueuedPromptIdsForSession,
    scopedRestoredQueuedPrompt,
  } = useQueuedPromptRestore({
    composerProjectId,
    handleAction,
    terminalSessionPath,
  });

  const terminalRightInsetStyle = showDesktopTerminalDrawer
    ? ({ right: TERMINAL_DRAWER_OFFSET } as CSSProperties)
    : undefined;
  const projectFilesExpandButtonStyle = {
    right: showDesktopTerminalDrawer ? `calc(${TERMINAL_DRAWER_OFFSET} + 0.5rem)` : "0.5rem",
  } as CSSProperties;
  const threadFooterStyle = showPromptComposer
    ? {
        ...terminalRightInsetStyle,
        top: centerThreadFooter ? "50%" : `calc(100% - ${footerHeight}px)`,
      }
    : terminalRightInsetStyle;
  const visibleThreadData =
    state.activeView === "thread" && activeThreadData && !threadContentVisible
      ? { ...activeThreadData, messages: [] }
      : activeThreadData;
  const projectFilesPanelTitle = isUnassignedChatProjectId(composerProjectId)
    ? "Archivos del chat"
    : "Archivos del proyecto";
  const showProjectFilesExpandButton =
    !projectFilesOpen && (state.activeView === "code" || state.activeView === "thread");
  const attachedFilePaths = useMemo(
    () =>
      new Set(
        (activeThreadData?.messages ?? [])
          .flatMap((message) => {
            if (message.role !== "user") {
              return [];
            }

            return message.content.flatMap(
              (paragraph: string) => parseComposerAttachmentBlock(paragraph).attachmentPaths,
            );
          }),
      ),
    [activeThreadData?.messages],
  );

  return (
    <div className="relative isolate min-h-0 flex-1 overflow-hidden">
      <div
        className="motion-terminal-drawer-offset absolute inset-x-0 top-0 z-10 overflow-hidden px-5"
        style={{ ...terminalRightInsetStyle, bottom: `${footerInset}px` }}
      >
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 overflow-hidden">
          <main
            ref={mainViewRef}
            className={
              state.activeView === "thread" || showDiffInMainView
                ? "min-h-0 overflow-hidden pt-1.5"
                : mainPanelClass
            }
          >
            {showDiffInMainView ? (
              <DiffPanel
                projectId={composerProjectId}
                isGitRepo={projectGitState?.isGitRepo ?? false}
                baseline={diffBaseline}
                selectedFilePath={state.selectedDiffFilePath}
                selectedCommentId={selectedDiffCommentId}
                selectedCommentJumpKey={selectedDiffCommentJumpKey}
                diffRenderMode={diffRenderMode}
                layoutMode="main"
                showFileTree={gitOpsFileTreeVisible}
              />
            ) : (
              <CodeWorkspaceMainView
                activeView={state.activeView}
                appSettings={
                  shellState?.appSettings ?? {
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
                piSettings={shellState?.piSettings ?? defaultPiSettings}
                archivedThreads={controller.archivedThreads}
                availableModels={activeComposerState?.availableModels ?? []}
                availableThinkingLevels={activeComposerState?.availableThinkingLevels ?? ["off"]}
                contextUsage={activeComposerState?.contextUsage ?? null}
                currentModel={activeComposerState?.currentModel ?? null}
                currentThinkingLevel={activeComposerState?.currentThinkingLevel ?? "off"}
                isCompacting={activeComposerState?.isCompacting ?? false}
                currentProjectName={currentProjectName}
                selectedInboxThread={controller.selectedInboxThread}
                projects={controller.projects}
                selectedProjectId={controller.state.selectedProjectId}
                workspaceContentClass={workspaceContentClass}
                threadData={visibleThreadData}
                composerLayoutVersion={composerLayoutVersion}
                onAction={handleAction}
                onDismissInboxThread={controller.handleDismissInboxThread}
                onListAttachmentEntries={listComposerAttachmentEntries}
                onOpenThread={controller.handleThreadOpen}
                onOpenSettingsView={() => controller.handleShowView("settings")}
                onCloseUtilityView={controller.handleCloseUtilityView}
                onLoadEarlierMessages={handleLoadEarlierMessages}
                onSetExtensionsProjectScopeActive={controller.handleSetExtensionsProjectScopeActive}
                onSetSkillsProjectScopeActive={controller.handleSetSkillsProjectScopeActive}
                onSelectProject={controller.handleProjectSelect}
              />
            )}
          </main>
        </div>
      </div>

      {showProjectFilesExpandButton ? (
        <div
          className="pointer-events-none absolute top-4 z-20 flex w-7 items-center justify-center"
          style={projectFilesExpandButtonStyle}
        >
          <Tooltip
            content="Abrir archivos del proyecto"
            placement="top"
            className="pointer-events-auto"
          >
            <button
              type="button"
              className={cn(compactIconButtonClass, projectFilesExpandButtonClass)}
              onClick={onToggleProjectFiles}
              aria-label="Abrir archivos del proyecto"
            >
              <PanelRightOpen size={13} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
      ) : null}

      {!projectFilesDocked && projectFilesOverlayPresent ? (
        <div
          data-open={projectFilesOpen ? "true" : "false"}
          className={cn(
            "absolute inset-0 z-30 transition-opacity duration-200 ease-out",
            projectFilesOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default border-0 bg-[rgba(7,9,16,0.38)] p-0 backdrop-blur-[3px] transition-opacity duration-200 ease-out"
            aria-label="Cerrar archivos del proyecto"
            onClick={onCloseProjectFiles}
          />
          <div
            className={cn(
              "absolute top-0 right-0 bottom-0 w-[min(22rem,calc(100%-2rem))] overflow-hidden transition-[transform,opacity] duration-200 ease-out",
              projectFilesOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
            )}
          >
            <ProjectFileBrowserPanel
              docked={false}
              open={projectFilesOpen}
              projectId={composerProjectId}
              title={projectFilesPanelTitle}
              attachedFilePaths={attachedFilePaths}
              onClose={onCloseProjectFiles}
            />
          </div>
        </div>
      ) : null}

      {showWorkspaceFooter ? (
        <footer
          ref={footerRef}
          className={cn(
            "motion-terminal-drawer-offset pointer-events-none absolute inset-x-0 z-10 px-5 pb-4",
            showPromptComposer ? "transition-[top,transform] duration-300 ease-out" : "bottom-0",
            centerThreadFooter && "-translate-y-1/2",
            showPromptComposer && !centerThreadFooter && "translate-y-0",
          )}
          style={threadFooterStyle}
        >
          <div className="pointer-events-auto grid gap-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(520px,800px)_minmax(0,1fr)] items-end gap-3">
              <div className="mb-1.5 min-w-0 self-end" />
              <div className="w-full max-w-[800px]">
                {state.activeView === "gitops" ? (
                  <div>
                    <GitOpsComposerPanel
                      dictationModelId={shellState?.appSettings.dictationModelId ?? null}
                      dictationMaxDurationSeconds={
                        shellState?.appSettings.dictationMaxDurationSeconds ?? 180
                      }
                      projectGitState={projectGitState}
                      projectId={composerProjectId}
                      sessionPath={terminalSessionPath}
                      showDictationButton={shellState?.appSettings.showDictationButton ?? true}
                      appSettings={
                        shellState?.appSettings ?? {
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
                      diffBaseline={diffBaseline}
                      diffRenderMode={diffRenderMode}
                      diffComments={diffComments}
                      diffCommentCount={diffCommentCount}
                      diffCommentsSending={diffCommentsSending}
                      diffCommentError={diffCommentError}
                      diffLoadError={diffLoadError}
                      onSetDiffBaseline={onSetDiffBaseline}
                      onSetDiffRenderMode={onSetDiffRenderMode}
                      onSendDiffComments={(message) => {
                        void handleSendDiffComments(message);
                      }}
                      onSelectDiffComment={handleSelectDiffComment}
                      onLayoutChange={() => setComposerLayoutVersion((current) => current + 1)}
                      onAction={handleAction}
                      onBack={handleCloseGitOpsView}
                      onOpenSettingsView={() => controller.handleShowView("settings")}
                    />
                  </div>
                ) : (
                  <div className="grid gap-0">
                    {showLandingComposer ? (
                      <div className="landing-new-chat-title mb-3 text-center text-[clamp(22px,3vw,32px)] font-medium tracking-[-0.025em] text-[color:var(--text)]">
                        Nuevo chat
                      </div>
                    ) : null}
                    <QueuedPromptsCard
                      prompts={activeComposerState?.queuedPrompts ?? []}
                      pendingPromptIds={pendingQueuedPromptIdsForSession}
                      onEditPrompt={(prompt) => {
                        void handleEditQueuedPrompt(prompt);
                      }}
                      onRemovePrompt={(prompt) => {
                        void handleRemoveQueuedPrompt(prompt);
                      }}
                    />
                    <div>
                      <Composer
                        activeView={state.activeView}
                        model={activeComposerState?.currentModel ?? null}
                        contextUsage={activeComposerState?.contextUsage ?? null}
                        availableModels={activeComposerState?.availableModels ?? []}
                        isStreaming={activeThreadData?.isStreaming ?? false}
                        replyActivityKey={getReplyActivityKey(activeThreadData?.messages ?? [])}
                        isCompacting={activeComposerState?.isCompacting ?? false}
                        isExtensionCommandRunning={
                          activeComposerState?.isExtensionCommandRunning ?? false
                        }
                        thinkingLevel={activeComposerState?.currentThinkingLevel ?? "off"}
                        restoredQueuedPrompt={scopedRestoredQueuedPrompt}
                        streamingBehaviorPreference={
                          shellState?.appSettings.composerStreamingBehavior ?? "followUp"
                        }
                        availableThinkingLevels={
                          activeComposerState?.availableThinkingLevels ?? ["off"]
                        }
                        projectId={composerProjectId}
                        composerFocusRequest={controller.composerFocusRequest}
                        onComposerFocusRequestHandled={controller.handleComposerFocusRequestHandled}
                        projectGitState={projectGitState}
                        diffBaseline={diffBaseline}
                        sessionPath={terminalSessionPath}
                        dictationModelId={shellState?.appSettings.dictationModelId ?? null}
                        dictationMaxDurationSeconds={
                          shellState?.appSettings.dictationMaxDurationSeconds ?? 180
                        }
                        favoriteFolders={shellState?.appSettings.favoriteFolders ?? []}
                        showDictationButton={shellState?.appSettings.showDictationButton ?? true}
                        diffRenderMode={diffRenderMode}
                        diffComments={diffComments}
                        diffCommentCount={diffCommentCount}
                        diffCommentsSending={diffCommentsSending}
                        diffCommentError={diffCommentError}
                        onSetDiffBaseline={onSetDiffBaseline}
                        onSetDiffRenderMode={onSetDiffRenderMode}
                        onSendDiffComments={(message) => {
                          void handleSendDiffComments(message);
                        }}
                        onSelectDiffComment={handleSelectDiffComment}
                        promptResetKey={composerPromptResetKey}
                        onLayoutChange={() => setComposerLayoutVersion((current) => current + 1)}
                        mainViewRef={mainViewRef}
                        workspaceFooterRef={footerRef}
                        onOpenTakeoverTerminal={handleShowTakeoverTerminal}
                        onOpenGitOpsView={handleOpenGitOpsView}
                        onOpenSettingsView={() => controller.handleShowView("settings")}
                        onRestoredQueuedPromptApplied={markRestoredQueuedPromptApplied}
                        onToggleTerminal={handleToggleTerminal}
                        terminalVisible={state.terminalVisible}
                        onListAttachmentEntries={listComposerAttachmentEntries}
                        onAction={handleAction}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "mb-1.5 min-w-0 self-end",
                  state.activeView === "gitops" ? "opacity-100" : "opacity-0 xl:opacity-100",
                )}
              >
                {state.activeView === "gitops" && !state.takeoverVisible ? (
                  <button
                    type="button"
                    className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--muted)] opacity-70 transition hover:bg-[rgba(169,178,215,0.1)] hover:text-[color:var(--text)] hover:opacity-100"
                    onClick={toggleGitOpsFileTree}
                    aria-label={
                      gitOpsFileTreeVisible
                        ? "Ocultar archivos modificados"
                        : "Mostrar archivos modificados"
                    }
                    data-tooltip={
                      gitOpsFileTreeVisible
                        ? "Ocultar archivos modificados"
                        : "Mostrar archivos modificados"
                    }
                  >
                    <FolderGit2 size={15} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
