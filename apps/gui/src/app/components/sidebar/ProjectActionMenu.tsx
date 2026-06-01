import { Archive, FolderOpen, Trash2 } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import { useAnimatedDisclosure } from "../../hooks/useAnimatedPresence";
import type { DesktopAction } from "../../desktop/actions";
import type { DesktopActionInvoker } from "../../desktop/types";
import { cn } from "../../utils/cn";
import { SurfacePanel } from "../common/SurfacePanel";

type ProjectMenuEntry = {
  icon: ReactNode;
  title: string;
  action: DesktopAction;
  danger?: boolean;
};

type DangerousProjectAction = Extract<
  DesktopAction,
  "project.archive-threads" | "project.remove-project"
>;

type ProjectActionMenuProps = {
  menuId: string;
  projectId: string;
  projectName: string;
  canDelete?: boolean;
  pinned?: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  onAction: DesktopActionInvoker;
  onClose: () => void;
};

export function ProjectActionMenu({
  menuId,
  projectId,
  projectName,
  canDelete = true,
  panelRef,
  onAction,
  onClose,
}: ProjectActionMenuProps) {
  const disclosure = useAnimatedDisclosure(true);
  const [confirmAction, setConfirmAction] = useState<DangerousProjectAction | null>(null);

  const handleClick = (action: DesktopAction) => {
    if (action === confirmAction) {
      setConfirmAction(null);
      onAction(action, { projectId, projectName });
      onClose();
      return;
    }

    if (action === "project.archive-threads" || action === "project.remove-project") {
      setConfirmAction(action);
      return;
    }

    setConfirmAction(null);
    onAction(action, { projectId, projectName });
    onClose();
  };

  const items: ProjectMenuEntry[] = [
    {
      icon: <FolderOpen size={14} />,
      title: "Abrir carpeta",
      action: "project.open-in-file-manager",
    },
    {
      icon: <Archive size={14} />,
      title: "Archivar todo",
      action: "project.archive-threads",
    },
  ];

  if (canDelete) {
    items.push({
      icon: <Trash2 size={14} />,
      title: "Eliminar proyecto",
      action: "project.remove-project",
      danger: true,
    });
  }

  return (
    <SurfacePanel
      ref={panelRef}
      id={menuId}
      role="menu"
      aria-label="Acciones del proyecto"
      data-open={disclosure.visible ? "true" : "false"}
      className="sidebar-popover-panel sidebar-project-action-menu motion-popover"
    >
      <div className="sidebar-project-menu-list">
        {items.map((item) => (
          <button
            key={item.action}
            className={cn(
              "sidebar-project-menu-item",
              confirmAction === item.action && item.danger && "text-[#ffd1d1]",
            )}
            data-danger={item.danger ? "true" : "false"}
            onClick={() => handleClick(item.action)}
            role="menuitem"
            type="button"
          >
            <span className="sidebar-project-menu-item__icon">
              {confirmAction === item.action ? (
                <span className="text-[14px] font-semibold text-[#f2a7a7]">!</span>
              ) : (
                item.icon
              )}
            </span>
            <span className="truncate text-left">
              {confirmAction === item.action ? "Haz clic para confirmar" : item.title}
            </span>
          </button>
        ))}
      </div>
    </SurfacePanel>
  );
}
