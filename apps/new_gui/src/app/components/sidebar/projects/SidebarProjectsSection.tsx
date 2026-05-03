import { ChevronDown, ChevronRight, FolderPlus, Search, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, DesktopActionInvoker } from "../../../desktop/types";
import { useDesktopBridgeAvailable } from "../../../hooks/useDesktopBridge";
import { useDismissibleLayer } from "../../../hooks/useDismissibleLayer";
import type { Project, Thread, View } from "../../../types";
import { cn } from "../../../utils/cn";
import { IconButton } from "../../common/IconButton";
import { ProjectTree } from "../ProjectTree";
import { ThreadRow } from "../project-tree/ThreadRow";
import { SidebarProjectsCreatePopover } from "./SidebarProjectsCreatePopover";
import {
  getUnassignedChatDisplayTitle,
  isUnassignedChatProjectId,
  UNASSIGNED_CHATS_FAKE_PROJECT_ID,
  UNASSIGNED_CHAT_PROJECT_NAME,
} from "../../../../../shared/unassigned-chats";
import {
  type SidebarProjectsFilterMode,
  getSidebarVisibleProjects,
} from "./sidebar-projects.helpers";

type PendingProject = {
  key: string;
  name: string;
};

type UnassignedChatThread = Thread & {
  projectId: string;
};

type SidebarProjectsSectionProps = {
  activeView: View;
  appLaunchedAtMs: number;
  appSettings: AppSettings;
  protectedProjectId?: string | null;
  projectScopeLockActive: boolean;
  projects: Project[];
  selectedProjectId: string;
  selectedThreadId: string | null;
  terminalRunningProjectIds: ReadonlySet<string>;
  terminalRunningSessionPaths: ReadonlySet<string>;
  collapsedProjectIds: Record<string, boolean>;
  onAction: DesktopActionInvoker;
  onLoadProjectThreads: (projectId: string, options?: { chat?: boolean }) => Promise<unknown>;
  onProjectSelect: (projectId: string) => void;
  onProjectReorder: (projectIds: string[]) => void;
  onThreadOpen: (projectId: string, threadId: string, sessionPath: string) => void;
  onToggleProjectCollapse: (projectId: string) => void;
};

