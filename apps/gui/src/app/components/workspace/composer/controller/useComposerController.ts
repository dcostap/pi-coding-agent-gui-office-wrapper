import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopAction } from "../../../../desktop/actions";
import { getErrorMessage } from "../../../../desktop/error-messages";
import type {
  ComposerModel,
  ComposerStreamingBehavior,
  ComposerThinkingLevel,
  DesktopActionInvoker,
} from "../../../../desktop/types";
import type { View } from "../../../../types";
import { useDismissibleLayer } from "../../../../hooks/useDismissibleLayer";
import { useComposerClipboardHandlers } from "../useComposerClipboardHandlers";
import { useComposerDictation } from "../useComposerDictation";
import { useComposerSubmission } from "../useComposerSubmission";
import { useComposerDraftState } from "./useComposerDraftState";

const thinkingLevelLabels: Record<ComposerThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
};

function getModelLabel(model: ComposerModel | null) {
  if (!model) {
    return "No model";
  }

  return model.name;
}

type UseComposerControllerProps = {
  activeView: View;
  model: ComposerModel | null;
  projectId: string;
  chatGroupId?: string | null;
  sessionPath: string | null;
  dictationModelId: string | null;
  dictationMaxDurationSeconds: number;
  isStreaming: boolean;
  replyActivityKey: string;
  isCompacting: boolean;
  isExtensionCommandRunning: boolean;
  restoredQueuedPrompt: string | null;
  streamingBehaviorPreference: ComposerStreamingBehavior;
  onAction: DesktopActionInvoker;
  onRestoredQueuedPromptApplied: () => void;
};

