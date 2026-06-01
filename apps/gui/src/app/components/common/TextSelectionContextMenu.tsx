import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy } from "lucide-react";
import { copyTextToClipboardQuery } from "../../query/desktop-query";

type TextSelectionMenuState = {
  x: number;
  y: number;
  text: string;
} | null;

function getSelectedText() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return "";
  }

  return selection.toString().trim();
}

function getMenuPosition(event: MouseEvent) {
  const estimatedWidth = 150;
  const estimatedHeight = 40;
  const padding = 8;

  return {
    x: Math.min(event.clientX, window.innerWidth - estimatedWidth - padding),
    y: Math.min(event.clientY, window.innerHeight - estimatedHeight - padding),
  };
}

export function TextSelectionContextMenu() {
  const [menu, setMenu] = useState<TextSelectionMenuState>(null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const selectedText = getSelectedText();
      if (!selectedText) {
        setMenu(null);
        return;
      }

      event.preventDefault();
      setMenu({ ...getMenuPosition(event), text: selectedText });
    };

    const dismiss = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-text-selection-menu='true']")) {
        return;
      }

      setMenu(null);
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("scroll", dismiss, true);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);

  if (!menu) {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[2000] grid min-w-36 rounded-xl border border-white/10 bg-[rgba(24,24,24,0.96)] p-1.5 text-[13px] text-[color:var(--text)] shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      style={{ left: menu.x, top: menu.y }}
      data-text-selection-menu="true"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07]"
        onClick={() => {
          void copyTextToClipboardQuery(menu.text);
          setMenu(null);
        }}
      >
        <Copy size={13} /> Copiar texto
      </button>
    </div>,
    document.body,
  );
}
