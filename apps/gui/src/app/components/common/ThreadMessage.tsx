import { memo, useEffect, useId, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { parseComposerAttachmentBlock } from "../../../../shared/composer-attachment-prompt";
import type { Message } from "../../types";
import { getThinkingPreview } from "../../utils/thread-previews";
import { ChatWidgetBlock } from "../workspace/thread/ChatWidgetBlock";
import { MarkdownContent } from "./MarkdownContent";
import { BotActivityMark } from "./BotActivityMark";
import { UserMessageAttachments } from "./UserMessageAttachments";

export type AssistantActivityState = {
  state: "active" | "complete";
  label?: string | null;
};

type ThreadMessageProps = {
  message: Message;
  assistantActivity?: AssistantActivityState | null;
  autoExpandThinking?: boolean;
  onToggleExpanded?: () => void;
  firstCardOnly?: boolean;
  disableInnerExpansion?: boolean;
  primaryToggleAction?: () => void;
};

function renderProse(content: string[], format: "prose" | "list" = "prose") {
  if (format === "list") {
    return (
      <MarkdownContent
        markdown={content.map((item) => `- ${item}`).join("\n")}
        className="gap-1.5"
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
      {content.map((paragraph) => (
        <MarkdownContent key={paragraph} markdown={paragraph} />
      ))}
    </div>
  );
}

function renderThinking(content: string[]) {
  return (
    <div className="grid min-w-0 gap-2 [overflow-wrap:anywhere]">
      {content.map((paragraph) => (
        <MarkdownContent
          key={paragraph}
          markdown={paragraph}
          tone="thinking"
          className="gap-1 text-[14px] leading-[1.62]"
        />
      ))}
    </div>
  );
}

function AssistantThinkingBlock({
  thinkingContent,
  thinkingHeaders,
  thinkingRedacted,
  autoExpandThinking = false,
  onToggleExpanded,
  interactive = true,
  primaryToggleAction,
}: {
  thinkingContent: string[];
  thinkingHeaders?: string[];
  thinkingRedacted?: boolean;
  autoExpandThinking?: boolean;
  onToggleExpanded?: () => void;
  interactive?: boolean;
  primaryToggleAction?: () => void;
}) {
  const [expanded, setExpanded] = useState(autoExpandThinking);
  const previousAutoExpandRef = useRef(autoExpandThinking);
  const panelId = useId();

  useEffect(() => {
    if (autoExpandThinking) {
      setExpanded(true);
    } else if (previousAutoExpandRef.current && !autoExpandThinking) {
      setExpanded(false);
    }

    previousAutoExpandRef.current = autoExpandThinking;
  }, [autoExpandThinking]);

  const label =
    thinkingRedacted && thinkingContent.length === 0 ? "Razonamiento no disponible" : "Razonando";
  const preview =
    thinkingHeaders && thinkingHeaders.length > 0
      ? thinkingHeaders.join(", ")
      : getThinkingPreview(thinkingContent, thinkingRedacted);

  return (
    <ChatWidgetBlock
      expanded={expanded}
      onToggle={() => {
        if (primaryToggleAction) {
          primaryToggleAction();
          return;
        }

        if (!interactive) {
          return;
        }

        onToggleExpanded?.();
        setExpanded((current) => !current);
      }}
      panelId={panelId}
      className="mb-3"
      interactive={interactive}
      showChevron={interactive}
      header={
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="flex shrink-0 items-center gap-1.5 truncate text-[13px] leading-[1.2] font-medium text-[color:var(--muted)]/90">
            <Brain size={14} className="shrink-0 text-[color:var(--muted-2)]/90" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
          <span className="shrink-0 text-[12px] leading-[1.2] text-[color:var(--muted-2)]/80">
            —
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.2] italic text-[color:var(--muted-2)]/90">
            {preview}
          </span>
        </span>
      }
    >
      {thinkingContent.length > 0 ? (
        renderThinking(thinkingContent)
      ) : (
        <div className="text-[13px] italic text-[color:var(--muted-2)]/82">
          Este proveedor ocultó el razonamiento.
        </div>
      )}
    </ChatWidgetBlock>
  );
}

function SummaryBlock({
  label,
  content,
}: {
  label: string;
  content: string[];
}) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[rgba(169,178,215,0.06)] bg-[rgba(255,255,255,0.018)]">
      <div className="border-b border-[rgba(169,178,215,0.05)] px-3 py-2 text-[13.5px] font-medium text-[color:var(--text)]">
        {label}
      </div>
      <div className="px-3 py-3">{renderThinking(content)}</div>
    </div>
  );
}

