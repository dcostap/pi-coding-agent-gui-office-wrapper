import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Message } from "../../../types";
import { BotActivityMark } from "../../common/BotActivityMark";
import type { AssistantActivityState } from "../../common/ThreadMessage";
import { CHAT_TEXT_MAX_WIDTH_CLASS } from "../../../ui/layout";
import { cn } from "../../../utils/cn";
import { ThreadTimelineRow } from "./ThreadTimelineRow";
import { buildTimelineRows } from "./buildTimelineRows";
import { CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX, isScrollContainerNearBottom } from "./chat-scroll";
import { chatScrollableAreaClass, chatViewportClass } from "./thread-layout";
import { buildThreadTimelineState } from "./thread-timeline-state";
import type { TimelineRow } from "./timeline-row";

type ThreadTimelineProps = {
  messages: Message[];
  previousMessageCount: number;
  isStreaming: boolean;
  isCompacting: boolean;
  composerLayoutVersion: number;
  onLoadEarlierMessages: () => void;
};

function formatAgentTurnDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) {
    return `Terminado en ${totalSeconds} ${totalSeconds === 1 ? "segundo" : "segundos"}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `Terminado en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }

  return `Terminado en ${minutes} ${minutes === 1 ? "minuto" : "minutos"} ${seconds} ${
    seconds === 1 ? "segundo" : "segundos"
  }`;
}

