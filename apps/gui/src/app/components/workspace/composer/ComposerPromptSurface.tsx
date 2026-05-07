import { Square } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import type { ComposerProps } from "../Composer";
import { ComposerFooter } from "./ComposerFooter";
import { ComposerPromptInputPanel } from "./ComposerPromptInputPanel";
import { hasAttachmentHintInClipboardData } from "./composer-paste-attachments";
import { useComposerController } from "./controller/useComposerController";
import { useComposerSlashCommands } from "./useComposerSlashCommands";

type ComposerPromptSurfaceProps = ComposerProps & {
  composerPanelRef: RefObject<HTMLDivElement | null>;
  mainViewRef: RefObject<HTMLElement | null>;
  workspaceFooterRef: RefObject<HTMLElement | null>;
  onOpenGitOps: () => void;
};

export function ComposerPromptSurface({
  activeView,
  composerPanelRef,
  model,
  contextUsage,
  availableModels,
  isStreaming,
  replyActivityKey,
  isCompacting,
  isExtensionCommandRunning,
  thinkingLevel,
  restoredQueuedPrompt,
  streamingBehaviorPreference,
  availableThinkingLevels,
  projectId,
  chatGroupId,
  projectGitState,
  diffBaseline,
  sessionPath,
  dictationModelId,
  dictationMaxDurationSeconds,
  onOpenTakeoverTerminal,
  onToggleTerminal,
  onToggleArtifacts,
  onOpenSettingsView,
  onRestoredQueuedPromptApplied,
  onAction,
  terminalVisible,
  artifactsVisible,
  artifactsAvailable,
  onSetDiffBaseline,
  onOpenGitOps,
  onLayoutChange,
  showTerminalControls = true,
}: ComposerPromptSurfaceProps) {
  const {
    attachments,
    cancelDictation,
    canSend,
    clearError,
    draft,
    dictationActive,
    dictationInterimText,
    errorMessage,
    extensionCommandRunning,
    inputLocked,
    isSending,
    isStreaming: composerIsStreaming,
    modelButtonRef,
    modelMenuOpen,
    modelMenuRef,
    removeAttachment,
    runComposerAction,
    compact,
    send,
    sendExtensionCommand,
    setDraft,
    setOpenMenu,
    stop,
    handleDrop,
    handlePaste,
    thinkingLevelLabels,
  } = useComposerController({
    activeView,
    model,
    projectId,
    chatGroupId,
    sessionPath,
    dictationModelId,
    dictationMaxDurationSeconds,
    isStreaming,
    replyActivityKey,
    isCompacting,
    isExtensionCommandRunning,
    restoredQueuedPrompt,
    streamingBehaviorPreference,
    onAction,
    onRestoredQueuedPromptApplied,
  });
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const attachmentDragResetTimerRef = useRef<number | null>(null);
  const dictationTranscribing = dictationInterimText.length > 0;
  const composerMode = activeView === "chat" ? "chat" : "code";
  const slashCommandPanelRef = useRef<HTMLDivElement>(null);
  const stopButtonBoundaryRef = useRef<HTMLDivElement>(null);
  const slashCommands = useComposerSlashCommands({
    draft,
    projectId,
    sessionPath,
    composerMode,
    setDraft,
    send,
    sendExtensionCommand,
    onOpenSettingsView,
  });
  const slashCommandListSignature = slashCommands.commands
    .map((command) => `${command.source}:${command.name}`)
    .join("|");

  useEffect(() => {
    if (!slashCommands.open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        slashCommandPanelRef.current?.contains(target) ||
        composerPanelRef.current?.contains(target) ||
        stopButtonBoundaryRef.current?.contains(target)
      ) {
        return;
      }

      slashCommands.dismiss({ clearDraft: true });
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [composerPanelRef, slashCommands]);

  useEffect(() => {
    if (!slashCommands.open || !slashCommands.activeDescendantId) {
      return;
    }

    // Keep the effect tied to command content changes too: the active id can remain
    // `...-0` while filtering swaps the actual first row underneath it.
    void slashCommandListSignature;

    const panel = slashCommandPanelRef.current;
    const option = panel?.querySelector<HTMLElement>(`#${slashCommands.activeDescendantId}`);
    if (!panel || !option) {
      return;
    }

    if (slashCommands.selectedIndex === 0) {
      panel.scrollTop = 0;
      return;
    }

    const panelStyles = window.getComputedStyle(panel);
    const paddingTop = Number.parseFloat(panelStyles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(panelStyles.paddingBottom) || 0;
    const visibleTop = panel.scrollTop + paddingTop;
    const visibleBottom = panel.scrollTop + panel.clientHeight - paddingBottom;
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;

    if (optionTop < visibleTop) {
      panel.scrollTop = optionTop - paddingTop;
    } else if (optionBottom > visibleBottom) {
      panel.scrollTop = optionBottom - panel.clientHeight + paddingBottom;
    }
  }, [
    slashCommands.open,
    slashCommands.activeDescendantId,
    slashCommands.selectedIndex,
    slashCommandListSignature,
  ]);

  useEffect(() => {
    if (!dictationActive && !dictationTranscribing) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      (document.activeElement as HTMLElement | null)?.blur?.();
      void cancelDictation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [cancelDictation, dictationActive, dictationTranscribing]);

  useEffect(() => {
    const clearDragResetTimer = () => {
      if (attachmentDragResetTimerRef.current !== null) {
        window.clearTimeout(attachmentDragResetTimerRef.current);
        attachmentDragResetTimerRef.current = null;
      }
    };

    const resetAttachmentDrag = () => {
      clearDragResetTimer();
      dragDepthRef.current = 0;
      setAttachmentDragActive(false);
    };

    const isOutsideWindow = (event: DragEvent) => {
      const x = event.clientX;
      const y = event.clientY;
      return x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight;
    };

    const handleGlobalDragEnter = (event: DragEvent) => {
      if (!hasAttachmentHintInClipboardData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setAttachmentDragActive(true);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleGlobalFileDrag = (event: DragEvent) => {
      if (!hasAttachmentHintInClipboardData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      setAttachmentDragActive(true);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleGlobalDragLeave = (event: DragEvent) => {
      if (!hasAttachmentHintInClipboardData(event.dataTransfer)) {
        return;
      }

      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current > 0) {
        return;
      }

      if (!isOutsideWindow(event)) {
        return;
      }

      clearDragResetTimer();
      attachmentDragResetTimerRef.current = window.setTimeout(resetAttachmentDrag, 60);
    };

    const handleGlobalDrop = (event: DragEvent) => {
      if (!hasAttachmentHintInClipboardData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      resetAttachmentDrag();
      void handleDrop(event.dataTransfer);
    };

    window.addEventListener("dragenter", handleGlobalDragEnter, true);
    window.addEventListener("dragover", handleGlobalFileDrag, true);
    window.addEventListener("dragleave", handleGlobalDragLeave, true);
    window.addEventListener("drop", handleGlobalDrop, true);

    return () => {
      resetAttachmentDrag();
      window.removeEventListener("dragenter", handleGlobalDragEnter, true);
      window.removeEventListener("dragover", handleGlobalFileDrag, true);
      window.removeEventListener("dragleave", handleGlobalDragLeave, true);
      window.removeEventListener("drop", handleGlobalDrop, true);
    };
  }, [handleDrop]);

  const extensionRunning = extensionCommandRunning;
  const placeholderText =
    errorMessage ?? "Escribe aquí · Enter para enviar · Shift + Enter para nueva línea";
  const canStopComposer = (composerIsStreaming || extensionRunning) && !isSending && !!sessionPath;

  return (
    <div className="relative left-1/2 grid w-[calc(100%-1rem)] -translate-x-1/2 grid-cols-[minmax(0,1fr)_1.75rem] items-end gap-1 overflow-visible">
      <div
        ref={composerPanelRef}
        className={cn(
          "composer-attachment-drop-target relative grid gap-0 overflow-visible rounded-[18px] border border-[rgba(255,255,255,0.075)] bg-[color:var(--panel)] shadow-[0_16px_48px_rgba(0,0,0,0.24)]",
          attachmentDragActive && "composer-attachment-drop-target--active",
        )}
        aria-label="Composer panel"
        data-attachment-drop-active={attachmentDragActive ? "true" : "false"}
      >
        <div className="composer-attachment-drop-glow" aria-hidden="true" />
        <div className="composer-attachment-drop-label" aria-hidden="true">
          Suelta para adjuntar archivos
        </div>
        {/* Let the prompt column size itself to one line by default, then grow upward naturally as
            the textarea expands. */}
        <div className="relative">
          {/* The prompt surface keeps prompt text and trailing controls in one shared block so it
              still mirrors the git-ops composer shell while attachments live beside it. */}
          <ComposerPromptInputPanel
            attachments={attachments}
            clearError={clearError}
            dictationActive={dictationActive}
            dictationTranscribing={dictationTranscribing}
            draft={draft}
            errorMessage={errorMessage}
            extensionRunning={extensionRunning}
            inputLocked={inputLocked}
            canSubmit={canSend}
            placeholderText={placeholderText}
            slashCommandPanelRef={slashCommandPanelRef}
            slashCommands={slashCommands}
            cancelDictation={cancelDictation}
            handlePaste={handlePaste}
            onLayoutChange={onLayoutChange}
            onSubmit={slashCommands.submit}
            removeAttachment={removeAttachment}
            setDraft={setDraft}
          />
        </div>

        {errorMessage ? (
          <output className="sr-only" aria-live="polite">
            {errorMessage}
          </output>
        ) : null}

        <div className="h-px bg-[rgba(255,255,255,0.055)]" />

        <ComposerFooter
          availableModels={availableModels}
          availableThinkingLevels={availableThinkingLevels}
          composerPanelRef={composerPanelRef}
          diffBaseline={diffBaseline}
          model={model}
          contextUsage={contextUsage}
          compactDisabled={isStreaming || isCompacting || !sessionPath}
          isCompacting={isCompacting}
          modelButtonRef={modelButtonRef}
          modelMenuOpen={modelMenuOpen}
          modelMenuRef={modelMenuRef}
          onOpenGitOps={onOpenGitOps}
          onOpenTakeoverTerminal={onOpenTakeoverTerminal}
          onSelectBaseline={onSetDiffBaseline}
          onSelectModel={(availableModel) => {
            if (activeView === "chat" || activeView === "thread") {
              void runComposerAction(
                "settings.update",
                {
                  key: composerMode === "chat" ? "chatModel" : "codeModel",
                  provider: availableModel.provider,
                  modelId: availableModel.id,
                },
                { closeMenu: false },
              );
              return;
            }

            void runComposerAction(
              "composer.model",
              {
                provider: availableModel.provider,
                modelId: availableModel.id,
                projectId,
                sessionPath,
              },
              { closeMenu: false },
            );
          }}
          onSelectThinkingLevel={(level) => {
            if (activeView === "chat" || activeView === "thread") {
              void runComposerAction("settings.update", {
                key: composerMode === "chat" ? "chatThinkingLevel" : "codeThinkingLevel",
                value: level,
              });
              return;
            }

            void runComposerAction("composer.thinking", {
              level,
              projectId,
              sessionPath,
            });
          }}
          onCompact={() => void compact()}
          onSetOpenMenu={setOpenMenu}
          onToggleTerminal={onToggleTerminal}
          onToggleArtifacts={onToggleArtifacts}
          projectGitState={projectGitState}
          projectId={projectId}
          showTerminalControls={showTerminalControls}
          terminalVisible={terminalVisible}
          artifactsVisible={artifactsVisible}
          artifactsAvailable={artifactsAvailable}
          thinkingLevel={thinkingLevel}
          thinkingLevelLabels={thinkingLevelLabels}
        />
      </div>

      <div
        ref={stopButtonBoundaryRef}
        className="mb-[3.55rem] inline-flex h-8 shrink-0 items-center justify-end text-[color:var(--muted)]"
      >
        <button
          type="button"
          className={cn(
            compactIconButtonClass,
            "h-7 w-7 shrink-0 rounded-full text-[#ffb4b4] hover:bg-[rgba(229,111,111,0.2)] hover:text-[#ffd1d1]",
            canStopComposer
              ? "bg-[rgba(229,111,111,0.14)] opacity-80"
              : "bg-transparent opacity-25 hover:opacity-45",
          )}
          onClick={() => void stop()}
          disabled={!canStopComposer}
          aria-label="Stop Pi"
          data-tooltip="Stop Pi"
        >
          <Square size={11} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
