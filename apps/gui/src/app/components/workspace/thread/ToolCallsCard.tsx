import { useState } from "react";
import { Wrench } from "lucide-react";
import type { Message } from "../../../types";
import { stripAnsi } from "../../../utils/ansi";
import { getToolCallPreview, getToolCallTitle } from "../../../utils/thread-previews";
import {
  ChatWidgetBlock,
  chatWidgetItemClass,
  chatWidgetItemHoverClass,
} from "./ChatWidgetBlock";

type ToolCallMessage = Extract<Message, { role: "toolResult" | "bashExecution" }>;

type ToolCallsCardProps = {
  id: string;
  messages: ToolCallMessage[];
  expanded: boolean;
  forceExpanded?: boolean;
  onToggleGroupExpanded?: () => void;
  onToggleToolCallExpanded?: () => void;
};

const rawBlockClass =
  "m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.08] bg-black/15 px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-[color:var(--muted-2)]/90 [overflow-wrap:anywhere]";

function formatRawValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function renderToolCallRequest(message: ToolCallMessage) {
  const rawCall =
    message.role === "bashExecution"
      ? `$ ${message.command}`
      : formatRawValue({
          toolName: message.toolName,
          ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
          ...(message.toolInput !== undefined ? { input: message.toolInput } : {}),
        });

  return (
    <section className="grid min-w-0 gap-1.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]/80">
        Llamada
      </div>
      <pre className={rawBlockClass}>{stripAnsi(rawCall)}</pre>
    </section>
  );
}

function renderToolCallResult(message: ToolCallMessage) {
  if (message.role === "toolResult") {
    return (
      <div className="grid min-w-0 gap-2">
        <pre className={`${rawBlockClass} ${message.isError ? "!text-[#f2a7a7]" : ""}`}>
          {stripAnsi(message.content.join("\n\n"))}
        </pre>
        {message.images && message.images.length > 0 ? (
          <div className="grid min-w-0 gap-2">
            {message.images.map((image, index) => (
              <img
                key={`${image.src.slice(0, 48)}:${index}`}
                src={image.src}
                alt={image.alt}
                className="max-h-[420px] max-w-full rounded-lg border border-[rgba(169,178,215,0.12)] bg-[rgba(255,255,255,0.03)] object-contain"
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <pre className={rawBlockClass}>
      {stripAnsi(
        [
          message.output.length > 0 ? message.output.join("\n") : "Sin salida",
          `código de salida ${message.exitCode ?? "?"}${message.cancelled ? " · cancelado" : ""}${message.truncated ? " · truncado" : ""}`,
        ].join("\n"),
      )}
    </pre>
  );
}

function renderToolCallBody(message: ToolCallMessage) {
  return (
    <div className="grid min-w-0 gap-3 font-mono">
      {renderToolCallRequest(message)}
      <section className="grid min-w-0 gap-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]/80">
          Resultado
        </div>
        {renderToolCallResult(message)}
      </section>
    </div>
  );
}

export function ToolCallsCard({
  id,
  messages,
  expanded,
  forceExpanded = false,
  onToggleGroupExpanded,
  onToggleToolCallExpanded,
}: ToolCallsCardProps) {
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Record<string, boolean>>({});

  return (
    <ChatWidgetBlock
      expanded={expanded}
      onToggle={() => {
        if (forceExpanded) {
          return;
        }

        onToggleGroupExpanded?.();
      }}
      panelId={`tool-call-group-${id}`}
      bodyClassName="px-2 py-2"
      header={
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium text-[color:var(--muted)]/90">
            <Wrench size={14} className="shrink-0 text-[color:var(--muted-2)]/90" aria-hidden="true" />
            <span className="truncate">Uso de herramientas ({messages.length})</span>
          </span>
        </span>
      }
    >
      <div className="grid min-w-0 gap-1">
        {messages.map((message, index) => {
          const messageKey = `${message.id}:${index}`;
          const toolCallExpanded = expandedToolCallIds[messageKey] ?? false;
          const title = getToolCallTitle(message);
          const preview = getToolCallPreview(message);
          const isError = message.role === "toolResult" && message.isError;

          return (
            <ChatWidgetBlock
              key={messageKey}
              expanded={toolCallExpanded}
              onToggle={() => {
                onToggleToolCallExpanded?.();
                setExpandedToolCallIds((current) => ({
                  ...current,
                  [messageKey]: !toolCallExpanded,
                }));
              }}
              panelId={`tool-call-panel-${messageKey}`}
              className={chatWidgetItemClass}
              triggerClassName={`${chatWidgetItemHoverClass} rounded-lg px-2 py-2`}
              bodyClassName="!border-0 px-2 pt-0 pb-2"
              showChevron={false}
              header={
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                    <span className="shrink-0 truncate text-[13px] leading-[1.2] text-[color:var(--muted)]/92">
                      {title}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.2] text-[color:var(--muted-2)]/82">
                      {preview}
                    </span>
                  </span>
                  {isError ? (
                    <span className="shrink-0 text-[11.5px] font-medium text-[#f2a7a7]">Error</span>
                  ) : null}
                </>
              }
            >
              {renderToolCallBody(message)}
            </ChatWidgetBlock>
          );
        })}
      </div>
    </ChatWidgetBlock>
  );
}
