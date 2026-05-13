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
      className="border-t border-[color:var(--border)] px-4 pt-2 pb-3"
      aria-label="Files attached to this prompt"
    >
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.path}
            className={cn(
              "attachment-shelf-item inline-flex max-w-[17rem] items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-2)] py-1.5 pr-1.5 pl-2.5 text-[12px] text-[color:var(--text)] shadow-none transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--panel-3)]",
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
              className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] text-[color:var(--muted)] opacity-75 transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text)] hover:opacity-100"
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
