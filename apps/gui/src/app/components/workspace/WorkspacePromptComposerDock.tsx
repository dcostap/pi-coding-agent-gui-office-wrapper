import { ArrowDownToLine, ListCollapse } from "lucide-react";
import type { ReactNode } from "react";
import type { ComposerQueuedPrompt } from "../../desktop/types";
import { compactIconButtonClass } from "../../ui/classes";
import { cn } from "../../utils/cn";
import { Tooltip } from "../common/Tooltip";
import { Composer, type ComposerProps } from "./Composer";
import { QueuedPromptsCard } from "./composer/QueuedPromptsCard";
import { useThreadTimelineControls } from "./thread/threadTimelineControls";

const timelineQuickActionButtonClass =
  "pointer-events-auto h-6 w-6 shrink-0 rounded-full bg-[color:var(--brand-secondary-bg)] hover:bg-[color:var(--brand-secondary-bg-strong)] disabled:cursor-not-allowed disabled:opacity-45";

type WorkspaceFooterLaneProps = {
  children: ReactNode;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
};

type WorkspacePromptComposerDockProps = {
  composerProps: ComposerProps;
  header?: ReactNode;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
  pendingPromptIds?: string[];
  prompts: ComposerQueuedPrompt[];
  showTimelineQuickActions?: boolean;
  onEditPrompt: (prompt: ComposerQueuedPrompt) => void;
  onRemovePrompt: (prompt: ComposerQueuedPrompt) => void;
};

function DefaultRail() {
  return <div className="mb-1.5 min-w-0 self-end" />;
}

function ThreadTimelineQuickActions() {
  const { canFoldAll, canScrollToBottom, foldAll, scrollToBottom } = useThreadTimelineControls();

  return (
    <div className="pointer-events-none flex w-7 flex-col items-center gap-1.5 self-center">
      <Tooltip
        content="Contraer todos los mensajes de este chat"
        placement="top"
        className="pointer-events-auto"
      >
        <button
          type="button"
          className={cn(compactIconButtonClass, timelineQuickActionButtonClass)}
          onClick={foldAll}
          disabled={!canFoldAll}
          aria-label="Contraer todos los mensajes de este chat"
        >
          <ListCollapse size={13} strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip content="Ir al final" placement="top" className="pointer-events-auto">
        <button
          type="button"
          className={cn(compactIconButtonClass, timelineQuickActionButtonClass)}
          onClick={scrollToBottom}
          disabled={!canScrollToBottom}
          aria-label="Ir al final"
        >
          <ArrowDownToLine size={13} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );
}

export function WorkspaceFooterLane({ children, leftRail, rightRail }: WorkspaceFooterLaneProps) {
  return (
    <div className="pointer-events-auto grid gap-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,calc(840px+2rem+0.75rem))_minmax(0,1fr)] items-end gap-3">
        {leftRail ?? <DefaultRail />}
        <div className="grid w-full max-w-[calc(840px+2rem+0.75rem)] gap-0">{children}</div>
        {rightRail ?? <DefaultRail />}
      </div>
    </div>
  );
}

export function WorkspacePromptComposerDock({
  composerProps,
  header,
  leftRail,
  pendingPromptIds = [],
  prompts,
  rightRail,
  showTimelineQuickActions = true,
  onEditPrompt,
  onRemovePrompt,
}: WorkspacePromptComposerDockProps) {
  return (
    <WorkspaceFooterLane leftRail={leftRail} rightRail={rightRail}>
      {header}
      <QueuedPromptsCard
        prompts={prompts}
        pendingPromptIds={pendingPromptIds}
        onEditPrompt={onEditPrompt}
        onRemovePrompt={onRemovePrompt}
      />
      <div className="grid grid-cols-[minmax(0,840px)_2rem] items-center gap-3">
        <Composer {...composerProps} />
        {showTimelineQuickActions ? <ThreadTimelineQuickActions /> : <div className="w-7" />}
      </div>
    </WorkspaceFooterLane>
  );
}