export function SidebarProjectsSection({
  activeView,
  appLaunchedAtMs,
  appSettings,
  protectedProjectId = null,
  projectScopeLockActive,
  projects,
  selectedProjectId,
  selectedThreadId,
  terminalRunningProjectIds,
  terminalRunningSessionPaths,
  collapsedProjectIds,
  onAction,
  onLoadProjectThreads,
  onProjectSelect,
  onProjectReorder,
  onThreadOpen,
  onToggleProjectCollapse,
}: SidebarProjectsSectionProps) {
  const showProjects =
    activeView === "chat" ||
    activeView === "code" ||
    activeView === "thread" ||
    activeView === "gitops" ||
    activeView === "archived" ||
    activeView === "settings" ||
    activeView === "extensions" ||
    activeView === "skills";
  const selectionModeActive =
    (activeView === "extensions" || activeView === "skills") && projectScopeLockActive;
  const showProjectCreate = activeView !== "extensions" && activeView !== "skills";
  const [searchQuery, setSearchQuery] = useState("");
  const filterMode: SidebarProjectsFilterMode = "all";
  const [createOpen, setCreateOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null);
  const [createdProjectIds, setCreatedProjectIds] = useState<string[]>([]);
  const [pendingProject, setPendingProject] = useState<PendingProject | null>(null);
  const desktopBridgeAvailable = useDesktopBridgeAvailable();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createPanelRef = useRef<HTMLDialogElement>(null);
  const [unassignedChatsExpanded, setUnassignedChatsExpanded] = useState(true);

  const regularProjects = useMemo(
    () => projects.filter((project) => !isUnassignedChatProjectId(project.id)),
    [projects],
  );
  const unassignedChatProjects = useMemo(
    () => projects.filter((project) => isUnassignedChatProjectId(project.id)),
    [projects],
  );
  const unassignedChatThreads = useMemo<UnassignedChatThread[]>(
    () =>
      unassignedChatProjects
        .flatMap((project) =>
          project.threads.map((thread) => ({
            ...thread,
            projectId: project.id,
            title: getUnassignedChatDisplayTitle(thread.title),
          })),
        )
        .sort((left, right) => (right.lastModifiedMs ?? 0) - (left.lastModifiedMs ?? 0)),
    [unassignedChatProjects],
  );
  const hasUnassignedChats =
    unassignedChatThreads.length > 0 ||
    unassignedChatProjects.some((project) => (project.threadCount ?? 0) > 0);

  const { projects: visibleProjects, autoExpandedProjectIds } = useMemo(
    () =>
      getSidebarVisibleProjects({
        projects: regularProjects,
        searchQuery,
        filterMode,
        terminalRunningProjectIds,
        terminalRunningSessionPaths,
        appLaunchedAtMs,
        priorityProjectIds: createdProjectIds,
      }),
    [
      appLaunchedAtMs,
      createdProjectIds,
      filterMode,
      regularProjects,
      searchQuery,
      terminalRunningProjectIds,
      terminalRunningSessionPaths,
    ],
  );

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      return;
    }

    for (const project of visibleProjects) {
      const sourceProject = regularProjects.find((candidate) => candidate.id === project.id);

      const shouldLoadSearchedProject = searchQuery.trim().length > 0;
      const hasIndexedThreads = (sourceProject?.threadCount ?? project.threadCount ?? 0) > 0;

      const threadsScope = activeView === "chat" ? "chat" : "code";
      if (
        (project.threadsLoaded && project.threadsScope === threadsScope) ||
        (!shouldLoadSearchedProject && !hasIndexedThreads)
      ) {
        continue;
      }

      void onLoadProjectThreads(project.id, { chat: activeView === "chat" });
    }
  }, [activeView, onLoadProjectThreads, regularProjects, searchQuery, visibleProjects]);

  useEffect(() => {
    for (const project of unassignedChatProjects) {
      if (project.threadsLoaded || (project.threadCount ?? 0) === 0) {
        continue;
      }

      void onLoadProjectThreads(project.id, { chat: false });
    }
  }, [onLoadProjectThreads, unassignedChatProjects]);

  const effectiveCollapsedProjectIds = useMemo(() => {
    if (searchQuery.trim().length === 0) {
      return collapsedProjectIds;
    }

    return {
      ...collapsedProjectIds,
      ...Object.fromEntries([...autoExpandedProjectIds].map((projectId) => [projectId, false])),
    };
  }, [autoExpandedProjectIds, collapsedProjectIds, searchQuery]);


  const dismissCreate = useCallback(() => {
    setCreateOpen(false);
  }, []);

  useDismissibleLayer({
    open: createOpen,
    onDismiss: dismissCreate,
    refs: [createButtonRef, createPanelRef],
  });

  const handleCreateProject = async () => {
    if (createBusy) {
      return;
    }

    setCreateErrorMessage(null);

    if (!appSettings.preferredProjectLocation) {
      setCreateErrorMessage("La ubicaci�n del proyecto no est� configurada.");
      return;
    }

    const draft = projectNameDraft.trim();
    if (!draft) {
      return;
    }

    setPendingProject({ key: `${Date.now()}:${draft}`, name: draft });
    setProjectNameDraft("");
    setCreateOpen(false);
    setCreateBusy(true);

    try {
      const result = await onAction("project.add", { projectName: draft });
      const error = typeof result?.result?.error === "string" ? result.result.error : null;

      if (error) {
        setCreateErrorMessage(error);
        setProjectNameDraft(draft);
        setCreateOpen(true);
        setPendingProject(null);
        return;
      }

      const projectId =
        typeof result?.result?.projectId === "string" ? result.result.projectId : null;
      if (projectId) {
        setCreatedProjectIds((current) => [projectId, ...current.filter((id) => id !== projectId)]);
      }

      setPendingProject(null);
    } catch (error) {
      setCreateErrorMessage(error instanceof Error ? error.message : "No se pudo añadir el proyecto.");
      setProjectNameDraft(draft);
      setCreateOpen(true);
      setPendingProject(null);
    } finally {
      setCreateBusy(false);
    }
  };

  if (!showProjects) {
    return <section className="sidebar-section" aria-hidden="true" />;
  }

  return (
    <section className="sidebar-section">
      <div className="sidebar-toolbar">
        <label
          className="sidebar-search-field"
          data-active={searchQuery.trim().length > 0 ? "true" : "false"}
        >
          <Search size={14} className="sidebar-search-icon" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar"
            className="sidebar-search-input"
            aria-label="Buscar proyectos"
          />
        </label>
        {showProjects ? (
          <div className="sidebar-action-group">
            {showProjectCreate ? (
              <IconButton
                ref={createButtonRef}
                label="Añadir proyecto"
                tooltipPlacement="right"
                onClick={() => {
                  if (!appSettings.preferredProjectLocation) {
                    setCreateErrorMessage("La ubicaci�n del proyecto no est� configurada.");
                  } else {
                    setCreateErrorMessage(null);
                  }

                  setCreateOpen(true);
                }}
                icon={<FolderPlus size={15} />}
              />
            ) : null}
          </div>
        ) : null}

        {createOpen ? (
          <SidebarProjectsCreatePopover
            menuId="sidebar-project-create-dialog"
            open={createOpen}
            draft={projectNameDraft}
            defaultLocation={appSettings.preferredProjectLocation}
            busy={createBusy}
            errorMessage={createErrorMessage}
            panelRef={createPanelRef}
            onChangeDraft={setProjectNameDraft}
            onCreate={() => {
              void handleCreateProject();
            }}
            onClose={() => {
              setCreateOpen(false);
              setCreateErrorMessage(null);
            }}
          />
        ) : null}
      </div>

      {visibleProjects.length > 0 || pendingProject || hasUnassignedChats ? (
        <>
          {pendingProject ? (
            <div className="sidebar-tree-item" aria-live="polite">
              <div className="sidebar-project-row sidebar-row-surface motion-surface-pulse">
                <span className="sidebar-project-toggle" data-can-toggle="false">
                  <FolderPlus
                    size={12}
                    className="sidebar-project-icon sidebar-project-origin-icon"
                  />
                </span>
                <div
                  className="sidebar-project-button"
                  aria-label={`Adding ${pendingProject.name}`}
                >
                  <span className="sidebar-project-title">{pendingProject.name}</span>
                </div>
                <span className="text-[11px] text-[color:var(--muted-2)]">Adding…</span>
              </div>
            </div>
          ) : null}
          {hasUnassignedChats ? (
            <div className="sidebar-tree-item">
              <div className="sidebar-project-row sidebar-row-surface">
                <button
                  type="button"
                  className="sidebar-project-toggle"
                  onClick={() => setUnassignedChatsExpanded((expanded) => !expanded)}
                  data-can-toggle="true"
                  aria-label={
                    unassignedChatsExpanded
                      ? "Contraer chats sin proyecto"
                      : "Expandir chats sin proyecto"
                  }
                  aria-expanded={unassignedChatsExpanded}
                  aria-controls={UNASSIGNED_CHATS_FAKE_PROJECT_ID}
                >
                  <SquarePen size={12} className="sidebar-project-icon sidebar-project-origin-icon" />
                  {unassignedChatsExpanded ? (
                    <ChevronDown size={12} className="sidebar-project-icon sidebar-project-chevron-icon" />
                  ) : (
                    <ChevronRight size={12} className="sidebar-project-icon sidebar-project-chevron-icon" />
                  )}
                </button>
                <button
                  type="button"
                  className="sidebar-project-button cursor-pointer"
                  onClick={() => setUnassignedChatsExpanded((expanded) => !expanded)}
                >
                  <span className="sidebar-project-title">{UNASSIGNED_CHAT_PROJECT_NAME}</span>
                </button>
                <span className="pr-1 text-[11px] text-[color:var(--muted-2)]">
                  {unassignedChatThreads.length}
                </span>
              </div>
              {unassignedChatsExpanded ? (
                <div
                  id={UNASSIGNED_CHATS_FAKE_PROJECT_ID}
                  className="motion-collapse-panel"
                  data-open="true"
                >
                  <div className="motion-collapse-panel__inner">
                    {unassignedChatThreads.map((thread) => (
                      <ThreadRow
                        key={`${thread.projectId}:${thread.id}`}
                        age={thread.age}
                        pinned={Boolean(thread.pinned)}
                        running={Boolean(thread.running)}
                        terminalRunning={Boolean(
                          thread.sessionPath && terminalRunningSessionPaths.has(thread.sessionPath),
                        )}
                        unread={Boolean(thread.unread)}
                        isSelected={
                          selectedThreadId === thread.id &&
                          selectedProjectId === thread.projectId &&
                          (activeView === "thread" || activeView === "gitops")
                        }
                        title={thread.title}
                        onArchive={() =>
                          onAction("thread.archive", {
                            projectId: thread.projectId,
                            threadId: thread.id,
                          })
                        }
                        onOpen={() => {
                          if (!thread.sessionPath) {
                            return;
                          }

                          onThreadOpen(thread.projectId, thread.id, thread.sessionPath);
                        }}
                        onPin={() =>
                          onAction("thread.pin", {
                            projectId: thread.projectId,
                            threadId: thread.id,
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {visibleProjects.length > 0 ? (
            <ProjectTree
              projects={visibleProjects}
              protectedProjectId={protectedProjectId}
              selectedProjectId={selectedProjectId}
              selectedThreadId={selectedThreadId}
              terminalRunningSessionPaths={terminalRunningSessionPaths}
              activeView={activeView}
              selectionModeActive={selectionModeActive}
              revealOldThreads={searchQuery.trim().length > 0}
              collapsedProjectIds={effectiveCollapsedProjectIds}
              onAction={onAction}
              onProjectSelect={onProjectSelect}
              onProjectReorder={onProjectReorder}
              onThreadOpen={onThreadOpen}
              onToggleProjectCollapse={onToggleProjectCollapse}
            />
          ) : null}
        </>
      ) : !desktopBridgeAvailable ? (
        <div className="px-2.5 py-2 text-[12px] leading-5 text-[color:var(--muted-2)]">
          Project sync needs the desktop bridge. Restart the dev server or use{" "}
          <code>bun run dev</code>.
        </div>
      ) : (
        <div
          className={cn(
            "px-2.5 py-2 text-[13px] text-[color:var(--muted-2)]",
            searchQuery.trim().length > 0 || filterMode !== "all" ? "" : "hidden",
          )}
        >
          No matching projects
        </div>
      )}
    </section>
  );
}
