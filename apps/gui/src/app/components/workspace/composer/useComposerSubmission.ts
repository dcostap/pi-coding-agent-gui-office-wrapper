import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { getDesktopActionErrorMessage } from "../../../desktop/action-results";
import { getErrorMessage } from "../../../desktop/error-messages";
import { showGlobalToast } from "../../../hooks/useToast";
import type {
  ComposerAttachment,
  ComposerStreamingBehavior,
  DesktopActionInvoker,
} from "../../../desktop/types";
import { composerDraftStore } from "./composerDraftStore";
import { withComposerSendLock } from "./composerSendLock";
import { submitComposerDraft } from "./submitComposerDraft";

import {
  areSameAttachments,
  getComposerPostSendCleanup,
  isSameSubmittedDraft,
} from "./composer-submission-cleanup";
type UseComposerSubmissionProps = {
  composerScopeKey: string;
  draftThreadId: string | null;
  isSending: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  extensionCommandRunning: boolean;
  onAction: DesktopActionInvoker;
  projectId: string;
  chatGroupId?: string | null;
  sessionPath: string | null;
  setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  setDraftValue: Dispatch<SetStateAction<string>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setExtensionCommandRunning: Dispatch<SetStateAction<boolean>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setPendingSubmittedDraft: Dispatch<SetStateAction<string | null>>;
  onPendingSubmittedDraftChange?: (draft: string | null) => void;
  pendingSubmittedReplyActivityKeyRef: MutableRefObject<string | null>;
  replyActivityKey: string;
  setOpenMenu: Dispatch<SetStateAction<"model" | "picker" | null>>;
  stopDictationAndFlush: () => Promise<void>;
  streamingBehaviorPreference: ComposerStreamingBehavior;
  activeComposerScopeKeyRef: MutableRefObject<string>;
  activeDraftThreadIdRef: MutableRefObject<string | null>;
  attachmentsRef: MutableRefObject<ComposerAttachment[]>;
  draftValueRef: MutableRefObject<string>;
  sendLockRef: MutableRefObject<boolean>;
  skipNextDraftPersistenceRef: MutableRefObject<string | null>;
};

