import { useEffect, useRef } from "react";

function isProjectMenuClick(target: Node | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(".sidebar-project-action-menu") ||
      target.closest('[aria-controls^="project-actions-"]'),
  );
}

export function useProjectMenuDismiss(open: boolean, onDismiss: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const clickedInsideLegacyContainer = containerRef.current?.contains(target) ?? false;

      if (!isProjectMenuClick(target) && !clickedInsideLegacyContainer) {
        onDismiss();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDismiss();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDismiss, open]);

  return { containerRef };
}
