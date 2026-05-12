import { Check, ChevronRight } from "lucide-react";
import { type RefObject, useMemo } from "react";
import type { ComposerModel, ComposerThinkingLevel } from "../../../desktop/types";
import { popoverPanelClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { SurfacePanel } from "../../common/SurfacePanel";

type ComposerModelPopoverProps = {
  availableModels: ComposerModel[];
  availableThinkingLevels: ComposerThinkingLevel[];
  currentModel: ComposerModel | null;
  currentThinkingLevel: ComposerThinkingLevel;
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  thinkingLevelLabels: Record<ComposerThinkingLevel, string>;
  onSelectModel: (model: ComposerModel) => void;
  onSelectThinkingLevel: (level: ComposerThinkingLevel) => void;
};

function getModelKey(model: ComposerModel) {
  return `${model.provider}/${model.id}`;
}

function getModelProviderLabel(model: ComposerModel) {
  return model.provider === "corp" ? "Castrosua IA" : model.provider;
}

export function ComposerModelPopover({
  availableModels,
  availableThinkingLevels,
  currentModel,
  currentThinkingLevel,
  open,
  panelRef,
  thinkingLevelLabels,
  onSelectModel,
  onSelectThinkingLevel,
}: ComposerModelPopoverProps) {
  const sortedModels = useMemo(
    () =>
      [...availableModels].sort((left, right) => {
        const leftSelected =
          currentModel?.provider === left.provider && currentModel.id === left.id ? -1 : 0;
        const rightSelected =
          currentModel?.provider === right.provider && currentModel.id === right.id ? -1 : 0;

        return leftSelected - rightSelected || left.name.localeCompare(right.name);
      }),
    [availableModels, currentModel?.id, currentModel?.provider],
  );

  return (
    <SurfacePanel
      ref={panelRef}
      id="composer-model-menu"
      data-open={open ? "true" : "false"}
      className={cn(
        "motion-popover absolute bottom-[calc(100%+8px)] left-0 z-[60] grid w-64 max-w-[calc(100vw-2rem)] origin-bottom-left gap-2 overflow-visible rounded-2xl border-[color:var(--border-strong)] p-2 text-[12px] shadow-[0_18px_40px_rgba(0,0,0,0.28)]",
        popoverPanelClass,
      )}
    >
      <div className="grid gap-1 overflow-hidden">
        <div className="px-1.5 text-[11px] font-medium text-[color:var(--muted)]">Modelo</div>
        <div className="grid max-h-64 gap-1 overflow-y-auto pr-0.5">
          {sortedModels.map((model) => {
            const selected = currentModel?.provider === model.provider && currentModel.id === model.id;

            return (
              <button
                key={getModelKey(model)}
                type="button"
                className={cn(
                  "grid min-h-[3.15rem] w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.055]",
                  selected && "bg-white/[0.08] text-[color:var(--text)]",
                )}
                onClick={() => onSelectModel(model)}
              >
                <span className="grid min-w-0 gap-1 leading-none">
                  <span className="block truncate text-[12.5px] font-semibold leading-[1.15] text-[color:var(--text)]">
                    {model.name}
                  </span>
                  <span className="block truncate text-[11px] leading-[1.15] text-[color:var(--muted-2)]">
                    {getModelProviderLabel(model)}
                  </span>
                </span>
                <span className="inline-flex justify-end text-[color:var(--text)]">
                  {selected ? <Check size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-white/10" />

      <div className="group/reasoning relative">
        <button
          type="button"
          className={cn(
            "grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.055]",
            "group-hover/reasoning:bg-white/[0.08] group-focus-within/reasoning:bg-white/[0.08] group-focus-within/reasoning:text-[color:var(--text)] group-hover/reasoning:text-[color:var(--text)]",
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-[12px] text-[color:var(--text)]">Razonamiento</span>
            <span className="block truncate text-[10.5px] text-[color:var(--muted)]">
              {thinkingLevelLabels[currentThinkingLevel]}
            </span>
          </span>
          <ChevronRight size={14} className="text-[color:var(--muted)]" />
        </button>

        <SurfacePanel
          className={cn(
            "reasoning-submenu pointer-events-none absolute bottom-0 left-[calc(100%+8px)] z-[70] grid w-44 origin-bottom-left gap-1 rounded-2xl border-[color:var(--border-strong)] p-2 text-[12px] opacity-0 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-none group-hover/reasoning:pointer-events-auto group-hover/reasoning:opacity-100 group-focus-within/reasoning:pointer-events-auto group-focus-within/reasoning:opacity-100",
          )}
          style={{ backgroundColor: "rgb(24, 24, 24)" }}
        >
            <div className="px-1.5 pb-1 text-[11px] font-medium text-[color:var(--muted)]">
              Razonamiento
            </div>
            {availableThinkingLevels.map((level) => {
              const selected = level === currentThinkingLevel;

              return (
                <button
                  key={level}
                  type="button"
                  className={cn(
                    "grid min-h-8 w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.055]",
                    selected && "bg-white/[0.08] text-[color:var(--text)]",
                  )}
                  onClick={() => {
                    onSelectThinkingLevel(level);
                  }}
                >
                  <span className="truncate text-[12px] text-[color:var(--text)]">
                    {thinkingLevelLabels[level]}
                  </span>
                  <span className="inline-flex justify-end text-[color:var(--text)]">
                    {selected ? <Check size={14} /> : null}
                  </span>
                </button>
              );
            })}
        </SurfacePanel>
      </div>
    </SurfacePanel>
  );
}
