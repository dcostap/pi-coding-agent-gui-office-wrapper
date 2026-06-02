import { useEffect, useRef, useState } from "react";
import {
  getLocalDraftChatGroupId,
  getPersistedSessionPath,
} from "../../../../shared/session-paths";
import type { AppShellController } from "../../app-shell/useAppShellController";
import { WorkspacePromptComposerDock } from "../../components/workspace/WorkspacePromptComposerDock";
import { getReplyActivityKey } from "../../components/workspace/thread/getReplyActivityKey";
import { ThreadTimelineControlsProvider } from "../../components/workspace/thread/threadTimelineControls";
import { useThreadContentVisibility } from "../../components/workspace/thread/useThreadContentVisibility";
import type { ProjectDiffBaseline, ProjectDiffRenderMode } from "../../desktop/types";
import { cn } from "../../utils/cn";
import { useQueuedPromptRestore } from "../code/useQueuedPromptRestore";
import { useWorkspaceFooterHeight } from "../code/useWorkspaceFooterHeight";
import { ThreadView } from "../../views/ThreadView";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";

type ChatWorkspaceViewProps = {
  controller: AppShellController;
  activeComposerState: AppShellController["activeComposerState"];
  activeThreadData: AppShellController["activeThreadData"];
  composerProjectId: string;
  diffBaseline: ProjectDiffBaseline;
  diffRenderMode: ProjectDiffRenderMode;
  terminalSessionPath: string | null;
  onSetDiffBaseline: (baseline: ProjectDiffBaseline) => void;
  onSetDiffRenderMode: (renderMode: ProjectDiffRenderMode) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

const ARTIFACT_DRAWER_WIDTH = "min(760px, max(0px, calc(100% - 900px)))";

export function ChatWorkspaceView({
  controller,
  activeComposerState,
  activeThreadData,
  composerProjectId,
  diffBaseline,
  diffRenderMode,
  terminalSessionPath,
  onSetDiffBaseline,
  onSetDiffRenderMode,
}: ChatWorkspaceViewProps) {
  const [composerPromptResetKey] = useState(0);
  const [composerLayoutVersion, setComposerLayoutVersion] = useState(0);
  const [artifactsVisibleByConversation, setArtifactsVisibleByConversation] = useState<
    Record<string, boolean>
  >({});
  const [artifactsFullscreen, setArtifactsFullscreen] = useState(false);
  const footerRef = useRef<HTMLElement>(null);
  const mainViewRef = useRef<HTMLElement>(null);
  const {
    handleAction,
    handleLoadEarlierMessages,
    handleShowTakeoverTerminal,
    handleToggleTerminal,
    listComposerAttachmentEntries,
    shellState,
    state,
  } = controller;
  const footerHeight = useWorkspaceFooterHeight({ footerRef, visible: true });
  const conversationId = activeThreadData?.sessionPath ?? terminalSessionPath;
  const hasConversation = (activeThreadData?.messages.length ?? 0) > 0;
  const hasPersistedChatSession = getPersistedSessionPath(terminalSessionPath) !== null;
  const draftChatGroupId = getLocalDraftChatGroupId(terminalSessionPath);
  const artifactsVisible = conversationId
    ? (artifactsVisibleByConversation[conversationId] ?? false)
    : false;
  const artifactDrawerInsetStyle = artifactsVisible ? { right: ARTIFACT_DRAWER_WIDTH } : undefined;
  const conversationContentVisible = useThreadContentVisibility(hasConversation);
  const previousConversationIdRef = useRef<string | null | undefined>(conversationId);

  useEffect(() => {
    if (!window.piDesktop?.subscribe) return;
    if (!conversationId) return;
    return window.piDesktop.subscribe((event) => {
      if (event.type !== "artifact-update") return;
      if (event.conversationId !== conversationId) return;
      setArtifactsVisibleByConversation((current) => ({
        ...current,
        [conversationId]: true,
      }));
    });
  }, [conversationId]);

  if (previousConversationIdRef.current !== conversationId) {
    previousConversationIdRef.current = conversationId;
    if (artifactsFullscreen) setArtifactsFullscreen(false);
  }

  useEffect(() => {
    if (!artifactsVisible) setArtifactsFullscreen(false);
  }, [artifactsVisible]);
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

  return (
    <ThreadTimelineControlsProvider>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "absolute inset-0 min-h-0 overflow-hidden transition-[right] duration-200 ease-out",
            artifactsFullscreen && "hidden",
          )}
          style={!artifactsFullscreen ? artifactDrawerInsetStyle : undefined}
        >
          <div
            className="absolute inset-x-0 top-0 overflow-hidden px-5"
            style={{ bottom: hasConversation ? `${footerHeight}px` : "0px" }}
          >
            <main ref={mainViewRef} className="h-full min-h-0 overflow-hidden pt-1.5">
              <ThreadView
                key={activeThreadData?.sessionPath ?? "new-chat"}
                messages={conversationContentVisible ? (activeThreadData?.messages ?? []) : []}
                previousMessageCount={activeThreadData?.previousMessageCount ?? 0}
                isStreaming={activeThreadData?.isStreaming ?? false}
                isCompacting={activeThreadData?.isCompacting ?? false}
                composerLayoutVersion={composerLayoutVersion}
                onLoadEarlierMessages={handleLoadEarlierMessages}
              />
            </main>
          </div>

          <footer
            ref={footerRef}
            className={cn(
              "pointer-events-none absolute inset-x-0 z-10 px-5 pb-4",
              hasConversation
                ? "bottom-0 translate-y-0"
                : "top-1/2 -translate-y-1/2 transition-[top,transform] duration-300 ease-out",
            )}
          >
            <WorkspacePromptComposerDock
              leftRail={
                <div
                  className={cn(
                    "mb-1.5 min-w-0 self-end",
                    artifactsVisible && !artifactsFullscreen && "invisible",
                  )}
                />
              }
              prompts={activeComposerState?.queuedPrompts ?? []}
              pendingPromptIds={pendingQueuedPromptIdsForSession}
              showTimelineQuickActions={hasConversation}
              onEditPrompt={(prompt) => {
                void handleEditQueuedPrompt(prompt);
              }}
              onRemovePrompt={(prompt) => {
                void handleRemoveQueuedPrompt(prompt);
              }}
              composerProps={{
                activeView: state.activeView,
                model: activeComposerState?.currentModel ?? null,
                contextUsage: activeComposerState?.contextUsage ?? null,
                availableModels: activeComposerState?.availableModels ?? [],
                isStreaming: activeThreadData?.isStreaming ?? false,
                replyActivityKey: getReplyActivityKey(activeThreadData?.messages ?? []),
                isCompacting: activeComposerState?.isCompacting ?? false,
                isExtensionCommandRunning: activeComposerState?.isExtensionCommandRunning ?? false,
                thinkingLevel: activeComposerState?.currentThinkingLevel ?? "off",
                restoredQueuedPrompt: scopedRestoredQueuedPrompt,
                streamingBehaviorPreference:
                  shellState?.appSettings.composerStreamingBehavior ?? "followUp",
                availableThinkingLevels: activeComposerState?.availableThinkingLevels ?? ["off"],
                projectId: composerProjectId,
                composerFocusRequest: controller.composerFocusRequest,
                onComposerFocusRequestHandled: controller.handleComposerFocusRequestHandled,
                chatGroupId: hasPersistedChatSession
                  ? null
                  : (draftChatGroupId ?? controller.selectedChatGroupId),
                projectGitState: null,
                diffBaseline,
                sessionPath: terminalSessionPath,
                dictationModelId: shellState?.appSettings.dictationModelId ?? null,
                dictationMaxDurationSeconds:
                  shellState?.appSettings.dictationMaxDurationSeconds ?? 180,
                favoriteFolders: shellState?.appSettings.favoriteFolders ?? [],
                showDictationButton: shellState?.appSettings.showDictationButton ?? true,
                diffRenderMode,
                diffComments: [],
                diffCommentCount: 0,
                diffCommentsSending: false,
                diffCommentError: null,
                onSetDiffBaseline,
                onSetDiffRenderMode,
                onSendDiffComments: () => {},
                onSelectDiffComment: () => {},
                promptResetKey: composerPromptResetKey,
                onLayoutChange: () => setComposerLayoutVersion((current) => current + 1),
                mainViewRef,
                workspaceFooterRef: footerRef,
                onOpenTakeoverTerminal: handleShowTakeoverTerminal,
                onOpenGitOpsView: () => {},
                onOpenSettingsView: () => controller.handleShowView("settings"),
                onRestoredQueuedPromptApplied: markRestoredQueuedPromptApplied,
                onToggleTerminal: handleToggleTerminal,
                onToggleArtifacts:
                  hasConversation && conversationId
                    ? () =>
                        setArtifactsVisibleByConversation((current) => ({
                          ...current,
                          [conversationId]: !(current[conversationId] ?? false),
                        }))
                    : undefined,
                artifactsAvailable: hasConversation,
                showTerminalControls: false,
                artifactsVisible,
                terminalVisible: state.terminalVisible,
                onListAttachmentEntries: listComposerAttachmentEntries,
                onAction: handleAction,
              }}
            />
          </footer>
        </div>
        <div
          className={cn(
            "absolute top-0 right-0 bottom-0 min-h-0 overflow-hidden transition-[width] duration-200 ease-out",
            !artifactsVisible && "w-0",
            artifactsFullscreen && "left-0 w-auto",
          )}
          style={
            artifactsVisible && !artifactsFullscreen ? { width: ARTIFACT_DRAWER_WIDTH } : undefined
          }
        >
          <ArtifactPanel
            conversationId={conversationId}
            visible={artifactsVisible}
            fullscreen={artifactsFullscreen}
            onToggleFullscreen={() => setArtifactsFullscreen((fullscreen) => !fullscreen)}
            onClose={() => {
              if (conversationId) {
                setArtifactsVisibleByConversation((current) => ({
                  ...current,
                  [conversationId]: false,
                }));
              }
              setArtifactsFullscreen(false);
            }}
          />
        </div>
      </div>
    </ThreadTimelineControlsProvider>
  );
}
