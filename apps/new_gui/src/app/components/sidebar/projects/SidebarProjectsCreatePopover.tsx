import { FolderPlus } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";

type SidebarProjectsCreatePopoverProps = {
  menuId: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  draft: string;
  defaultLocation: string | null;
  busy: boolean;
  errorMessage: string | null;
  panelRef?: RefObject<HTMLDialogElement | null>;
  onChangeDraft: (value: string) => void;
  onCreate: () => void;
  onClose: () => void;
};

export function SidebarProjectsCreatePopover({
  menuId,
  open,
  anchorRef,
  draft,
  defaultLocation,
  busy,
  errorMessage,
  panelRef,
  onChangeDraft,
  onCreate,
  onClose,
}: SidebarProjectsCreatePopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const canCreate = draft.trim().length > 0 && !busy && Boolean(defaultLocation);

  useEffect(() => {
    if (!open) {
      return;
    }

    const anchor = anchorRef.current;
    if (anchor) {
      setStyle({
        top: anchor.offsetTop + anchor.offsetHeight + 6,
        left: anchor.offsetLeft,
        width: anchor.offsetWidth,
      });
    }

    inputRef.current?.focus();
  }, [anchorRef, open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={panelRef}
      id={menuId}
      open
      aria-label="Añadir proyecto"
      data-open={open ? "true" : "false"}
      className="sidebar-popover-panel sidebar-project-create-popover motion-popover"
      style={style}
    >
      <div className="sidebar-project-create-row">
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCreate();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          className="sidebar-project-create-input"
          placeholder="Nombre del proyecto"
          aria-label="Nombre del proyecto"
        />

        <button
          type="button"
          className="sidebar-project-create-submit"
          onClick={onCreate}
          disabled={!canCreate}
          data-enabled={canCreate ? "true" : "false"}
          aria-label={busy ? "Añadiendo proyecto" : "Añadir proyecto"}
          data-tooltip={busy ? "Añadiendo proyecto" : "Añadir proyecto"}
        >
          <FolderPlus size={15} />
        </button>
      </div>
      {errorMessage ? <div className="sidebar-inline-error">{errorMessage}</div> : null}
    </dialog>
  );
}
