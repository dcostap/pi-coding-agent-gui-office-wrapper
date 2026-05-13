import { X } from "lucide-react";
import { useRef } from "react";
import type { AppToast } from "../../hooks/useToast";
import { cn } from "../../utils/cn";
import { MarkdownContent } from "./MarkdownContent";

type GlobalToastsProps = {
  toasts: AppToast[];
  onDismiss: (id: string) => void;
};

function getToastToneClass(tone: AppToast["tone"]) {
  switch (tone) {
    case "success":
      return "border-emerald-300/30 bg-[rgba(22,42,32,0.88)] shadow-[0_18px_44px_rgba(0,0,0,0.34),inset_3px_0_0_rgba(110,231,183,0.8)]";
    case "warning":
      return "border-amber-300/30 bg-[rgba(48,38,21,0.9)] shadow-[0_18px_44px_rgba(0,0,0,0.34),inset_3px_0_0_rgba(251,191,36,0.85)]";
    case "error":
      return "border-rose-300/35 bg-[rgba(48,25,28,0.92)] shadow-[0_18px_44px_rgba(0,0,0,0.36),inset_3px_0_0_rgba(251,113,133,0.9)]";
    case "info":
    default:
      return "border-white/12 bg-[rgba(31,31,31,0.9)] shadow-[0_18px_44px_rgba(0,0,0,0.34),inset_3px_0_0_rgba(216,216,216,0.55)]";
  }
}

export function GlobalToasts({ toasts, onDismiss }: GlobalToastsProps) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-11 left-1/2 z-[10000] flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-open={toast.visible ? "true" : "false"}
          className="global-toast-slot"
        >
          <div
            ref={(element) => {
              if (element) {
                itemRefs.current.set(toast.id, element);
                element.parentElement?.style.setProperty(
                  "--toast-height",
                  `${element.scrollHeight}px`,
                );
              } else {
                itemRefs.current.delete(toast.id);
              }
            }}
            data-open={toast.visible ? "true" : "false"}
            className={cn(
              "global-toast pointer-events-auto grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border px-4 py-3 text-[13px] text-[color:var(--text)] backdrop-blur-xl backdrop-saturate-[140%]",
              getToastToneClass(toast.tone),
            )}
          >
            <MarkdownContent
              markdown={toast.message}
              className="gap-1 text-[13px] leading-[1.45] [&_p]:leading-[1.45]"
            />
            <button
              type="button"
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-white/10 hover:text-[color:var(--text)]"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