export function useComposerController({
  activeView,
  model,
  projectId,
  chatGroupId = null,
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
}: UseComposerControllerProps) {
  const [openMenu, setOpenMenu] = useState<"model" | "picker" | null>(null);
  const [localExtensionCommandRunning, setLocalExtensionCommandRunning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingSubmittedDraft, setPendingSubmittedDraft] = useState<string | null>(null);
  const pendingSubmittedReplyActivityKeyRef = useRef<string | null>(null);
  const pendingSubmittedDraftScopeKeyRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const composerMode = activeView === "chat" ? "chat" : "code";
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const sendLockRef = useRef(false);
  const {
    activeComposerScopeKeyRef,
    activeDraftThreadIdRef,
    attachments,
    attachmentsRef,
    composerScopeKey,
    draft,
    draftThreadId,
    draftValueRef,
    setAttachmentValue,
    setDraftValue,
    skipNextDraftPersistenceRef,
  } = useComposerDraftState({
    composerMode,
    projectId,
    sessionPath,
    openMenu,
    setOpenMenu,
    setErrorMessage,
    restoredQueuedPrompt,
    onRestoredQueuedPromptApplied,
  });

  useDismissibleLayer({
    open: openMenu === "model",
    onDismiss: () => setOpenMenu(null),
    refs: [modelButtonRef, modelMenuRef],
  });


  const extensionCommandRunning = isExtensionCommandRunning || localExtensionCommandRunning;
  const canSend =
    (draft.trim().length > 0 || attachments.length > 0) &&
    !isSending &&
    !pendingSubmittedDraft &&
    !isCompacting;

  useEffect(() => {
    if (
      !pendingSubmittedDraft ||
      pendingSubmittedReplyActivityKeyRef.current === null ||
      pendingSubmittedReplyActivityKeyRef.current === replyActivityKey
    ) {
      return;
    }

    if (draftValueRef.current === pendingSubmittedDraft) {
      setDraftValue("");
    }
    pendingSubmittedReplyActivityKeyRef.current = null;
    setPendingSubmittedDraft(null);
  }, [draftValueRef, pendingSubmittedDraft, replyActivityKey, setDraftValue]);

  useEffect(() => {
    if (!pendingSubmittedDraft || isSending || isStreaming) return;
    const submittedReplyActivityKey = pendingSubmittedReplyActivityKeyRef.current;
    const timeout = window.setTimeout(() => {
      if (pendingSubmittedReplyActivityKeyRef.current !== submittedReplyActivityKey) return;
      pendingSubmittedReplyActivityKeyRef.current = null;
      setPendingSubmittedDraft(null);
    }, 60_000);
    return () => window.clearTimeout(timeout);
  }, [isSending, isStreaming, pendingSubmittedDraft]);

  useEffect(() => {
    if (pendingSubmittedDraftScopeKeyRef.current === composerScopeKey) return;
    pendingSubmittedDraftScopeKeyRef.current = composerScopeKey;
    pendingSubmittedReplyActivityKeyRef.current = null;
    setPendingSubmittedDraft(null);
  }, [composerScopeKey]);

  useEffect(() => {
    void composerScopeKey;
    setLocalExtensionCommandRunning(false);
  }, [composerScopeKey]);

  const {
    cancelDictation,
    dictationActive,
    dictationInterimText,
    dictationMissingModel,
    dictationSupported,
    stopDictationAndFlush,
    toggleDictation,
  } = useComposerDictation({
    activeView,
    dictationModelId,
    dictationMaxDurationSeconds,
    draftThreadId,
    projectId,
    sessionPath,
    setDraftValue,
    setErrorMessage,
  });

  const removeAttachment = useCallback(
    (attachmentPath: string) => {
      setAttachmentValue((current) =>
        current.filter((currentAttachment) => currentAttachment.path !== attachmentPath),
      );
    },
    [setAttachmentValue],
  );

  const clearAttachments = useCallback(() => {
    setAttachmentValue([]);
    setErrorMessage(null);
  }, [setAttachmentValue, setErrorMessage]);

  const runComposerAction = async (
    action: DesktopAction,
    payload: NonNullable<Parameters<DesktopActionInvoker>[1]>,
    options?: { closeMenu?: boolean },
  ) => {
    try {
      await onAction(action, payload);
      setErrorMessage(null);
      if (options?.closeMenu ?? true) {
        setOpenMenu(null);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not update the composer."));
    }
  };

  const { compact, send, sendExtensionCommand, stop } = useComposerSubmission({
    composerScopeKey,
    draftThreadId,
    isSending,
    isStreaming,
    isCompacting,
    onAction,
    projectId,
    chatGroupId,
    sessionPath,
    setAttachments: setAttachmentValue,
    setDraftValue,
    setErrorMessage,
    extensionCommandRunning,
    setExtensionCommandRunning: setLocalExtensionCommandRunning,
    setIsSending,
    setPendingSubmittedDraft,
    pendingSubmittedReplyActivityKeyRef,
    replyActivityKey,
    setOpenMenu,
    stopDictationAndFlush,
    streamingBehaviorPreference,
    activeComposerScopeKeyRef,
    activeDraftThreadIdRef,
    attachmentsRef,
    draftValueRef,
    sendLockRef,
    skipNextDraftPersistenceRef,
  });

  const modelLabel = useMemo(() => getModelLabel(model), [model]);

  const { handleDrop, handlePaste } = useComposerClipboardHandlers({
    setAttachments: setAttachmentValue,
    setDraftValue,
    setErrorMessage,
  });

  return {
    attachments,
    handleDrop,
    handlePaste,
    cancelDictation,
    canSend,
    clearAttachments,
    clearError: () => setErrorMessage(null),
    draft,
    dictationActive,
    dictationInterimText,
    dictationMissingModel,
    dictationSupported,
    errorMessage,
    extensionCommandRunning,
    isSending,
    inputLocked: isSending || pendingSubmittedDraft !== null,
    modelButtonRef,
    modelLabel,
    modelMenuOpen: openMenu === "model",
    modelMenuRef,
    isStreaming,
    removeAttachment,
    runComposerAction,
    compact,
    send,
    sendExtensionCommand,
    setDraft: setDraftValue,
    setOpenMenu,
    stop,
    toggleDictation,
    thinkingLevelLabels,
  };
}
