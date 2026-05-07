import { X } from "lucide-react";
import { FileTypeIcon } from "../../common/FileTypeIcon";
import type { ComposerAttachment } from "../../../desktop/types";
import { cn } from "../../../utils/cn";

type ComposerAttachmentShelfProps = {
  attachments: ComposerAttachment[];
  onRemove: (attachmentPath: string) => void;
};

export function ComposerAttachmentShelf({ attachments, onRemove }: ComposerAttachmentShelfProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      className="border-t border-white/[0.055] px-4 pt-2 pb-3"
      aria-label="Files attached to this prompt"
    >
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.path}
            className={cn(
              "attachment-shelf-item inline-flex max-w-[17rem] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] py-1.5 pr-1.5 pl-2.5 text-[12px] text-[color:var(--text)] shadow-[0_8px_22px_rgba(0,0,0,0.14)] transition-colors hover:border-white/16 hover:bg-white/[0.065]",
            )}
            title={attachment.path}
          >
            <span className="shrink-0">
              <FileTypeIcon
                kind={attachment.kind === "directory" ? "directory" : attachment.kind === "image" ? "image" : "file"}
                name={attachment.name || attachment.path}
                size={15}
              />
            </span>
            <span className="min-w-0 truncate pr-1">{attachment.name}</span>
            <button
              type="button"
              className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-[color:var(--muted)] opacity-75 transition hover:border-white/18 hover:bg-white/[0.09] hover:text-[color:var(--text)] hover:opacity-100"
              onClick={() => onRemove(attachment.path)}
              aria-label={`Remove ${attachment.name}`}
              data-tooltip="Remove attachment"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
