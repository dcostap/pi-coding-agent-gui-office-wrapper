import {
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image,
  Presentation,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ComposerAttachment } from "../../../desktop/types";
import { cn } from "../../../utils/cn";

const officeAttachmentIconMap: Record<string, { icon: LucideIcon; className: string }> = {
  csv: { icon: FileSpreadsheet, className: "text-[#7fd69b]" },
  doc: { icon: FileText, className: "text-[#8cb8ff]" },
  docx: { icon: FileText, className: "text-[#8cb8ff]" },
  odp: { icon: Presentation, className: "text-[#ffb178]" },
  ods: { icon: FileSpreadsheet, className: "text-[#7fd69b]" },
  odt: { icon: FileText, className: "text-[#8cb8ff]" },
  pdf: { icon: FileText, className: "text-[#ff8f8f]" },
  pot: { icon: Presentation, className: "text-[#ffb178]" },
  potx: { icon: Presentation, className: "text-[#ffb178]" },
  pps: { icon: Presentation, className: "text-[#ffb178]" },
  ppsx: { icon: Presentation, className: "text-[#ffb178]" },
  ppt: { icon: Presentation, className: "text-[#ffb178]" },
  pptx: { icon: Presentation, className: "text-[#ffb178]" },
  rtf: { icon: FileText, className: "text-[#c8b6ff]" },
  txt: { icon: FileText, className: "text-[#b7c0d8]" },
  xls: { icon: FileSpreadsheet, className: "text-[#7fd69b]" },
  xlsm: { icon: FileSpreadsheet, className: "text-[#7fd69b]" },
  xlsx: { icon: FileSpreadsheet, className: "text-[#7fd69b]" },
};

const archiveAttachmentExtensions = new Set(["7z", "gz", "rar", "tar", "zip"]);
const codeAttachmentExtensions = new Set([
  "css",
  "htm",
  "html",
  "js",
  "json",
  "md",
  "py",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
]);

function getAttachmentExtension(name: string) {
  const cleanName = name.trim().replace(/[\\/]+$/, "");
  const lastSegment = cleanName.split(/[\\/]/).filter(Boolean).pop() ?? cleanName;
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : null;
  return extension?.toLowerCase() ?? "";
}

function GenericAttachmentIcon({ extension }: { extension: string }) {
  const label = /^[a-z0-9]{3}$/i.test(extension) ? extension.toLowerCase() : "";

  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center text-[color:var(--muted)]">
      <File size={16} />
      {label ? (
        <span className="absolute top-[6px] left-1/2 max-w-[12px] -translate-x-1/2 scale-[0.58] font-mono text-[7px] font-bold leading-none tracking-[-0.08em] text-[color:var(--muted)]">
          {label}
        </span>
      ) : null}
    </span>
  );
}

function getAttachmentIcon(attachment: ComposerAttachment) {
  const extension = getAttachmentExtension(attachment.name || attachment.path);

  if (attachment.kind === "image") {
    return <Image size={15} className="text-[#8abeb7]" />;
  }

  const mappedIcon = officeAttachmentIconMap[extension];
  if (mappedIcon) {
    const Icon = mappedIcon.icon;
    return <Icon size={15} className={mappedIcon.className} />;
  }

  if (archiveAttachmentExtensions.has(extension)) {
    return <FileArchive size={15} className="text-[#f0c674]" />;
  }

  if (codeAttachmentExtensions.has(extension)) {
    return <FileCode size={15} className="text-[#b5bd68]" />;
  }

  return <GenericAttachmentIcon extension={extension} />;
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
              "attachment-shelf-item inline-flex max-w-[17rem] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] py-1.5 pr-1.5 pl-2.5 text-[12px] text-[color:var(--text)] shadow-[0_8px_22px_rgba(0,0,0,0.14)] transition-colors hover:border-white/16 hover:bg-white/[0.065]",
            )}
            title={attachment.path}
          >
            <span className="shrink-0">{getAttachmentIcon(attachment)}</span>
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
