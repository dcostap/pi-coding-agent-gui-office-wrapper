import { X } from "lucide-react";
import type { ComposerQueuedPrompt } from "../../../desktop/types";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";

type QueuedPromptsCardProps = {
  prompts: ComposerQueuedPrompt[];
  pendingPromptIds?: string[];
  onEditPrompt: (prompt: ComposerQueuedPrompt) => void;
  onRemovePrompt: (prompt: ComposerQueuedPrompt) => void;
};

export function QueuedPromptsCard({
  prompts,
  pendingPromptIds = [],
  onEditPrompt,
  onRemovePrompt,
}: QueuedPromptsCardProps) {
  if (prompts.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative -left-1 mx-auto grid w-full max-w-[664px] gap-1.5 rounded-t-2xl rounded-b-none border border-white/10 bg-[rgba(24,24,24,0.82)] px-2.5 py-2 shadow-[0_-10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl",
      )}
    >
      <div className="pl-3.5 text-[12px] text-[color:var(--muted)]">
        Mensajes en cola. Haz clic para editar.
      </div>

      <div className="grid gap-1">
        {prompts.map((prompt) => {
          const isPending = pendingPromptIds.includes(prompt.id);

          return (
            <div
              key={prompt.id}
              className={cn(
                "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-xl border border-transparent bg-white/[0.035] px-1 py-0 text-[12px] shadow-none transition-colors hover:border-white/10 hover:bg-white/[0.06]",
                isPending && "opacity-60",
              )}
            >
              <button
                type="button"
                className="min-w-0 px-2.5 py-1 text-left text-[12px] leading-5 text-[color:var(--text)]/88 disabled:cursor-default"
                onClick={() => onEditPrompt(prompt)}
                disabled={isPending}
              >
                <span className="block truncate">{prompt.text}</span>
              </button>

              <button
                type="button"
                className={cn(compactIconButtonClass, "mr-1 shrink-0")}
                onClick={() => onRemovePrompt(prompt)}
                aria-label="Quitar de la cola"
                disabled={isPending}
                data-tooltip="Quitar de la cola"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
