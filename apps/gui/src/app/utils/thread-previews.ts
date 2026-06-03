import type { Message } from "../types";
import { stripAnsi } from "./ansi";

type ToolCallMessage = Extract<Message, { role: "toolResult" | "bashExecution" }>;

export function getThinkingPreview(thinkingContent: string[], thinkingRedacted?: boolean) {
  if (thinkingContent.length > 0) {
    return thinkingContent[0];
  }

  return thinkingRedacted ? "Reasoning unavailable" : "No reasoning captured";
}

export function getAssistantPreview(message: Message | null | undefined) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  return message.thinkingHeaders?.join(", ") ?? message.content[0] ?? null;
}

export function getToolCallTitle(message: ToolCallMessage) {
  if (message.role === "toolResult") {
    return message.toolName;
  }

  return "Shell";
}

export function getToolCallPreview(message: ToolCallMessage) {
  if (message.role === "toolResult") {
    return stripAnsi(message.content[0] ?? (message.isError ? "La herramienta falló." : "Herramienta finalizada."));
  }

  return stripAnsi(message.command || "Sin comando");
}
