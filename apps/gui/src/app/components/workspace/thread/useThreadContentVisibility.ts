import { useEffect, useRef, useState } from "react";

export function useThreadContentVisibility(hasConversation: boolean) {
  const [contentVisible, setContentVisible] = useState(hasConversation);
  const previousHasConversationRef = useRef(hasConversation);

  useEffect(() => {
    if (!hasConversation) {
      previousHasConversationRef.current = false;
      setContentVisible(false);
      return;
    }

    if (previousHasConversationRef.current) {
      setContentVisible(true);
      return;
    }

    previousHasConversationRef.current = true;
    const timeout = window.setTimeout(() => setContentVisible(true), 300);
    return () => window.clearTimeout(timeout);
  }, [hasConversation]);

  return contentVisible;
}
