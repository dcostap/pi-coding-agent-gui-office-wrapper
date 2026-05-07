import { ChevronDown, ChevronRight, Copy, ExternalLink, FolderOpen, PanelRightClose, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ProjectFileEntry } from "../../../../../shared/desktop-contracts";
import { compactIconButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { FileTypeIcon } from "../../common/FileTypeIcon";
import {
  copyTextToClipboardQuery,
  listProjectFileEntriesQuery,
  openPathQuery,
  revealPathQuery,
} from "../../../query/desktop-query";

type SortKey = "name" | "modified";
type SortDirection = "asc" | "desc";

type LoadedDirectory = {
  loading: boolean;
  entries: ProjectFileEntry[];
};

type VisibleProjectFileRow = {
  entry: ProjectFileEntry;
  depth: number;
  parentPath: string | null;
};

type ContextMenuState = {
  x: number;
  y: number;
  row: VisibleProjectFileRow;
} | null;

type ProjectFileBrowserPanelProps = {
  docked: boolean;
  open: boolean;
  projectId: string;
  attachedFilePaths?: Set<string>;
  onClose: () => void;
};

function formatModifiedTime(modifiedMs: number) {
  if (!Number.isFinite(modifiedMs) || modifiedMs <= 0) {
    return "—";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(new Date(modifiedMs));
}

function compareEntries(sortKey: SortKey, sortDirection: SortDirection) {
  return (left: ProjectFileEntry, right: ProjectFileEntry) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    const direction = sortDirection === "asc" ? 1 : -1;
    if (sortKey === "modified") {
      const modifiedDelta = (left.modifiedMs - right.modifiedMs) * direction;
      if (modifiedDelta !== 0) return modifiedDelta;
    }

    const nameDelta = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return sortKey === "name" ? nameDelta * direction : nameDelta;
  };
}

function getSelectionRange(rows: VisibleProjectFileRow[], fromPath: string, toPath: string) {
  const fromIndex = rows.findIndex((row) => row.entry.path === fromPath);
  const toIndex = rows.findIndex((row) => row.entry.path === toPath);
  if (fromIndex < 0 || toIndex < 0) {
    return [toPath];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return rows.slice(start, end + 1).map((row) => row.entry.path);
}

export function ProjectFileBrowserPanel({
  docked,
  open,
  projectId,
  attachedFilePaths = new Set(),
  onClose,
}: ProjectFileBrowserPanelProps) {
  const [directories, setDirectories] = useState<Record<string, LoadedDirectory>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorSelectionPath, setAnchorSelectionPath] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setDirectories({});
    setExpandedPaths({});
    setSelectedPaths(new Set());
    setAnchorSelectionPath(null);
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    void loadDirectory(projectId);
  }, [open, projectId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [contextMenu]);

  const sortedDirectories = useMemo(() => {
    const sorter = compareEntries(sortKey, sortDirection);
    return Object.fromEntries(
      Object.entries(directories).map(([directoryPath, directory]) => [
        directoryPath,
        { ...directory, entries: [...directory.entries].sort(sorter) },
      ]),
    );
  }, [directories, sortDirection, sortKey]);

  const visibleRows = useMemo(() => {
    const rows: VisibleProjectFileRow[] = [];
    const appendDirectory = (directoryPath: string, depth: number, parentPath: string | null) => {
      const directory = sortedDirectories[directoryPath];
      if (!directory) return;

      for (const entry of directory.entries) {
        rows.push({ entry, depth, parentPath });
        if (entry.kind === "directory" && expandedPaths[entry.path]) {
          appendDirectory(entry.path, depth + 1, entry.path);
        }
      }
    };

    appendDirectory(projectId, 0, null);
    return rows;
  }, [expandedPaths, projectId, sortedDirectories]);

  async function loadDirectory(directoryPath: string) {
    setDirectories((current) => ({
      ...current,
      [directoryPath]: { entries: current[directoryPath]?.entries ?? [], loading: true },
    }));

    const result = await listProjectFileEntriesQuery({ projectId, directoryPath }).catch(() => null);
    setDirectories((current) => ({
      ...current,
      [directoryPath]: { entries: result?.entries ?? [], loading: false },
    }));
  }

  async function toggleDirectory(entry: ProjectFileEntry) {
    const nextExpanded = !expandedPaths[entry.path];
    setExpandedPaths((current) => ({ ...current, [entry.path]: nextExpanded }));
    if (nextExpanded && !directories[entry.path]) {
      await loadDirectory(entry.path);
    }
  }

  function handleSelect(row: VisibleProjectFileRow, event: MouseEvent) {
    const path = row.entry.path;
    if (event.shiftKey && anchorSelectionPath) {
      setSelectedPaths(new Set(getSelectionRange(visibleRows, anchorSelectionPath, path)));
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setAnchorSelectionPath(path);
      return;
    }

    setSelectedPaths(new Set([path]));
    setAnchorSelectionPath(path);
  }

  function toggleSort(nextSortKey: SortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "modified" ? "desc" : "asc");
  }

  function getSelectedRowsForAction(row: VisibleProjectFileRow) {
    const actionPaths = selectedPaths.has(row.entry.path) ? selectedPaths : new Set([row.entry.path]);
    return visibleRows.filter((visibleRow) => actionPaths.has(visibleRow.entry.path));
  }

  async function copyPaths(rows: VisibleProjectFileRow[]) {
    await copyTextToClipboardQuery(rows.map((row) => row.entry.path).join("\n"));
  }

  async function copyNames(rows: VisibleProjectFileRow[]) {
    await copyTextToClipboardQuery(rows.map((row) => row.entry.name).join("\n"));
  }

  function renderSortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="text-[10px] text-[color:var(--muted-2)]">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <aside
      ref={panelRef}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-white/10 bg-[color:var(--sidebar)] shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-[28px]",
        docked ? "rounded-none" : "rounded-l-2xl",
      )}
      aria-label="Project files"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[13px] font-medium text-[color:var(--text)]">
            Project files
          </h2>
          <p className="m-0 truncate text-[11px] text-[color:var(--muted-2)]">{projectId}</p>
        </div>
        <button
          type="button"
          className={cn(compactIconButtonClass, "h-7 w-7 rounded-full")}
          onClick={onClose}
          aria-label={docked ? "Collapse project files" : "Close project files"}
          data-tooltip={docked ? "Collapse project files" : "Close project files"}
        >
          {docked ? <PanelRightClose size={14} /> : <X size={14} />}
        </button>
      </header>

      <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_6.8rem] items-center border-b border-white/[0.06] px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted-2)]">
        <button type="button" className="flex min-w-0 items-center gap-1 px-1 text-left" onClick={() => toggleSort("name")}>
          <span>Name</span>{renderSortIndicator("name")}
        </button>
        <button type="button" className="flex items-center gap-1 px-1 text-left" onClick={() => toggleSort("modified")}>
          <span>Modified</span>{renderSortIndicator("modified")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1.5">
        {visibleRows.length === 0 && directories[projectId]?.loading ? (
          <div className="px-3 py-4 text-[12px] text-[color:var(--muted)]">Loading files…</div>
        ) : null}
        {visibleRows.map((row) => {
          const selected = selectedPaths.has(row.entry.path);
          const attached = attachedFilePaths.has(row.entry.path);
          const expanded = Boolean(expandedPaths[row.entry.path]);
          const childDirectory = directories[row.entry.path];
          return (
            <div key={row.entry.path}>
              <div
                className={cn(
                  "grid h-8 cursor-default grid-cols-[minmax(0,1fr)_6.8rem] items-center rounded-lg px-1 text-[12px] text-[color:var(--text)] transition-colors",
                  selected ? "bg-[rgba(138,190,183,0.16)]" : "hover:bg-white/[0.055]",
                )}
                onClick={(event) => handleSelect(row, event)}
                onDoubleClick={() => {
                  if (row.entry.kind === "directory") void toggleDirectory(row.entry);
                  else void openPathQuery(row.entry.path);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selectedPaths.has(row.entry.path)) {
                    setSelectedPaths(new Set([row.entry.path]));
                    setAnchorSelectionPath(row.entry.path);
                  }
                  setContextMenu({ x: event.clientX, y: event.clientY, row });
                }}
              >
                <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: row.depth * 14 }}>
                  {row.entry.kind === "directory" ? (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[color:var(--muted)] hover:bg-white/10 hover:text-[color:var(--text)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleDirectory(row.entry);
                      }}
                      aria-label={expanded ? "Collapse folder" : "Expand folder"}
                    >
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  ) : (
                    <span className="h-5 w-5 shrink-0" />
                  )}
                  <span className="shrink-0"><FileTypeIcon kind={row.entry.kind} name={row.entry.name} size={16} /></span>
                  <span className="min-w-0 truncate">{row.entry.name}</span>
                  {attached ? (
                    <span className="shrink-0 rounded-full bg-[#8abeb7]/14 px-1.5 py-0.5 text-[10px] font-medium text-[#8abeb7]">
                      attached
                    </span>
                  ) : null}
                </div>
                <div className="truncate px-1 text-[11px] text-[color:var(--muted)]">
                  {formatModifiedTime(row.entry.modifiedMs)}
                </div>
              </div>
              {expanded && childDirectory?.loading ? (
                <div className="py-1 pl-8 text-[11px] text-[color:var(--muted-2)]">Loading…</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-[90] grid min-w-44 gap-1 rounded-xl border border-white/10 bg-[rgba(24,24,24,0.96)] p-1.5 text-[12px] text-[color:var(--text)] shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(() => {
            const rows = getSelectedRowsForAction(contextMenu.row);
            const first = contextMenu.row.entry;
            return (
              <>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void openPathQuery(first.path)}>
                  <ExternalLink size={13} /> Open
                </button>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void revealPathQuery(first.path)}>
                  <FolderOpen size={13} /> Show in folder
                </button>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void copyPaths(rows)}>
                  <Copy size={13} /> Copy {rows.length > 1 ? "paths" : "path"}
                </button>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void copyNames(rows)}>
                  <Copy size={13} /> Copy {rows.length > 1 ? "names" : "name"}
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </aside>
  );
}
