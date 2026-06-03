import { File, Image } from "lucide-react";
import { openPathQuery } from "../../query/desktop-query";

function getAttachmentName(pathValue: string) {
  const normalizedPath = pathValue.replace(/[\\/]+$/, "");
  const parts = normalizedPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? pathValue;
}

function isImagePath(pathValue: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(pathValue);
}

type UserMessageAttachmentsProps = {
  attachmentPaths: string[];
};

export function UserMessageAttachments({ attachmentPaths }: UserMessageAttachmentsProps) {
  if (attachmentPaths.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 grid gap-1.5 border-t border-white/10 pt-2" aria-label="Archivos adjuntos del mensaje">
      <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted-2)]">
        Archivos adjuntos
      </div>
      <div className="flex flex-wrap gap-1.5">
        {attachmentPaths.map((pathValue) => {
          const name = getAttachmentName(pathValue);
          return (
            <button
              key={pathValue}
              type="button"
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-left text-[12.5px] text-[color:var(--text)] transition hover:border-white/18 hover:bg-white/[0.07]"
              title={pathValue}
              onClick={() => void openPathQuery(pathValue)}
              aria-label={`Abrir archivo adjunto ${name}`}
              data-tooltip="Abrir archivo adjunto"
            >
              <span className="shrink-0 text-[color:var(--muted)]">
                {isImagePath(pathValue) ? <Image size={12} /> : <File size={12} />}
              </span>
              <span className="min-w-0 truncate">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
