import { useEffect, useState } from "react";

const DEFAULT_EXIT_MS = 300;

export function useAnimatedPresence(open: boolean, exitMs = DEFAULT_EXIT_MS) {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }

    const timeoutId = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(timeoutId);
  }, [exitMs, open]);

  return open || present;
}

export function useAnimatedDisclosure(open: boolean, exitMs = DEFAULT_EXIT_MS) {
  const present = useAnimatedPresence(open, exitMs);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!present || !open) {
      setVisible(false);
      return;
    }

    // Let the closed state paint first. A plain rAF can be coalesced with mount in Electron,
    // which makes popovers appear instantly instead of transitioning.
    const timeoutId = window.setTimeout(() => setVisible(true), 35);
    return () => window.clearTimeout(timeoutId);
  }, [open, present]);

  return {
    present,
    visible: present && visible && open,
  };
}
