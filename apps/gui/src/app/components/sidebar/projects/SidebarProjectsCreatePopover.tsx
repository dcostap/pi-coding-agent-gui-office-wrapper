import { FolderPlus } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnimatedDisclosure } from "../../../hooks/useAnimatedPresence";

type SidebarProjectsCreatePopoverProps = {
  menuId: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  draft: string;
  defaultLocation: string | null;
  busy: boolean;
  errorMessage: string | null;
  panelRef?: RefObject<HTMLDivElement | null>;
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
  const disclosure = useAnimatedDisclosure(open);
  const [style, setStyle] = useState<CSSProperties>({});
  void defaultLocation;
  const canCreate = draft.trim().length > 0 && !busy;

  useEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      setStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    inputRef.current?.focus();

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  if (!disclosure.present) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      id={menuId}
      role="dialog"
      aria-label="Añadir proyecto"
      data-open={disclosure.visible ? "true" : "false"}
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
    </div>,
    document.body,
  );
}
