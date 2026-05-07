import { Archive, SquareTerminal, Star } from "lucide-react";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { ActivitySpinner } from "../../common/ActivitySpinner";
import { Tooltip } from "../../common/Tooltip";

type ThreadRowProps = {
  age: string;
  pinned?: boolean;
  running?: boolean;
  terminalRunning?: boolean;
  unread?: boolean;
  isSelected: boolean;
  title: string;
  onArchive: () => void;
  onOpen: () => void;
  onPin: () => void;
};

export function ThreadRow({
  age,
  pinned = false,
  running = false,
  terminalRunning = false,
  unread = false,
  isSelected,
  title,
  onArchive,
  onOpen,
  onPin,
}: ThreadRowProps) {
  return (
    <div
      className="sidebar-row-surface sidebar-thread-row"
      data-selected={isSelected ? "true" : "false"}
    >
      <button
        type="button"
        className="sidebar-row-hitbox"
        onClick={onOpen}
        aria-label={title}
        aria-current={isSelected ? "page" : undefined}
      />

      {running ? (
        <span className="sidebar-thread-leading-icon">
          <ActivitySpinner />
        </span>
      ) : unread ? (
        <span className="sidebar-thread-pin-indicator" aria-hidden="true" />
      ) : (
        <Tooltip
          content={pinned ? "Quitar chat de favoritos" : "Marcar chat como favorito"}
          placement="right"
        >
          <button
            type="button"
            className="sidebar-thread-pin"
            onClick={(event) => {
              event.stopPropagation();
              onPin();
            }}
            data-pinned={pinned ? "true" : "false"}
            data-selected={isSelected ? "true" : "false"}
            aria-label={pinned ? "Quitar chat de favoritos" : "Marcar chat como favorito"}
            aria-pressed={pinned}
          >
            <Star size={12} className={cn("absolute inset-0 m-auto", pinned && "fill-current")} />
          </button>
        </Tooltip>
      )}

      <span className="sidebar-thread-button" aria-hidden="true">
        <span className="truncate">{title}</span>
      </span>

      <span className="sidebar-thread-meta-slot">
        {terminalRunning ? (
          <span className="sidebar-thread-meta-value">
            <SquareTerminal size={12} />
          </span>
        ) : (
          <span className="sidebar-thread-meta-value" aria-hidden="true">
            {age}
          </span>
        )}
        <Tooltip content="Archivar chat" placement="right" className="sidebar-thread-meta-action">
          <button
            type="button"
            className={cn(compactIconButtonClass, "text-white hover:text-white")}
            onClick={(event) => {
              event.stopPropagation();
              onArchive();
            }}
            aria-label="Archivar chat"
          >
            <Archive size={12} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
