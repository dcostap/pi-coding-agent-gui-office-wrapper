import {
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence";
import { cn } from "../../utils/cn";

type TooltipProps = PropsWithChildren<{
  content: ReactNode;
  placement?: "top" | "right";
  className?: string;
  contentClassName?: string;
}>;

export function Tooltip({
  content,
  placement = "top",
  className,
  contentClassName,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const present = useAnimatedPresence(open, 120);
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; x: number; y: number }>({
    left: 0,
    top: 0,
    x: -50,
    y: -100,
  });
  const [positionReady, setPositionReady] = useState(false);

  useLayoutEffect(() => {
    if (!present) {
      setPositionReady(false);
      return;
    }

    let animationFrame: number | null = null;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      const viewportPadding = 12;
      // Keep tooltips out of the custom/native titlebar strip. On Windows/Electron,
      // content placed into the draggable/titlebar area can be visually obscured by
      // the window controls even when portalled with a high z-index.
      const viewportTopPadding = 44;
      const tooltipWidth = tooltipRect?.width ?? 0;
      const tooltipHeight = tooltipRect?.height ?? 0;

      if (placement === "right") {
        let left = rect.right + 10;
        let x = 0;
        if (tooltipWidth > 0 && left + tooltipWidth > window.innerWidth - viewportPadding) {
          left = rect.left - 10;
          x = -100;
        }

        let top = rect.top + rect.height / 2;
        if (tooltipHeight > 0) {
          top = Math.min(
            window.innerHeight - viewportPadding - tooltipHeight / 2,
            Math.max(viewportTopPadding + tooltipHeight / 2, top),
          );
        }

        setPosition({ left, top, x, y: -50 });
        setPositionReady(true);
        return;
      }

      let left = rect.left + rect.width / 2;
      if (tooltipWidth > 0) {
        left = Math.min(
          window.innerWidth - viewportPadding - tooltipWidth / 2,
          Math.max(viewportPadding + tooltipWidth / 2, left),
        );
      } else {
        left = Math.min(window.innerWidth - viewportPadding, Math.max(viewportPadding, left));
      }

      let top = rect.top - 8;
      let y = -100;
      if (tooltipHeight > 0 && top - tooltipHeight < viewportTopPadding) {
        top = rect.bottom + 8;
        y = 0;
      }

      setPosition({ left, top, x: -50, y });
      setPositionReady(true);
    };

    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updatePosition();
      });
    };

    updatePosition();
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [present, placement]);

  return (
    <span
      ref={anchorRef}
      className={cn("tooltip-anchor", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? tooltipId : undefined}
    >
      {children}
      {present
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              data-open={open ? "true" : "false"}
              data-placement={placement}
              data-ready={positionReady ? "true" : "false"}
              style={
                {
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  "--tooltip-x": `${position.x}%`,
                  "--tooltip-y": `${position.y}%`,
                } as CSSProperties
              }
              className={cn("tooltip-content", contentClassName)}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
