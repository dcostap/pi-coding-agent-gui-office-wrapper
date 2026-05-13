import type { CSSProperties, ReactNode } from "react";
import { cn } from "../utils/cn";

type ShellSideDockProps = {
  side: "left" | "right";
  collapsed: boolean;
  width: number | string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
  keepMounted?: boolean;
};

function toCssWidth(width: number | string) {
  return typeof width === "number" ? `${width}px` : width;
}

export function ShellSideDock({
  side,
  collapsed,
  width,
  children,
  className,
  contentClassName,
  style,
  keepMounted = false,
}: ShellSideDockProps) {
  const open = !collapsed;
  const resolvedWidth = toCssWidth(width);

  return (
    <div
      data-shell-side-dock={side}
      data-open={open ? "true" : "false"}
      className={cn("shell-side-dock relative min-w-0 shrink-0 overflow-hidden", className)}
      style={{ ...style, "--shell-side-dock-width": resolvedWidth } as CSSProperties}
    >
      {open || keepMounted ? (
        <div
          className={cn(
            "h-full overflow-hidden",
            side === "right" && "absolute inset-y-0 right-0",
            open ? "pointer-events-auto" : "pointer-events-none",
            contentClassName,
          )}
          aria-hidden={open ? undefined : true}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
