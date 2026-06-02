import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type ThreadTimelineControls = {
  canFoldAll: boolean;
  canScrollToBottom: boolean;
  foldAll: () => void;
  scrollToBottom: () => void;
};

const noop = () => {};

const defaultThreadTimelineControls: ThreadTimelineControls = {
  canFoldAll: false,
  canScrollToBottom: false,
  foldAll: noop,
  scrollToBottom: noop,
};

type ThreadTimelineControlsContextValue = {
  controls: ThreadTimelineControls;
  setControls: Dispatch<SetStateAction<ThreadTimelineControls>> | null;
};

const ThreadTimelineControlsContext = createContext<ThreadTimelineControlsContextValue>({
  controls: defaultThreadTimelineControls,
  setControls: null,
});

type ThreadTimelineControlsProviderProps = {
  children: ReactNode;
};

export function ThreadTimelineControlsProvider({ children }: ThreadTimelineControlsProviderProps) {
  const [controls, setControls] = useState<ThreadTimelineControls>(defaultThreadTimelineControls);

  const value = useMemo<ThreadTimelineControlsContextValue>(
    () => ({ controls, setControls }),
    [controls],
  );

  return (
    <ThreadTimelineControlsContext.Provider value={value}>
      {children}
    </ThreadTimelineControlsContext.Provider>
  );
}

export function useThreadTimelineControls() {
  return useContext(ThreadTimelineControlsContext).controls;
}

export function useRegisterThreadTimelineControls(controls: ThreadTimelineControls) {
  const { setControls } = useContext(ThreadTimelineControlsContext);

  useEffect(() => {
    if (!setControls) return;
    setControls(controls);
  }, [controls, setControls]);

  useEffect(() => {
    if (!setControls) return;
    return () => setControls(defaultThreadTimelineControls);
  }, [setControls]);
}
