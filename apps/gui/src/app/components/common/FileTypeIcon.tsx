import {
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  Image,
  Presentation,
  type LucideIcon,
} from "lucide-react";

const officeFileIconMap: Record<string, { icon: LucideIcon; className: string }> = {
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

const archiveFileExtensions = new Set(["7z", "gz", "rar", "tar", "zip"]);
const codeFileExtensions = new Set([
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

export function getFileExtension(name: string) {
  const cleanName = name.trim().replace(/[\\/]+$/, "");
  const lastSegment = cleanName.split(/[\\/]/).filter(Boolean).pop() ?? cleanName;
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : null;
  return extension?.toLowerCase() ?? "";
}

function GenericFileIcon({ extension, size }: { extension: string; size: number }) {
  const label = /^[a-z0-9]{3}$/i.test(extension) ? extension.toLowerCase() : "";
  const labelScale = size >= 18 ? 0.66 : 0.58;

  return (
    <span className="relative inline-flex items-center justify-center text-[color:var(--muted)]" style={{ width: size, height: size }}>
      <File size={size} />
      {label ? (
        <span
          className="absolute left-1/2 font-mono font-bold leading-none tracking-[-0.08em] text-[color:var(--muted)]"
          style={{ top: size * 0.38, transform: `translateX(-50%) scale(${labelScale})`, fontSize: 7 }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function FileTypeIcon({
  kind,
  name,
  size = 15,
}: {
  kind: "file" | "directory" | "image";
  name: string;
  size?: number;
}) {
  if (kind === "directory") {
    return <Folder size={size} className="text-[#f0c674]" />;
  }

  const extension = getFileExtension(name);
  if (kind === "image" || /^(png|jpe?g|gif|webp|bmp|svg)$/i.test(extension)) {
    return <Image size={size} className="text-[#8abeb7]" />;
  }

  const mappedIcon = officeFileIconMap[extension];
  if (mappedIcon) {
    const Icon = mappedIcon.icon;
    return <Icon size={size} className={mappedIcon.className} />;
  }

  if (archiveFileExtensions.has(extension)) {
    return <FileArchive size={size} className="text-[#f0c674]" />;
  }

  if (codeFileExtensions.has(extension)) {
    return <FileCode size={size} className="text-[#b5bd68]" />;
  }

  return <GenericFileIcon extension={extension} size={size} />;
}
