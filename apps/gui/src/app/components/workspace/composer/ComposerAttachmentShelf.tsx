import { File, Image, X } from "lucide-react";
import type { ComposerAttachment } from "../../../desktop/types";
import { cn } from "../../../utils/cn";

function getAttachmentIcon(attachment: ComposerAttachment) {
  if (attachment.kind === "image") {
    return <Image size={14} />;
  }

  return <File size={14} />;
}

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
              "attachment-shelf-item group relative inline-flex max-w-[16rem] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] py-1.5 pr-7 pl-2.5 text-[12px] text-[color:var(--text)] shadow-[0_8px_22px_rgba(0,0,0,0.14)] transition-colors hover:border-white/16 hover:bg-white/[0.065]",
            )}
            title={attachment.path}
          >
            <span className="shrink-0 text-[color:var(--muted)]">{getAttachmentIcon(attachment)}</span>
            <span className="min-w-0 truncate">{attachment.name}</span>
            <span className="shrink-0 text-[10px] text-[color:var(--muted-2)]">will copy</span>
            <button
              type="button"
              className="absolute top-1 right-1 inline-flex h-4.5 w-4.5 items-center justify-center rounded-full text-[color:var(--muted)] opacity-70 transition hover:bg-white/10 hover:text-[color:var(--text)] hover:opacity-100"
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
