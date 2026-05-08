import { ArrowRight, Loader2, Square } from "lucide-react";
import type { ClipboardEvent, RefObject } from "react";
import { getPathForFileQuery } from "../../../query/desktop-query";
import { cn } from "../../../utils/cn";
import { ComposerAttachmentShelf } from "./ComposerAttachmentShelf";
import { ComposerTextField } from "./ComposerTextField";
import {
  getComposerAttachmentsFromClipboardData,
  hasAttachmentHintInClipboardData,
} from "./composer-paste-attachments";
import {
  getComposerSlashCommandGroupLabel,
  getComposerSlashCommandOptionId,
  type ComposerSlashCommands,
} from "./useComposerSlashCommands";
import type { ComposerAttachment } from "../../../desktop/types";

type ComposerPromptInputPanelProps = {
  attachments: ComposerAttachment[];
  clearError: () => void;
  dictationActive: boolean;
  dictationTranscribing: boolean;
  draft: string;
  errorMessage: string | null;
  extensionRunning: boolean;
  inputLocked: boolean;
  canSubmit: boolean;
  canStop: boolean;
  placeholderText: string;
  slashCommandPanelRef: RefObject<HTMLDivElement | null>;
  slashCommands: ComposerSlashCommands;
  cancelDictation: () => Promise<void>;
  handlePaste: (payload: {
    clipboardData: DataTransfer | ClipboardEvent<HTMLTextAreaElement>["clipboardData"];
    textarea: HTMLTextAreaElement;
  }) => Promise<void>;
  onLayoutChange?: () => void;
  onSubmit: () => void;
  onStop: () => void;
  removeAttachment: (path: string) => void;
  setDraft: (value: string) => void;
};

