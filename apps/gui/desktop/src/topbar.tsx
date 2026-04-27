import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction } from "react";
import type { AppView, DesktopAppState, SessionRecord, WorkspaceRecord } from "./desktop-state";
import { FolderIcon } from "./icons";
import type { PiDesktopApi } from "./ipc";

interface TopbarProps {
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: PiDesktopApi,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
}

export function Topbar(props: TopbarProps) {
  const {
    activeView,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    api,
    setSnapshot,
    updateSnapshot,
  } = props;

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".topbar__actions")) {
      return;
    }

    void api.toggleWindowMaximize();
  };

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span className="topbar__workspace">
          {selectedWorkspace ? selectedWorkspace.name : "Create or import a project to begin"}
        </span>
        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && selectedWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New thread</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <button
          aria-label="Import folder"
          className="icon-button topbar__icon"
          type="button"
          onClick={() => {
            void updateSnapshot(api, setSnapshot, () => api.pickImportFolder());
          }}
        >
          <FolderIcon />
        </button>
      </div>
    </header>
  );
}
