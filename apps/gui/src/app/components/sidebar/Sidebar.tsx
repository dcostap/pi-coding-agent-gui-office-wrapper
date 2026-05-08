import { FolderPlus, SquarePen } from "lucide-react";
import { useRef, useState } from "react";
import type { AppSettings, DesktopActionInvoker, InboxThread } from "../../desktop/types";
import type { ChatSidebarState } from "../../desktop/types";
import type { Project, View } from "../../types";

type SidebarNavigableView = Exclude<View, "gitops">;
import { NavButton } from "../common/NavButton";
import { SidebarChatSection } from "./chat/SidebarChatSection";
import { SidebarInboxSection } from "./inbox/SidebarInboxSection";
import { SidebarProjectsSection } from "./projects/SidebarProjectsSection";

type SidebarProps = {
  projects: Project[];
  inboxThreads: InboxThread[];
  chatSidebarState: ChatSidebarState | null;
  appLaunchedAtMs: number;
  appSettings: AppSettings;
  protectedProjectId?: string | null;
  activeView: View;
  selectedInboxSessionPath: string | null;
  selectedThreadId: string | null;
  selectedChatGroupId: string | null;
  settingsOpen: boolean;
  projectScopeLockActive: boolean;
  terminalRunningProjectIds: ReadonlySet<string>;
  terminalRunningSessionPaths: ReadonlySet<string>;
  collapsedProjectIds: Record<string, boolean>;
  onAction: DesktopActionInvoker;
  onShowView: (view: SidebarNavigableView) => void;
  onToggleSettings: () => void;
  onOpenExtensionsView: () => void;
  onOpenSkillsView: () => void;
  onOpenSettingsPanel: () => void;
  onOpenArchivedThreads: () => void;
  onDismissInboxThread: (thread: InboxThread) => void;
  onCreateChatGroup: (name: string) => Promise<unknown>;
  onSelectChatGroup: (groupId: string | null) => void;
  onNewChat: (groupId: string | null) => void;
  onStartUnassignedChat: () => void;
  onStartProjectChat: (projectId: string, projectName?: string) => void;
  onRefreshChatSidebar: () => Promise<unknown>;
  onProjectSelect: (projectId: string) => void;
  onProjectReorder: (projectIds: string[]) => void;
  onLoadProjectThreads: (projectId: string, options?: { chat?: boolean }) => Promise<unknown>;
  onSelectInboxThread: (thread: InboxThread) => void;
  onThreadOpen: (projectId: string, threadId: string, sessionPath: string) => void;
  onToggleProjectCollapse: (projectId: string) => void;
};

export function Sidebar({
  projects,
  inboxThreads,
  chatSidebarState,
  appLaunchedAtMs,
  appSettings,
  protectedProjectId = null,
  activeView,
  selectedInboxSessionPath,
  selectedThreadId,
  selectedChatGroupId,
  projectScopeLockActive,
  terminalRunningProjectIds,
  terminalRunningSessionPaths,
  collapsedProjectIds,
  onAction,
  onShowView,

  onDismissInboxThread,
  onCreateChatGroup,
  onSelectChatGroup,
  onNewChat,
  onStartUnassignedChat,
  onStartProjectChat,
  onRefreshChatSidebar,
  onProjectSelect,
  onProjectReorder,
  onLoadProjectThreads,
  onSelectInboxThread,
  onThreadOpen,
  onToggleProjectCollapse,
}: SidebarProps) {
  const [projectCreateRequestId, setProjectCreateRequestId] = useState(0);
  const projectCreateButtonRef = useRef<HTMLButtonElement>(null);
  const showModeSelection = activeView !== "extensions" && activeView !== "skills";

  return (
    <aside
      aria-label="Workspace sidebar"
      data-pulse-active={projectScopeLockActive ? "true" : "false"}
      className="sidebar-shell motion-surface-pulse motion-sidebar-selection-pulse relative"
    >
      {showModeSelection ? (
        <nav className="sidebar-mode-nav" aria-label="Primary navigation">
          <NavButton
            icon={<SquarePen size={16} />}
            label="Nuevo chat"
            active={false}
            onClick={onStartUnassignedChat}
          />
          <NavButton
            ref={projectCreateButtonRef}
            icon={<FolderPlus size={16} />}
            label="Nuevo proyecto"
            active={false}
            onClick={() => {
              setProjectCreateRequestId((current) => current + 1);
              if (activeView === "chat" || activeView === "inbox") {
                onShowView("code");
              }
            }}
          />
        </nav>
      ) : null}

      {activeView === "inbox" ? (
        <SidebarInboxSection
          appLaunchedAtMs={appLaunchedAtMs}
          terminalRunningSessionPaths={terminalRunningSessionPaths}
          threads={inboxThreads}
          selectedSessionPath={selectedInboxSessionPath}
          onDismissThread={onDismissInboxThread}
          onSelectThread={onSelectInboxThread}
        />
      ) : activeView === "chat" ? (
        <SidebarChatSection
          chatState={chatSidebarState}
          selectedGroupId={selectedChatGroupId}
          selectedThreadId={selectedThreadId}
          onAction={onAction}
          onCreateGroup={onCreateChatGroup}
          onSelectGroup={onSelectChatGroup}
          onNewChat={onNewChat}
          onRefresh={onRefreshChatSidebar}
          onThreadOpen={onThreadOpen}
        />
      ) : (
        <SidebarProjectsSection
          activeView={activeView}
          appLaunchedAtMs={appLaunchedAtMs}
          appSettings={appSettings}
          protectedProjectId={protectedProjectId}
          projectScopeLockActive={projectScopeLockActive}
          projects={projects}
          selectedThreadId={selectedThreadId}
          projectCreateAnchorRef={projectCreateButtonRef}
          projectCreateRequestId={projectCreateRequestId}
          terminalRunningProjectIds={terminalRunningProjectIds}
          terminalRunningSessionPaths={terminalRunningSessionPaths}
          collapsedProjectIds={collapsedProjectIds}
          onAction={onAction}
          onLoadProjectThreads={onLoadProjectThreads}
          onProjectSelect={onProjectSelect}
          onProjectReorder={onProjectReorder}
          onStartUnassignedChat={onStartUnassignedChat}
          onStartProjectChat={onStartProjectChat}
          onThreadOpen={onThreadOpen}
          onToggleProjectCollapse={onToggleProjectCollapse}
        />
      )}

      <div className="sidebar-footer" />
    </aside>
  );
}
