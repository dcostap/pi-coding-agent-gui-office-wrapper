import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export type AppToast = {
  id: string;
  message: string;
  tone: ToastTone;
  createdAt: number;
  timeoutMs: number;
  visible: boolean;
};

type ToastInput = string | { message: string; tone?: ToastTone; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 5200;
const TOAST_EVENT_NAME = "office-agent:toast";
let toastCounter = 0;

function normalizeToast(input: ToastInput, fallbackTimeoutMs: number): AppToast {
  const toast = typeof input === "string" ? { message: input } : input;
  toastCounter += 1;
  return {
    id: `toast-${Date.now()}-${toastCounter}`,
    message: toast.message,
    tone: toast.tone ?? "info",
    createdAt: Date.now(),
    timeoutMs: toast.timeoutMs ?? fallbackTimeoutMs,
    visible: false,
  };
}

export function showGlobalToast(input: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT_NAME, { detail: input }));
}

export function useToast(defaultTimeoutMs = DEFAULT_TIMEOUT_MS) {
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const timersRef = useRef<Record<string, number>>({});
  const revealTimersRef = useRef<Record<string, number>>({});

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current[id];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete timersRef.current[id];
    }
    const revealTimer = revealTimersRef.current[id];
    if (revealTimer !== undefined) {
      window.clearTimeout(revealTimer);
      delete revealTimersRef.current[id];
    }
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast)),
    );
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 180);
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      const toast = normalizeToast(input, defaultTimeoutMs);
      setToasts((current) => [toast, ...current].slice(0, 5));
      // Mount hidden first, then flip data-open after the closed state has painted.
      // If a toast is inserted already-visible, CSS transitions have no previous state
      // to animate from, so it appears instantly.
      revealTimersRef.current[toast.id] = window.setTimeout(() => {
        delete revealTimersRef.current[toast.id];
        setToasts((current) =>
          current.map((currentToast) =>
            currentToast.id === toast.id ? { ...currentToast, visible: true } : currentToast,
          ),
        );
      }, 30);
      timersRef.current[toast.id] = window.setTimeout(() => dismissToast(toast.id), toast.timeoutMs);
      return toast.id;
    },
    [defaultTimeoutMs, dismissToast],
  );

  useEffect(() => {
    const handleToast = (event: Event) => {
      showToast((event as CustomEvent<ToastInput>).detail);
    };
    window.addEventListener(TOAST_EVENT_NAME, handleToast);
    return () => window.removeEventListener(TOAST_EVENT_NAME, handleToast);
  }, [showToast]);

  useEffect(
    () => () => {
      for (const timer of Object.values(timersRef.current)) {
        window.clearTimeout(timer);
      }
      for (const timer of Object.values(revealTimersRef.current)) {
        window.clearTimeout(timer);
      }
      timersRef.current = {};
      revealTimersRef.current = {};
    },
    [],
  );

  return {
    toast: toasts[0]?.message ?? null,
    toasts,
    showToast,
    dismissToast,
  };
}
