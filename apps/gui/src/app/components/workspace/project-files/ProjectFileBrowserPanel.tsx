import { ChevronDown, ChevronRight, Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { ProjectFileEntry, ProjectFilePreviewResult } from "../../../../../shared/desktop-contracts";
import { cn } from "../../../utils/cn";
import { FileTypeIcon } from "../../common/FileTypeIcon";
import {
  copyFilesToClipboardQuery,
  copyTextToClipboardQuery,
  getProjectFilePreviewQuery,
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
  selectionPaths: string[];
} | null;

type ProjectFileBrowserPanelProps = {
  docked: boolean;
  open: boolean;
  projectId: string;
  title?: string;
  attachedFilePaths?: Set<string>;
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

function formatFileSize(size: number | null | undefined) {
  if (!Number.isFinite(size ?? Number.NaN) || (size ?? 0) < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = size ?? 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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

function getContextMenuPosition(event: MouseEvent) {
  const estimatedWidth = 190;
  const estimatedHeight = 170;
  const padding = 8;
  return {
    x: Math.min(event.clientX, window.innerWidth - estimatedWidth - padding),
    y: Math.min(event.clientY, window.innerHeight - estimatedHeight - padding),
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

function ProjectFilePreviewPane({
  row,
  preview,
  loading,
  onDragStart,
}: {
  row: VisibleProjectFileRow | null;
  preview: ProjectFilePreviewResult | null;
  loading: boolean;
  onDragStart: (row: VisibleProjectFileRow, event: DragEvent<HTMLElement>) => void;
}) {
  if (!row) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[color:var(--muted-2)]">
        Selecciona un archivo para previsualizarlo.
      </div>
    );
  }

  const entry = row.entry;
  const details = (
    <div className="flex min-w-0 flex-wrap justify-start gap-x-3 gap-y-1 text-left text-[11px] text-[color:var(--muted-2)]">
      <span>{formatFileSize(entry.size)}</span>
      <span>{formatModifiedTime(entry.modifiedMs)}</span>
    </div>
  );
  const compactHeader = (
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-t border-white/[0.06] px-3 py-2">
      <div className="min-w-0 truncate text-right text-[12px] font-medium text-[color:var(--text)]">
        {entry.name}
      </div>
      {details}
    </div>
  );
  const previewActionButtonClass =
    "inline-flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[12px] text-[color:var(--text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)] transition-[transform,background-color,box-shadow] duration-150 ease-out hover:bg-white/[0.11] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_8px_18px_rgba(0,0,0,0.18)] active:scale-[0.96] active:bg-white/[0.16] active:duration-75";
  const actions = (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      <button className={previewActionButtonClass} type="button" onClick={() => void openPathQuery(entry.path)}>
        <ExternalLink size={13} /> Abrir
      </button>
      <button className={previewActionButtonClass} type="button" onClick={() => void revealPathQuery(entry.path)}>
        <FolderOpen size={13} /> Mostrar en carpeta
      </button>
      <button className={previewActionButtonClass} type="button" onClick={() => void copyTextToClipboardQuery(entry.path)}>
        <Copy size={13} /> Copiar ruta
      </button>
    </div>
  );

  if (entry.kind !== "file") {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <FileTypeIcon kind={entry.kind} name={entry.name} size={46} />
        <div className="mt-3 max-w-full truncate text-[13px] font-medium text-[color:var(--text)]">{entry.name}</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted-2)]">La previsualización de carpetas no está disponible.</div>
        {actions}
      </div>
    );
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[12px] text-[color:var(--muted-2)]">Cargando previsualización…</div>;
  }

  if (preview?.kind === "image") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 p-3">
          <img
            src={preview.dataUrl}
            alt={preview.name}
            className="h-full w-full cursor-grab rounded-lg object-contain active:cursor-grabbing"
            draggable
            onDragStart={(event) => onDragStart(row, event)}
          />
        </div>
        <div className="shrink-0">
          {compactHeader}
          {actions}
        </div>
      </div>
    );
  }

  if (preview?.kind === "text") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2">
          <div className="min-w-0 truncate text-[12px] font-medium text-[color:var(--text)]">{entry.name}</div>
          {details}
        </div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-[color:var(--text)]">{preview.text}</pre>
        {preview.truncated ? <div className="shrink-0 border-t border-white/[0.06] px-3 py-1.5 text-[11px] text-[color:var(--muted-2)]">Previsualización truncada.</div> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div
        className="cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(event) => onDragStart(row, event)}
        aria-label={`Arrastrar ${entry.name}`}
      >
        <FileTypeIcon kind={entry.kind} name={entry.name} size={54} />
      </div>
      <div className="mt-3 max-w-full truncate text-[13px] font-medium text-[color:var(--text)]">{entry.name}</div>
      {details}
      {preview?.kind === "unsupported" && preview.reason ? (
        <div className="mt-2 text-[12px] text-[color:var(--muted-2)]">{preview.reason}</div>
      ) : null}
      {actions}
    </div>
  );
}

