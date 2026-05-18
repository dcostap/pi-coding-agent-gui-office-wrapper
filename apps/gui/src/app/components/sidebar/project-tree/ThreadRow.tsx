import { Archive, SquareTerminal, Star } from "lucide-react";
import { useRef, useState } from "react";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { useDismissibleLayer } from "../../../hooks/useDismissibleLayer";
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
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archivedLocally, setArchivedLocally] = useState(false);
  const archiveActionRef = useRef<HTMLButtonElement>(null);

  useDismissibleLayer({
    open: confirmArchive,
    onDismiss: () => setConfirmArchive(false),
    refs: [archiveActionRef],
  });

  if (archivedLocally) {
    return null;
  }

  return (
    <div
      className="sidebar-row-surface sidebar-thread-row"
      data-selected={isSelected ? "true" : "false"}
    >
      <button
        type="button"
        className="sidebar-row-hitbox"
        onClick={() => {
          setConfirmArchive(false);
          onOpen();
        }}
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
              setConfirmArchive(false);
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

      <span
        className="sidebar-thread-meta-slot"
        data-confirming={confirmArchive ? "true" : "false"}
      >
        {terminalRunning ? (
          <span className="sidebar-thread-meta-value">
            <SquareTerminal size={12} />
          </span>
        ) : (
          <span className="sidebar-thread-meta-value" aria-hidden="true">
            {age}
          </span>
        )}
        {confirmArchive ? (
          <button
            ref={archiveActionRef}
            type="button"
            className="sidebar-thread-confirm-action"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmArchive(false);
              setArchivedLocally(true);
              onArchive();
            }}
            aria-label="Confirmar archivar chat"
          >
            <span className="sidebar-thread-confirm-action__icon" aria-hidden="true">
              !
            </span>
            <span className="truncate">Confirmar</span>
          </button>
        ) : (
          <Tooltip content="Archivar chat" placement="right" className="sidebar-thread-meta-action">
            <button
              ref={archiveActionRef}
              type="button"
              className={cn(compactIconButtonClass, "text-white hover:text-white")}
              onClick={(event) => {
                event.stopPropagation();
                setConfirmArchive(true);
              }}
              aria-label="Archivar chat"
            >
              <Archive size={12} />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
