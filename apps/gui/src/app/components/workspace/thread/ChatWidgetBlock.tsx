import type { ReactNode } from "react";
import { ExpandablePanel } from "../../common/ExpandablePanel";
import { cn } from "../../../utils/cn";

export const chatWidgetClass = "border border-white/10 bg-white/[0.04]";
export const chatWidgetHoverClass = "hover:border-white/15 hover:bg-white/[0.06]";
export const chatWidgetBodyClass = "border-white/10 bg-white/[0.018]";
export const chatWidgetItemClass = "border border-white/[0.08] bg-white/[0.028]";
export const chatWidgetItemHoverClass = "hover:bg-white/[0.05]";

export function ChatWidgetBlock({
  expanded,
  onToggle,
  panelId,
  header,
  children,
  className,
  triggerClassName,
  bodyClassName,
  interactive = true,
  showChevron = true,
}: {
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
  header: ReactNode;
  children?: ReactNode;
  className?: string;
  triggerClassName?: string;
  bodyClassName?: string;
  interactive?: boolean;
  showChevron?: boolean;
}) {
  return (
    <ExpandablePanel
      expanded={expanded}
      onToggle={onToggle}
      panelId={panelId}
      className={cn(chatWidgetClass, className)}
      triggerClassName={cn(chatWidgetHoverClass, triggerClassName)}
      bodyClassName={cn(chatWidgetBodyClass, bodyClassName)}
      interactive={interactive}
      showChevron={showChevron}
      header={header}
    >
      {children}
    </ExpandablePanel>
  );
}