export function ThreadTimeline({
  messages,
  previousMessageCount,
  isStreaming,
  isCompacting,
  composerLayoutVersion,
  onLoadEarlierMessages,
}: ThreadTimelineProps) {
  const [collapsedRowIds, setCollapsedRowIds] = useState<Record<string, boolean>>({});
  const [expandedToolGroupIds, setExpandedToolGroupIds] = useState<Record<string, boolean>>({});
  const [, setNearBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingHistoryPrependRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const activeAgentTurnRef = useRef<{ startedAt: number; assistantMessageId: string | null } | null>(
    null,
  );
  const [assistantDurations, setAssistantDurations] = useState<Record<string, number>>({});


  const rows = useMemo<TimelineRow[]>(
    () => buildTimelineRows({ messages, previousMessageCount }),
    [messages, previousMessageCount],
  );

  const {
    bottomAnchorKey,
    effectiveCollapsedRowIds,
    foldableRows,
    latestTurnRowId,
    rowStructureSignature,
    streamingAssistantMessageId,
    streamingToolGroupId,
    streamingTurnRowId,
  } = useMemo(
    () =>
      buildThreadTimelineState({
        rows,
        messages,
        isStreaming,
        collapsedRowIds,
        expandedToolGroupIds,
      }),
    [collapsedRowIds, expandedToolGroupIds, isStreaming, messages, rows],
  );

  useEffect(() => {
    const activeTurn = activeAgentTurnRef.current;

    if (isStreaming) {
      if (!activeTurn) {
        activeAgentTurnRef.current = {
          startedAt: Date.now(),
          assistantMessageId: streamingAssistantMessageId,
        };
        return;
      }

      if (streamingAssistantMessageId && activeTurn.assistantMessageId !== streamingAssistantMessageId) {
        activeAgentTurnRef.current = {
          ...activeTurn,
          assistantMessageId: streamingAssistantMessageId,
        };
      }
      return;
    }

    if (activeTurn?.assistantMessageId) {
      const durationMs = Date.now() - activeTurn.startedAt;
      setAssistantDurations((current) => ({
        ...current,
        [activeTurn.assistantMessageId as string]: durationMs,
      }));
    }

    activeAgentTurnRef.current = null;
  }, [isStreaming, streamingAssistantMessageId]);

  useEffect(() => {
    setCollapsedRowIds((current) => {
      const next = foldableRows.reduce<Record<string, boolean>>((result, row) => {
        if (row.id === streamingTurnRowId) {
          result[row.id] = false;
          return result;
        }

        if (Object.prototype.hasOwnProperty.call(current, row.id)) {
          result[row.id] = current[row.id] as boolean;
          return result;
        }

        result[row.id] = row.id !== latestTurnRowId;
        return result;
      }, {});

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }

      return next;
    });
  }, [foldableRows, latestTurnRowId, streamingTurnRowId]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (programmaticScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }

    container.scrollTop = container.scrollHeight;
    shouldStickToBottomRef.current = true;
    setNearBottom(true);
    programmaticScrollFrameRef.current = window.requestAnimationFrame(() => {
      programmaticScrollFrameRef.current = null;
    });
  }, []);

  useEffect(
    () => () => {
      if (programmaticScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) {
        scrollToBottom();
      }
    });

    observer.observe(container);
    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    void bottomAnchorKey;
    void composerLayoutVersion;
    void rowStructureSignature;

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const pendingHistoryPrepend = pendingHistoryPrependRef.current;
    if (pendingHistoryPrepend) {
      const delta = container.scrollHeight - pendingHistoryPrepend.scrollHeight;
      container.scrollTop = pendingHistoryPrepend.scrollTop + Math.max(0, delta);
      pendingHistoryPrependRef.current = null;
      return;
    }

    if (!rows.length) {
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollToBottom();
    }
  }, [bottomAnchorKey, composerLayoutVersion, rowStructureSignature, rows.length, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (programmaticScrollFrameRef.current !== null) {
      return;
    }

    const nextNearBottom = isScrollContainerNearBottom(
      {
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      },
      CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
    );
    shouldStickToBottomRef.current = nextNearBottom;
    setNearBottom(nextNearBottom);
  }, []);

  const handleFoldEverything = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setExpandedToolGroupIds({});
    setCollapsedRowIds(
      foldableRows.reduce<Record<string, boolean>>((nextCollapsedRowIds, row) => {
        nextCollapsedRowIds[row.id] = row.id !== streamingTurnRowId;
        return nextCollapsedRowIds;
      }, {}),
    );
    window.requestAnimationFrame(scrollToBottom);
  }, [foldableRows, scrollToBottom, streamingTurnRowId]);

  useEffect(() => {
    const handleFoldAll = () => handleFoldEverything();
    const handleScrollToBottom = () => scrollToBottom();
    window.addEventListener("chat-timeline-fold-all", handleFoldAll);
    window.addEventListener("chat-timeline-scroll-to-bottom", handleScrollToBottom);
    return () => {
      window.removeEventListener("chat-timeline-fold-all", handleFoldAll);
      window.removeEventListener("chat-timeline-scroll-to-bottom", handleScrollToBottom);
    };
  }, [handleFoldEverything, scrollToBottom]);

  const handleToggleRowCollapse = useCallback(
    (rowId: string) => {
      if (rowId === streamingTurnRowId) {
        return;
      }

      shouldStickToBottomRef.current = false;
      setCollapsedRowIds((current) => ({
        ...current,
        [rowId]: !current[rowId],
      }));
    },
    [streamingTurnRowId],
  );

  const handleToggleToolCallExpansion = useCallback(() => {
    shouldStickToBottomRef.current = false;
  }, []);

  const handleToggleToolGroupExpansion = useCallback(
    (groupId: string) => {
      if (groupId === streamingToolGroupId) {
        return;
      }

      shouldStickToBottomRef.current = false;
      setExpandedToolGroupIds((current) => ({
        ...current,
        [groupId]: !current[groupId],
      }));
    },
    [streamingToolGroupId],
  );

  const getAssistantActivity = useCallback(
    (messageId: string): AssistantActivityState | null => {
      if (messageId === streamingAssistantMessageId) {
        return { state: "active", label: "Trabajando" };
      }

      const durationMs = assistantDurations[messageId];
      return {
        state: "complete",
        label: durationMs ? formatAgentTurnDuration(durationMs) : null,
      };
    },
    [assistantDurations, streamingAssistantMessageId],
  );

  const handleJumpToEarlierMessages = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      pendingHistoryPrependRef.current = {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
      };
    }

    shouldStickToBottomRef.current = false;
    onLoadEarlierMessages();
  }, [onLoadEarlierMessages]);

  const renderRow = useCallback(
    (row: TimelineRow) => (
      <div key={row.id} className="min-w-0" data-timeline-row-id={row.id}>
        <ThreadTimelineRow
          row={row}
          collapsed={Boolean(effectiveCollapsedRowIds[row.id])}
          streamingAssistantMessageId={streamingAssistantMessageId}
          streamingToolGroupId={streamingToolGroupId}
          expandedToolGroupIds={expandedToolGroupIds}
          getAssistantActivity={getAssistantActivity}
          onToggleRowCollapse={handleToggleRowCollapse}
          onToggleToolCallExpansion={handleToggleToolCallExpansion}
          onToggleToolGroupExpansion={handleToggleToolGroupExpansion}
          onJumpToEarlierMessages={handleJumpToEarlierMessages}
        />
      </div>
    ),
    [
      effectiveCollapsedRowIds,
      expandedToolGroupIds,
      getAssistantActivity,
      handleJumpToEarlierMessages,
      handleToggleRowCollapse,
      handleToggleToolCallExpansion,
      handleToggleToolGroupExpansion,
      streamingAssistantMessageId,
      streamingToolGroupId,
    ],
  );

  const showPendingAssistantActivity = isStreaming && !streamingAssistantMessageId;

  return (
    <div className={`${chatViewportClass} relative`}>
      <div
        ref={containerRef}
        className={cn(chatScrollableAreaClass, "ml-[0.5rem] mr-[0.5rem]")}
        onScroll={handleScroll}
      >
        <div
          ref={contentRef}
          className={`mx-auto flex min-h-full w-full min-w-0 flex-col justify-end ${CHAT_TEXT_MAX_WIDTH_CLASS} overflow-x-hidden px-4 pt-4 pb-4`}
        >
          <div className="grid min-w-0 gap-4">
            {rows.map(renderRow)}
            {showPendingAssistantActivity ? (
              <div className="grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)_24px] items-start gap-0 overflow-visible">
                <div />
                <BotActivityMark state="active" label="Trabajando" />
                <div />
              </div>
            ) : null}
          </div>
          <div ref={bottomSentinelRef} aria-hidden="true" className="h-px w-full" />
        </div>
      </div>
      {isCompacting ? (
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 z-20 flex justify-center">
          <div className="rounded-full border border-white/10 bg-[rgba(24,24,24,0.9)] px-3 py-2 text-[14px] text-[color:var(--text)] shadow-[0_18px_44px_rgba(0,0,0,0.36)] backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--muted)]" />
              <span>Compactando contexto de la sesión…</span>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
