import type { KeyboardEvent } from "react";
import type { ComposerSlashCommand } from "../../../desktop/types";

export const composerSlashCommandListboxId = "composer-slash-command-listbox";

export function getComposerSlashCommandOptionId(index: number) {
  return `composer-slash-command-${index}`;
}

export function getComposerSlashCommandGroupLabel(_command: ComposerSlashCommand) {
  return "";
}

type UseComposerSlashCommandsOptions = {
  send: () => void;
  [key: string]: unknown;
};

export type ComposerSlashCommands = ReturnType<typeof useComposerSlashCommands>;

export function useComposerSlashCommands({ send }: UseComposerSlashCommandsOptions) {
  return {
    activeDescendantId: undefined as string | undefined,
    commands: [] as ComposerSlashCommand[],
    handleKeyDown: (_event: KeyboardEvent<HTMLTextAreaElement>) => false,
    listboxId: composerSlashCommandListboxId,
    loading: false,
    open: false,
    dismiss: (_options?: { clearDraft?: boolean }) => {},
    selectCommand: (_command: ComposerSlashCommand) => {},
    selectedIndex: 0,
    setSelectedIndex: (_index: number) => {},
    submit: send,
  };
}