export function ProjectFileBrowserPanel({
  docked,
  open,
  projectId,
  title = "Archivos del proyecto",
  attachedFilePaths = new Set(),
}: ProjectFileBrowserPanelProps) {
  const [directories, setDirectories] = useState<Record<string, LoadedDirectory>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorSelectionPath, setAnchorSelectionPath] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [preview, setPreview] = useState<ProjectFilePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setDirectories({});
    setExpandedPaths({});
    setSelectedPaths(new Set());
    setAnchorSelectionPath(null);
    setRefreshRevision(0);
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    void loadDirectory(projectId);
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;

    const refreshProjectFiles = () => {
      const directoryPaths = Object.keys(directories);
      const pathsToRefresh = directoryPaths.length > 0 ? directoryPaths : [projectId];
      void Promise.allSettled(pathsToRefresh.map((directoryPath) => loadDirectory(directoryPath))).then(
        () => setRefreshRevision((revision) => revision + 1),
      );
    };

    const intervalId = window.setInterval(refreshProjectFiles, 2500);
    window.addEventListener("focus", refreshProjectFiles);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshProjectFiles);
    };
  }, [directories, open, projectId]);

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

  const selectedPreviewRow = useMemo(() => {
    if (selectedPaths.size !== 1) return null;
    const [selectedPath] = [...selectedPaths];
    return visibleRows.find((row) => row.entry.path === selectedPath) ?? null;
  }, [selectedPaths, visibleRows]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);

    if (!selectedPreviewRow || selectedPreviewRow.entry.kind !== "file") {
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setPreviewLoading(true);
    void getProjectFilePreviewQuery({ projectId, filePath: selectedPreviewRow.entry.path })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshRevision, selectedPreviewRow]);

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

  function getSelectedRowsForAction(row: VisibleProjectFileRow, actionSelectionPaths?: string[]) {
    const actionPaths = actionSelectionPaths
      ? new Set(actionSelectionPaths)
      : selectedPaths.has(row.entry.path)
        ? selectedPaths
        : new Set([row.entry.path]);
    return visibleRows.filter((visibleRow) => actionPaths.has(visibleRow.entry.path));
  }

  async function copyPaths(rows: VisibleProjectFileRow[]) {
    await copyTextToClipboardQuery(rows.map((row) => row.entry.path).join("\n"));
  }

  async function copyNames(rows: VisibleProjectFileRow[]) {
    await copyTextToClipboardQuery(rows.map((row) => row.entry.name).join("\n"));
  }

  async function copyFiles(rows: VisibleProjectFileRow[]) {
    const paths = rows.map((row) => row.entry.path);
    if (!(await copyFilesToClipboardQuery(paths))) {
      await copyPaths(rows);
    }
  }

  function handleDragStart(row: VisibleProjectFileRow, event: DragEvent<HTMLElement>) {
    const rows = getSelectedRowsForAction(row);
    const paths = rows.map((selectedRow) => selectedRow.entry.path);
    const uriList = paths.map((path) => `file:///${path.replaceAll("\\", "/")}`).join("\n");

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-office-agent-file-paths", JSON.stringify(paths));

    if (paths.length === 1) {
      event.dataTransfer.setData(
        "DownloadURL",
        `application/octet-stream:${row.entry.name}:file:///${paths[0].replaceAll("\\", "/")}`,
      );
    }

    if (window.piDesktop?.startFileDrag) {
      window.piDesktop.startFileDrag(paths);
      return;
    }

    event.dataTransfer.setData("text/plain", paths.join("\n"));
    event.dataTransfer.setData("text/uri-list", uriList);
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
      aria-label="Archivos del proyecto"
      data-block-composer-attachment-drop="true"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="flex h-12 shrink-0 items-center border-b border-white/10 px-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[13px] font-medium text-[color:var(--text)]">
            {title}
          </h2>
          <p className="m-0 truncate text-[11px] text-[color:var(--muted-2)]">{projectId}</p>
        </div>
      </header>

      <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_6.8rem] items-center border-b border-white/[0.06] px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--muted-2)]">
        <button type="button" className="flex min-w-0 items-center gap-1 px-1 text-left" onClick={() => toggleSort("name")}>
          <span>Nombre</span>{renderSortIndicator("name")}
        </button>
        <button type="button" className="flex items-center gap-1 px-1 text-left" onClick={() => toggleSort("modified")}>
          <span>Modificado</span>{renderSortIndicator("modified")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto px-1 py-1.5">
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
                  selected
                    ? "bg-[#313239] shadow-[inset_0_0_0_1px_rgba(183,186,245,0.04)]"
                    : "hover:bg-white/[0.055]",
                )}
                onClick={(event) => handleSelect(row, event)}
                onDoubleClick={() => {
                  if (row.entry.kind === "directory") void toggleDirectory(row.entry);
                  else void openPathQuery(row.entry.path);
                }}
                draggable
                onDragStart={(event) => handleDragStart(row, event)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const nextSelectionPaths = selectedPaths.has(row.entry.path)
                    ? [...selectedPaths]
                    : [row.entry.path];
                  if (!selectedPaths.has(row.entry.path)) {
                    setSelectedPaths(new Set(nextSelectionPaths));
                    setAnchorSelectionPath(row.entry.path);
                  }
                  const menuPosition = getContextMenuPosition(event);
                  setContextMenu({
                    ...menuPosition,
                    row,
                    selectionPaths: nextSelectionPaths,
                  });
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
                      aria-label={expanded ? "Contraer carpeta" : "Expandir carpeta"}
                    >
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  ) : (
                    <span className="h-5 w-5 shrink-0" />
                  )}
                  <span className="shrink-0"><FileTypeIcon kind={row.entry.kind} name={row.entry.name} size={16} /></span>
                  <span className="min-w-0 truncate">{row.entry.name}</span>
                  {attached ? (
                    <span className="shrink-0 rounded-full bg-[#313239] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--text)] shadow-[inset_0_0_0_1px_rgba(183,186,245,0.04)]">
                      adjunto
                    </span>
                  ) : null}
                </div>
                <div className="truncate px-1 text-[11px] text-[color:var(--muted)]">
                  {formatModifiedTime(row.entry.modifiedMs)}
                </div>
              </div>
              {expanded && childDirectory?.loading ? (
                <div className="py-1 pl-8 text-[11px] text-[color:var(--muted-2)]">Cargando…</div>
              ) : null}
            </div>
          );
        })}
        </div>
        <div className="h-1/2 min-h-[190px] shrink-0 border-t border-white/10 bg-black/[0.08]">
          <ProjectFilePreviewPane
            row={selectedPreviewRow}
            preview={preview}
            loading={previewLoading}
            onDragStart={handleDragStart}
          />
        </div>
      </div>

      {contextMenu
        ? createPortal(
            <div
              className="fixed z-[1000] grid min-w-44 gap-1 rounded-xl border border-white/10 bg-[rgba(24,24,24,0.96)] p-1.5 text-[12px] text-[color:var(--text)] shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {(() => {
                const rows = getSelectedRowsForAction(contextMenu.row, contextMenu.selectionPaths);
                const first = contextMenu.row.entry;
                return (
                  <>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void openPathQuery(first.path)}>
                      <ExternalLink size={13} /> Abrir
                    </button>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void revealPathQuery(first.path)}>
                      <FolderOpen size={13} /> Mostrar en carpeta
                    </button>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void copyFiles(rows)}>
                      <Copy size={13} /> Copiar {rows.length > 1 ? "archivos" : "archivo"}
                    </button>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void copyPaths(rows)}>
                      <Copy size={13} /> Copiar {rows.length > 1 ? "rutas" : "ruta"}
                    </button>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.07]" type="button" onClick={() => void copyNames(rows)}>
                      <Copy size={13} /> Copiar {rows.length > 1 ? "nombres" : "nombre"}
                    </button>
                  </>
                );
              })()}
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