export const ThreadMessage = memo(function ThreadMessage({
  message,
  autoExpandThinking,
  onToggleExpanded,
  firstCardOnly,
  disableInnerExpansion,
  primaryToggleAction,
  assistantActivity,
}: ThreadMessageProps) {
  if (message.role === "user") {
    const parsedParagraphs = message.content.map((paragraph) =>
      parseComposerAttachmentBlock(paragraph),
    );
    const parsedUserContent = {
      paragraphs: parsedParagraphs.map((paragraph) => paragraph.text).filter(Boolean),
      attachmentPaths: parsedParagraphs.flatMap((paragraph) => paragraph.attachmentPaths),
    };

    return (
      <div className="grid min-w-0 gap-3">
        <div className="h-px w-full bg-white/10" />
        <div className="ml-auto w-fit max-w-[min(70%,36rem)] min-w-0 rounded-2xl bg-white/[0.075] px-4 py-2.5 text-[16px] leading-[1.6] text-[color:var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
          <div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
            {parsedUserContent.paragraphs.map((paragraph) => (
              <MarkdownContent
                key={paragraph}
                markdown={paragraph}
                tone="user"
                className="text-[16px] leading-[1.6]"
              />
            ))}
          </div>
          <UserMessageAttachments attachmentPaths={parsedUserContent.attachmentPaths} />
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    const hasThinking = Boolean(
      (message.thinkingContent && message.thinkingContent.length > 0) || message.thinkingRedacted,
    );
    const showAssistantContent = message.content.length > 0 && (!firstCardOnly || !hasThinking);

    return (
      <div className="min-w-0">
        {hasThinking ? (
          <AssistantThinkingBlock
            thinkingContent={message.thinkingContent ?? []}
            thinkingHeaders={message.thinkingHeaders}
            thinkingRedacted={message.thinkingRedacted}
            autoExpandThinking={autoExpandThinking}
            onToggleExpanded={onToggleExpanded}
            interactive={!disableInnerExpansion}
            primaryToggleAction={primaryToggleAction}
          />
        ) : null}
        {showAssistantContent ? (
          <div className="w-full max-w-full px-0 text-[16px] leading-[1.68] text-[color:var(--text)]">
            {renderProse(message.content, message.format)}
          </div>
        ) : null}
        {assistantActivity ? (
          <BotActivityMark
            state={assistantActivity.state}
            label={assistantActivity.label}
            className={showAssistantContent || hasThinking ? "mt-4" : undefined}
          />
        ) : null}
      </div>
    );
  }

  if (message.role === "toolResult") {
    return (
      <div className="grid min-w-0 gap-2 rounded-2xl border border-[color:var(--border)] bg-[rgba(255,255,255,0.025)] px-4 py-3">
        <div className="break-words text-[13px] uppercase tracking-[0.08em] text-[color:var(--muted)] [overflow-wrap:anywhere]">
          Herramienta · {message.toolName}
        </div>
        <div
          className={
            message.isError
              ? "min-w-0 text-[14px] text-[#f2a7a7]"
              : "min-w-0 text-[14px] text-[color:var(--text)]"
          }
        >
          {renderProse(message.content)}
        </div>
      </div>
    );
  }

  if (message.role === "bashExecution") {
    return (
      <div className="grid min-w-0 gap-2 rounded-2xl border border-[color:var(--border)] bg-[rgba(17,19,27,0.7)] px-4 py-3 font-mono text-[13px] text-[color:var(--text)]">
        <div className="whitespace-pre-wrap break-all text-[color:var(--muted)]">
          $ {message.command}
        </div>
        {message.output.length > 0 ? (
          <div className="grid min-w-0 gap-1 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
            {message.output.map((line) => (
              <p key={line} className="m-0 min-w-0">
                {line}
              </p>
            ))}
          </div>
        ) : (
          <div className="text-[color:var(--muted)]">Sin salida</div>
        )}
        <div className="text-[color:var(--muted)]">
          código de salida {message.exitCode ?? "?"}
          {message.cancelled ? " · cancelado" : ""}
          {message.truncated ? " · truncado" : ""}
        </div>
      </div>
    );
  }

  if (message.role === "custom") {
    return (
      <div className="grid min-w-0 gap-2 rounded-2xl border border-dashed border-[color:var(--border)] bg-[rgba(255,255,255,0.012)] px-4 py-3 text-[14px] text-[color:var(--text)]">
        <div className="break-words text-[13px] uppercase tracking-[0.08em] text-[color:var(--muted)] [overflow-wrap:anywhere]">
          {message.customType}
        </div>
        {renderProse(message.content)}
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className="grid min-w-0 gap-2 rounded-xl border border-[rgba(169,178,215,0.05)] bg-[rgba(255,255,255,0.01)] px-3 py-2 text-[13.5px] italic text-[color:var(--muted)]/92">
        <div className="break-words text-[12px] not-italic uppercase tracking-[0.08em] text-[color:var(--muted-2)]/84 [overflow-wrap:anywhere]">
          {message.label}
        </div>
        {renderThinking(message.content)}
      </div>
    );
  }

  if (message.role === "branchSummary" || message.role === "compactionSummary") {
    const label = message.role === "branchSummary" ? "Branch summary" : "Compaction summary";

    return <SummaryBlock label={label} content={message.content} />;
  }

  return null;
});
