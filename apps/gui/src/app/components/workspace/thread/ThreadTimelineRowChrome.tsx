import { ChevronDown, ChevronRight } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { chatRowShellClass } from "./thread-layout";

const clampOneLineClass =
  "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]";
const clampTwoLinesClass =
  "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]";
const clampThreeLinesClass =
  "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]";

export const foldedWidgetClass = "border border-white/10 bg-white/[0.04]";
export const foldedWidgetHoverClass = "hover:border-white/15 hover:bg-white/[0.06]";
export const foldedWidgetBodyClass = "border-white/10 bg-white/[0.018]";
export const foldedWidgetItemClass = "border border-white/[0.08] bg-white/[0.028]";
export const foldedWidgetItemHoverClass = "hover:bg-white/[0.05]";

export function FoldedTimelineRow({
  label,
  secondary,
  singleLine = false,
  italicLabel = false,
  mutedLabel = false,
  trailing,
  onToggle,
}: {
  label: string;
  secondary?: string | null;
  singleLine?: boolean;
  italicLabel?: boolean;
  mutedLabel?: boolean;
  trailing?: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`${foldedWidgetClass} ${foldedWidgetHoverClass} grid w-full min-w-0 gap-1 rounded-xl px-3 py-2.5 text-left transition-colors`}
      onClick={onToggle}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={`min-w-0 flex-1 text-[14px] font-medium leading-[1.4] ${mutedLabel ? "text-[color:var(--muted-2)]/90" : "text-[color:var(--text)]/92"} ${italicLabel ? "italic" : ""} ${singleLine || secondary || trailing ? clampOneLineClass : clampThreeLinesClass}`}
        >
          {label}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {secondary ? (
        <div
          className={`min-w-0 text-[13px] leading-[1.4] text-[color:var(--muted-2)]/90 ${clampTwoLinesClass}`}
        >
          {secondary}
        </div>
      ) : null}
    </button>
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest('button, a, input, textarea, select, summary, [data-no-row-toggle="true"]'),
  );
}

export function RowLeadToggleSurface({
  onToggle,
  children,
}: {
  onToggle?: () => void;
  children: ReactNode;
}) {
  if (!onToggle) {
    return <>{children}</>;
  }

  return (
    <div
      className="block w-full min-w-0 cursor-pointer text-left"
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        if (isInteractiveTarget(event.target)) {
          return;
        }

        onToggle();
      }}
    >
      {children}
    </div>
  );
}

export function TimelineRowShell({
  expanded,
  ariaLabel,
  onToggle,
  toggleClassName,
  togglePlacement = "left",
  children,
}: {
  expanded?: boolean;
  ariaLabel?: string;
  onToggle?: () => void;
  toggleClassName?: string;
  togglePlacement?: "left" | "right";
  children: ReactNode;
}) {
  const toggleButton = onToggle ? (
    <button
      type="button"
      className={`${toggleClassName ?? "mt-1"} inline-flex h-5 w-5 items-center justify-center rounded-md text-[color:var(--muted)] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[color:var(--text)]`}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={ariaLabel}
    >
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  ) : null;

  return (
    <div className={chatRowShellClass} data-row-toggle-anchor={onToggle ? "true" : undefined}>
      {togglePlacement === "left" ? toggleButton : <div />}
      <div className="min-w-0">{children}</div>
      {togglePlacement === "right" ? <div className="ml-2">{toggleButton}</div> : <div />}
    </div>
  );
}
