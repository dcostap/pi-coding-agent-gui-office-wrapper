import { parseComposerAttachmentBlock } from "../../../../../shared/composer-attachment-prompt";
import { isUnassignedChatProjectId } from "../../../../../shared/unassigned-chats";
import type { Message } from "../../../types";

export function getProjectFilesPanelLabels(projectId: string) {
  const isChat = isUnassignedChatProjectId(projectId);

  return {
    isChat,
    title: isChat ? "Archivos del chat" : "Archivos del proyecto",
    subtitle: isChat ? null : undefined,
    openLabel: isChat ? "Abrir archivos del chat" : "Abrir archivos del proyecto",
    closeLabel: isChat ? "Contraer archivos del chat" : "Contraer archivos del proyecto",
  };
}

export function getAttachedFilePathsFromMessages(messages: readonly Message[]) {
  return new Set(
    messages.flatMap((message) => {
      if (message.role !== "user") {
        return [];
      }

      return message.content.flatMap(
        (paragraph: string) => parseComposerAttachmentBlock(paragraph).attachmentPaths,
      );
    }),
  );
}
