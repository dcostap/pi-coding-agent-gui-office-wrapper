import { PanelRightClose, X } from "lucide-react";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";

type ProjectFileBrowserPanelProps = {
  docked: boolean;
  open: boolean;
  projectId: string;
  onClose: () => void;
};

export function ProjectFileBrowserPanel({
  docked,
  open,
  projectId,
  onClose,
}: ProjectFileBrowserPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-white/10 bg-[color:var(--sidebar)] shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-[28px]",
        docked ? "rounded-none" : "rounded-l-2xl",
      )}
      aria-label="Project files"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[13px] font-medium text-[color:var(--text)]">
            Project files
          </h2>
          <p className="m-0 truncate text-[11px] text-[color:var(--muted-2)]">{projectId}</p>
        </div>
        <button
          type="button"
          className={cn(compactIconButtonClass, "h-7 w-7 rounded-full")}
          onClick={onClose}
          aria-label={docked ? "Collapse project files" : "Close project files"}
          data-tooltip={docked ? "Collapse project files" : "Close project files"}
        >
          {docked ? <PanelRightClose size={14} /> : <X size={14} />}
        </button>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center p-4 text-center text-[12px] text-[color:var(--muted)]">
        <p className="m-0 max-w-[20rem]">
          Project file browser placeholder. Files copied or created in this project will appear here.
        </p>
      </div>
    </aside>
  );
}
