import { ThreadTimeline } from "../components/workspace/thread/ThreadTimeline";
import type { Message } from "../types";

type ThreadViewProps = {
  messages: Message[];
  previousMessageCount: number;
  isStreaming: boolean;
  isCompacting: boolean;
  composerLayoutVersion: number;
  optimisticUserMessageText?: string | null;
  onLoadEarlierMessages: () => void;
};

export function ThreadView({
  messages,
  previousMessageCount,
  isStreaming,
  isCompacting,
  composerLayoutVersion,
  optimisticUserMessageText,
  onLoadEarlierMessages,
}: ThreadViewProps) {
  const hasOptimisticUserMessage = Boolean(optimisticUserMessageText?.trim());

  if (messages.length === 0 && !hasOptimisticUserMessage) {
    return <div className="h-full" />;
  }

  return (
    <ThreadTimeline
      messages={messages}
      previousMessageCount={previousMessageCount}
      isStreaming={isStreaming}
      isCompacting={isCompacting}
      composerLayoutVersion={composerLayoutVersion}
      optimisticUserMessageText={optimisticUserMessageText}
      onLoadEarlierMessages={() => {
        if (previousMessageCount === 0) {
          return;
        }

        onLoadEarlierMessages();
      }}
    />
  );
}
