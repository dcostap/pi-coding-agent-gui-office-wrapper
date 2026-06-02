import type { Message } from "../../../types";

export function getReplyActivityKey(messages: readonly Message[]) {
  return messages.map((message) => message.id).join("|");
}
