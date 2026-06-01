import { useEffect, useRef } from "react";
import { AppShellLayout } from "./app-shell/AppShellLayout";
import { useAppShellController } from "./app-shell/useAppShellController";

export function AppShell() {
  const controller = useAppShellController();
  const lastWheelZoomAtRef = useRef(0);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoomAtRef.current < 80) {
        return;
      }

      lastWheelZoomAtRef.current = now;
      const commandId = event.deltaY < 0 ? "view.zoomIn" : "view.zoomOut";
      void window.piDesktop?.runTitleBarCommand?.(commandId);
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, []);

  return <AppShellLayout controller={controller} />;
}