export function useComposerSubmission({
  composerScopeKey,
  draftThreadId,
  isSending,
  isStreaming,
  isCompacting,
  extensionCommandRunning,
  onAction,
  projectId,
  chatGroupId = null,
  sessionPath,
  setAttachments,
  setDraftValue,
  setErrorMessage,
  setExtensionCommandRunning,
  setIsSending,
  setPendingSubmittedDraft,
  onPendingSubmittedDraftChange,
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
}: UseComposerSubmissionProps) {
  const extensionCommandRunIdRef = useRef(0);

  const sendExtensionCommand = useCallback(() => {
    if (isCompacting || extensionCommandRunning || sendLockRef.current) {
      return;
    }

    const runId = extensionCommandRunIdRef.current + 1;
    extensionCommandRunIdRef.current = runId;
    setErrorMessage(null);
    setOpenMenu(null);
    setExtensionCommandRunning(true);

    void withComposerSendLock(sendLockRef, async () => {
      const submittedScopeKey = composerScopeKey;
      const submittedDraftThreadId = draftThreadId;

      try {
        await stopDictationAndFlush();

        if (activeComposerScopeKeyRef.current !== submittedScopeKey) {
          return;
        }

        const submittedDraft = draftValueRef.current.trim();
        if (submittedDraft.length === 0) {
          return;
        }

        setDraftValue("");
        if (submittedDraftThreadId) {
          composerDraftStore.setPrompt(submittedDraftThreadId, "");
        }

        const result = await submitComposerDraft({
          draft: submittedDraft,
          attachments: [],
          isSending: false,
          projectId,
          chatGroupId,
          sessionPath,
          streamingBehaviorPreference,
          onAction,
        });

        if (activeComposerScopeKeyRef.current === submittedScopeKey) {
          if (result.status === "error") {
            setDraftValue(result.text);
            if (!result.globallyReported) {
              showGlobalToast({ message: result.errorMessage, tone: "error" });
            }
          } else if (result.status === "stopped") {
            setDraftValue(result.text);
          }
        }
      } catch (error) {
        if (activeComposerScopeKeyRef.current === submittedScopeKey) {
          showGlobalToast({ message: getErrorMessage(error, "Could not send prompt."), tone: "error" });
        }
      } finally {
        if (extensionCommandRunIdRef.current === runId) {
          setExtensionCommandRunning(false);
        }
      }
    });
  }, [
    activeComposerScopeKeyRef,
    chatGroupId,
    composerScopeKey,
    draftThreadId,
    draftValueRef,
    extensionCommandRunning,
    isCompacting,
    onAction,
    projectId,
    sessionPath,
    sendLockRef,
    setDraftValue,
    setErrorMessage,
    setExtensionCommandRunning,
    setOpenMenu,
    stopDictationAndFlush,
    streamingBehaviorPreference,
  ]);

  const send = useCallback(async () => {
    if (isSending || isCompacting || sendLockRef.current) {
      return;
    }

    await withComposerSendLock(sendLockRef, async () => {
      const submittedScopeKey = composerScopeKey;
      const submittedProjectId = projectId;
      const submittedSessionPath = sessionPath;
      const submittedDraftThreadId = draftThreadId;

      setIsSending(true);

      try {
        await stopDictationAndFlush();

        if (activeComposerScopeKeyRef.current !== submittedScopeKey) {
          return;
        }

        const submittedRawDraft = draftValueRef.current;
        const textToSend = submittedRawDraft.trim();
        const submittedAttachments = attachmentsRef.current;
        const submittedWhileStreaming = isStreaming;
        if (textToSend.length === 0 && submittedAttachments.length === 0) {
          return;
        }

        const submittedDraft = textToSend;
        const preserveAttachments = false;

        setErrorMessage(null);
        setOpenMenu(null);
        pendingSubmittedReplyActivityKeyRef.current = replyActivityKey;
        onPendingSubmittedDraftChange?.(submittedRawDraft);
        setPendingSubmittedDraft(submittedRawDraft);

        const result = await submitComposerDraft({
          draft: submittedDraft,
          attachments: submittedAttachments,
          isSending: false,
          projectId: submittedProjectId,
          chatGroupId,
          sessionPath: submittedSessionPath,
          streamingBehaviorPreference,
          onAction,
        });

        if (result.status === "sent") {
          const cleanup = getComposerPostSendCleanup({
            activeDraftThreadId: activeDraftThreadIdRef.current,
            submittedDraftThreadId,
            preserveAttachments,
            currentDraft: draftValueRef.current,
            submittedRawDraft,
            currentAttachments: attachmentsRef.current,
            submittedAttachments,
          });

          if (cleanup.clearStoredDraft && submittedDraftThreadId) {
            if (cleanup.skipNextDraftPersistence) {
              skipNextDraftPersistenceRef.current = submittedDraftThreadId;
            }
            composerDraftStore.clearThreadDraft(submittedDraftThreadId);
          }

          if (cleanup.clearStoredPrompt && submittedDraftThreadId) {
            composerDraftStore.setPrompt(submittedDraftThreadId, "");
          }

          if (cleanup.nextAttachments !== null) {
            setAttachments(cleanup.nextAttachments);
          }

          if (
            submittedWhileStreaming &&
            activeDraftThreadIdRef.current === submittedDraftThreadId
          ) {
            setPendingSubmittedDraft(null);
            pendingSubmittedReplyActivityKeyRef.current = null;
            if (isSameSubmittedDraft(draftValueRef.current, submittedRawDraft)) {
              setDraftValue("");
            }
          }
        }

        if (
          result.status === "error" &&
          activeDraftThreadIdRef.current === submittedDraftThreadId
        ) {
          setPendingSubmittedDraft(null);
          pendingSubmittedReplyActivityKeyRef.current = null;
          if (
            isSameSubmittedDraft(draftValueRef.current, submittedRawDraft) &&
            areSameAttachments(attachmentsRef.current, submittedAttachments)
          ) {
            setDraftValue(result.text);
            setAttachments(submittedAttachments);
          }
          if (!result.globallyReported) {
            showGlobalToast({ message: result.errorMessage, tone: "error" });
          }
        }

        if (
          result.status === "stopped" &&
          activeDraftThreadIdRef.current === submittedDraftThreadId
        ) {
          setPendingSubmittedDraft(null);
          pendingSubmittedReplyActivityKeyRef.current = null;
          if (
            isSameSubmittedDraft(draftValueRef.current, submittedRawDraft) &&
            areSameAttachments(attachmentsRef.current, submittedAttachments)
          ) {
            setDraftValue(result.text);
            setAttachments(submittedAttachments);
          }
        }
      } catch (error) {
        if (activeDraftThreadIdRef.current === submittedDraftThreadId) {
          setPendingSubmittedDraft(null);
          pendingSubmittedReplyActivityKeyRef.current = null;
        }
        showGlobalToast({ message: getErrorMessage(error, "Could not send prompt."), tone: "error" });
      } finally {
        setIsSending(false);
      }
    });
  }, [
    activeComposerScopeKeyRef,
    activeDraftThreadIdRef,
    attachmentsRef,
    chatGroupId,
    composerScopeKey,
    draftThreadId,
    draftValueRef,
    isCompacting,
    isSending,
    isStreaming,
    onAction,
    onPendingSubmittedDraftChange,
    pendingSubmittedReplyActivityKeyRef,
    projectId,
    replyActivityKey,
    sendLockRef,
    sessionPath,
    setAttachments,
    setDraftValue,
    setErrorMessage,
    setIsSending,
    setPendingSubmittedDraft,
    setOpenMenu,
    skipNextDraftPersistenceRef,
    stopDictationAndFlush,
    streamingBehaviorPreference,
  ]);

  const stop = useCallback(async () => {
    if ((!isStreaming && !extensionCommandRunning) || isSending || !sessionPath) {
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    try {
      const result = await onAction("composer.stop", {
        projectId,
        sessionPath,
      });

      const actionErrorMessage = getDesktopActionErrorMessage(result, "Could not stop Pi.");
      if (actionErrorMessage) {
        showGlobalToast({ message: actionErrorMessage, tone: "error" });
      }
    } catch (error) {
      showGlobalToast({ message: getErrorMessage(error, "Could not stop Pi."), tone: "error" });
    } finally {
      setIsSending(false);
    }
  }, [
    extensionCommandRunning,
    isSending,
    isStreaming,
    onAction,
    projectId,
    sessionPath,
    setErrorMessage,
    setIsSending,
  ]);

  const compact = useCallback(async () => {
    if (isSending || isStreaming || isCompacting || !sessionPath || sendLockRef.current) {
      return;
    }

    await withComposerSendLock(sendLockRef, async () => {
      setIsSending(true);
      setErrorMessage(null);

      try {
        await stopDictationAndFlush();

        const result = await submitComposerDraft({
          draft: "/compact",
          attachments: [],
          isSending: false,
          projectId,
          chatGroupId,
          sessionPath,
          streamingBehaviorPreference,
          allowSlashCommand: true,
          onAction,
        });

        if (result.status === "error" && !result.globallyReported) {
          showGlobalToast({ message: result.errorMessage, tone: "error" });
        }
      } finally {
        setIsSending(false);
      }
    });
  }, [
    isCompacting,
    isSending,
    isStreaming,
    chatGroupId,
    onAction,
    projectId,
    sendLockRef,
    sessionPath,
    setErrorMessage,
    setIsSending,
    stopDictationAndFlush,
    streamingBehaviorPreference,
  ]);

  return {
    compact,
    send,
    sendExtensionCommand,
    stop,
  };
}
