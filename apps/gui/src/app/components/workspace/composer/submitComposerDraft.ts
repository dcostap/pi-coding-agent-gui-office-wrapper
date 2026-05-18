import type {
  ComposerAttachment,
  ComposerStreamingBehavior,
  DesktopActionInvoker,
} from "../../../desktop/types";
import { getDesktopActionErrorMessage } from "../../../desktop/action-results";
import { getErrorMessage } from "../../../desktop/error-messages";
import { isCompactSlashCommand } from "../../../../../shared/composer-slash-commands";

type SubmitComposerDraftResult =
  | { status: "skipped" }
  | { status: "sent"; text: string }
  | { status: "stopped"; text: string }
  | { status: "error"; errorMessage: string; text: string; globallyReported?: boolean };

type SubmitComposerDraftOptions = {
  draft: string;
  attachments: ComposerAttachment[];
  isSending: boolean;
  projectId: string;
  chatGroupId?: string | null;
  sessionPath: string | null;
  streamingBehaviorPreference: ComposerStreamingBehavior;
  allowSlashCommand?: boolean;
  onAction: DesktopActionInvoker;
};

export async function submitComposerDraft({
  draft,
  attachments,
  isSending,
  projectId,
  chatGroupId = null,
  sessionPath,
  streamingBehaviorPreference,
  allowSlashCommand = false,
  onAction,
}: SubmitComposerDraftOptions): Promise<SubmitComposerDraftResult> {
  const text = draft.trim();
  if ((text.length === 0 && attachments.length === 0) || isSending) {
    return { status: "skipped" };
  }

  try {
    if (text.startsWith("/") && !allowSlashCommand) {
      return {
        status: "error",
        errorMessage: "Slash commands are disabled.",
        text,
      };
    }

    const sendAttachments = allowSlashCommand && isCompactSlashCommand(text) ? [] : attachments;
    const actionResult = await onAction("composer.send", {
      text,
      attachments: sendAttachments,
      projectId,
      chatGroupId,
      sessionPath,
      streamingBehavior: streamingBehaviorPreference,
      allowSlashCommand,
    });

    const actionErrorMessage = getDesktopActionErrorMessage(actionResult, "Could not send prompt.");
    if (actionErrorMessage) {
      return {
        status: "error",
        errorMessage: actionErrorMessage,
        text,
        globallyReported: true,
      };
    }

    if (actionResult?.result?.composerSendOutcome === "stopped") {
      return { status: "stopped", text };
    }

    return { status: "sent", text };
  } catch (error) {
    return {
      status: "error",
      errorMessage: getErrorMessage(error, "Could not send prompt."),
      text,
    };
  }
}
