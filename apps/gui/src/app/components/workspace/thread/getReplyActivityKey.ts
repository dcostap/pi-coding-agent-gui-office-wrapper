import type { Message } from "../../../types";

export function getReplyActivityKey(messages: readonly Message[]) {
  return messages
    .filter((message) => message.role !== "user")
    .map((message) => message.id)
    .join("|");
}