export function ComposerPromptInputPanel({
  attachments,
  clearError,
  dictationActive,
  dictationTranscribing,
  draft,
  errorMessage,
  extensionRunning,
  inputLocked,
  canSubmit,
  canStop,
  placeholderText,
  slashCommandPanelRef,
  slashCommands,
  cancelDictation,
  handlePaste,
  onLayoutChange,
  onSubmit,
  onStop,
  removeAttachment,
  setDraft,
}: ComposerPromptInputPanelProps) {
  return (
    <>
      <div className="grid content-end pr-4 pl-[1.1rem] pt-4 pb-2">
        <div className="flex items-end justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-end gap-2">
            <div className="min-w-0 flex-1">
              {slashCommands.open ? (
                <div
                  ref={slashCommandPanelRef}
                  id={slashCommands.listboxId}
                  // biome-ignore lint/a11y/useSemanticElements: This is a textarea-owned combobox popup, not a native select.
                  role="listbox"
                  tabIndex={-1}
                  aria-label="Composer slash commands"
                  className="absolute right-0 bottom-full left-0 z-20 max-h-64 scroll-py-1.5 overflow-auto rounded-xl border border-white/10 bg-[rgba(24,24,24,0.94)] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl"
                >
                  {slashCommands.commands.length > 0 ? (
                    slashCommands.commands.map((command, index) => {
                      const selected = index === slashCommands.selectedIndex;
                      const previous = slashCommands.commands[index - 1];
                      const groupLabel = getComposerSlashCommandGroupLabel(command);
                      const previousGroupLabel = previous
                        ? getComposerSlashCommandGroupLabel(previous)
                        : null;
                      const showGroup = previousGroupLabel !== groupLabel;
                      return (
                        <div key={`${command.source}:${command.name}`}>
                          {showGroup ? (
                            <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-2)]">
                              {groupLabel}
                            </div>
                          ) : null}
                          <button
                            id={getComposerSlashCommandOptionId(index)}
                            type="button"
                            // biome-ignore lint/a11y/useSemanticElements: Command options remain clickable buttons inside the textarea-owned listbox.
                            role="option"
                            aria-selected={selected}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                              selected
                                ? "bg-white/[0.09] text-[color:var(--text)]"
                                : "text-[color:var(--muted)] hover:bg-white/[0.055] hover:text-[color:var(--text)]",
                            )}
                            onPointerEnter={() => slashCommands.setSelectedIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => slashCommands.selectCommand(command)}
                          >
                            <span className="shrink-0 font-mono text-[12px] text-[color:var(--text)]">
                              /{command.name}
                            </span>
                            {command.description ? (
                              <span className="min-w-0 truncate text-[12px]">
                                {command.description}
                              </span>
                            ) : null}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-2 py-2 text-[12px] text-[color:var(--muted)]">
                      {slashCommands.loading ? "Loading commands…" : "No matching commands"}
                    </div>
                  )}
                </div>
              ) : null}
              <ComposerTextField
                value={draft}
                onChange={setDraft}
                onInput={() => {
                  if (errorMessage) {
                    clearError();
                  }
                }}
                onKeyDown={(event) => {
                  if (inputLocked) {
                    event.preventDefault();
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    slashCommands.submit();
                    return;
                  }

                  if (slashCommands.handleKeyDown(event)) {
                    return;
                  }

                  if (event.key === "Escape" && (dictationActive || dictationTranscribing)) {
                    event.preventDefault();
                    void cancelDictation();
                    return;
                  }

                }}
                onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                  if (inputLocked) {
                    event.preventDefault();
                    return;
                  }

                  const clipboardData = event.clipboardData;
                  const directAttachments = getComposerAttachmentsFromClipboardData(clipboardData, {
                    resolveFilePath: (file) => getPathForFileQuery(file as File) ?? null,
                  });
                  const shouldInterceptPaste =
                    directAttachments.length > 0 || hasAttachmentHintInClipboardData(clipboardData);

                  if (!shouldInterceptPaste) {
                    return;
                  }

                  event.preventDefault();
                  void handlePaste({
                    clipboardData,
                    textarea: event.currentTarget,
                  });
                }}
                ariaLabel="Prompt composer"
                ariaActiveDescendant={slashCommands.activeDescendantId}
                ariaControls={slashCommands.open ? slashCommands.listboxId : undefined}
                ariaExpanded={slashCommands.open}
                placeholder={placeholderText}
                readOnly={inputLocked}
                placeholderTone={errorMessage ? "error" : "muted"}
                statusMessage={errorMessage && draft.length > 0 ? errorMessage : null}
                reservedLineCount={1}
                trailingAdornment={null}
                onHeightChange={onLayoutChange}
              />
            </div>
          </div>

          <div className="inline-flex h-8 items-center justify-end gap-2">
            {extensionRunning ? (
              <div className="inline-flex h-6 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.045] px-2.5 text-[12px] text-[color:var(--muted)]">
                <Loader2 size={12} className="animate-spin" />
                <span>Pi extension running</span>
              </div>
            ) : null}
            <button
              type="button"
              className={cn(
                "group relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border shadow-[0_0_0_rgba(255,255,255,0)] transition-[background-color,border-color,color,opacity,transform] duration-200 ease-out active:scale-95 disabled:pointer-events-none",
                canStop
                  ? "border-[rgba(229,111,111,0.22)] bg-[rgba(229,111,111,0.14)] text-[#ffb4b4] hover:bg-[rgba(229,111,111,0.2)] hover:text-[#ffd1d1] disabled:opacity-55"
                  : "border-white/15 bg-white/[0.06] text-[color:var(--text)] hover:border-white/25 hover:bg-white/[0.12] hover:text-white disabled:border-white/10 disabled:bg-white/[0.035] disabled:text-[color:var(--muted-2)] disabled:opacity-55",
              )}
              onClick={canStop ? onStop : onSubmit}
              disabled={canStop ? false : !canSubmit || inputLocked}
              aria-label={canStop ? "Detener Pi" : "Enviar prompt"}
              data-tooltip={canStop ? "Detener Pi" : "Enviar · Enter"}
              data-mode={canStop ? "stop" : "send"}
            >
              <ArrowRight
                size={15}
                className={cn(
                  "absolute transition-all duration-300 ease-out",
                  canStop
                    ? "translate-x-2 scale-75 opacity-0 rotate-45"
                    : "translate-x-0 scale-100 opacity-100 rotate-0",
                )}
              />
              <Square
                size={11}
                fill="currentColor"
                className={cn(
                  "absolute transition-all duration-300 ease-out",
                  canStop ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-45",
                )}
              />
            </button>
          </div>
        </div>
      </div>
      <ComposerAttachmentShelf attachments={attachments} onRemove={removeAttachment} />
    </>
  );
}
