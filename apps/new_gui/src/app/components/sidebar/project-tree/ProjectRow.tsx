import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Github, MoreHorizontal, SquarePen } from "lucide-react";
import { useEffect, useRef } from "react";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { Tooltip } from "../../common/Tooltip";

type ProjectRowProps = {
  actionMenuId: string;
  actionMenuOpen: boolean;
  dragHandleProps?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
  };
  canEdit: boolean;
  canToggleExpanded: boolean;
  isActive: boolean;
  isDragging: boolean;
  isExpanded: boolean;
  hasRepoOrigin: boolean;
  name: string;
  renameDraft: string;
  isEditing: boolean;
  showActions: boolean;
  threadGroupId: string;
  onCancelEdit: () => void;
  onChangeRenameDraft: (value: string) => void;
  onEdit: () => void;
  onCreateSession: () => void;
  onSelect: () => void;
  onSubmitEdit: () => void;
  onToggleActions: () => void;
  onToggleExpanded: () => void;
};

export function ProjectRow({
  actionMenuId,
  actionMenuOpen,
  canEdit,
  canToggleExpanded,
  isActive,
  isDragging,
  isExpanded,
  hasRepoOrigin,
  name,
  renameDraft,
  isEditing,
  showActions,
  threadGroupId,
  onCancelEdit,
  onChangeRenameDraft,
  onEdit,
  onCreateSession,
  onSelect,
  onSubmitEdit,
  onToggleActions,
  onToggleExpanded,
}: ProjectRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleRowClick = () => {
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = window.setTimeout(() => {
      if (canToggleExpanded) {
        onToggleExpanded();
      } else {
        onSelect();
      }
      clickTimeoutRef.current = null;
    }, 180);
  };

  const handleRowDoubleClick = () => {
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    if (canEdit) {
      onEdit();
    }
  };

  return (
    <div
      className="sidebar-row-surface sidebar-project-row"
      data-highlighted={isActive || actionMenuOpen ? "true" : "false"}
      data-dragging={isDragging ? "true" : "false"}
    >
      <button
        type="button"
        className="sidebar-project-toggle"
        onClick={canToggleExpanded ? onToggleExpanded : undefined}
        data-can-toggle={canToggleExpanded ? "true" : "false"}
        aria-label={isExpanded ? "Contraer carpeta" : "Expandir carpeta"}
        aria-expanded={isExpanded}
        aria-controls={threadGroupId}
        disabled={!canToggleExpanded}
      >
        {hasRepoOrigin ? (
          <Github size={14} className="sidebar-project-icon sidebar-project-origin-icon" />
        ) : isExpanded ? (
          <FolderOpen size={14} className="sidebar-project-icon sidebar-project-origin-icon" />
        ) : (
          <Folder size={14} className="sidebar-project-icon sidebar-project-origin-icon" />
        )}
        {isExpanded ? (
          <ChevronDown size={12} className="sidebar-project-icon sidebar-project-chevron-icon" />
        ) : (
          <ChevronRight size={12} className="sidebar-project-icon sidebar-project-chevron-icon" />
        )}
      </button>

      {isEditing ? (
        <div className="sidebar-project-edit">
          <input
            ref={inputRef}
            value={renameDraft}
            onChange={(event) => onChangeRenameDraft(event.target.value)}
            onBlur={onCancelEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitEdit();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onCancelEdit();
              }
            }}
            className="sidebar-project-input"
            aria-label={`Renombrar ${name}`}
          />
        </div>
      ) : (
        <div
          className="sidebar-project-button"
          onClick={handleRowClick}
          onDoubleClick={canEdit ? handleRowDoubleClick : undefined}
          data-active={isActive ? "true" : "false"}
        >
          <span className="sidebar-project-title">{name}</span>
        </div>
      )}

      <div
        className="sidebar-project-actions"
        data-open={actionMenuOpen ? "true" : "false"}
        data-dragging={isDragging ? "true" : "false"}
        data-editing={isEditing ? "true" : "false"}
        data-visible={showActions ? "true" : "false"}
      >
        <Tooltip content="Nueva sesión" placement="right">
          <button
            type="button"
            className={compactIconButtonClass}
            onClick={onCreateSession}
            aria-label={`Iniciar una nueva sesión en ${name}`}
          >
            <SquarePen size={14} />
          </button>
        </Tooltip>

        <Tooltip content="Acciones del proyecto" placement="right">
          <button
            type="button"
            className={cn(
              compactIconButtonClass,
              actionMenuOpen && "bg-[rgba(255,255,255,0.05)] text-[color:var(--text)]",
            )}
            onClick={onToggleActions}
            aria-label="Acciones del proyecto"
            aria-haspopup="menu"
            aria-expanded={actionMenuOpen}
            aria-controls={actionMenuId}
          >
            <MoreHorizontal size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
