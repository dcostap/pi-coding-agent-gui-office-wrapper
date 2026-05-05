import { Bot, FileCode2 } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
  ComposerContextUsage,
  ComposerModel,
  ComposerThinkingLevel,
  ProjectDiffBaseline,
  ProjectGitState,
} from "../../../desktop/types";
import { iconActionButtonDisabledClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";
import { ToolbarButton } from "../../common/ToolbarButton";
import { ComposerContextMeter } from "./ComposerContextMeter";
import { ComposerDiffBaselineSelector } from "./ComposerDiffBaselineSelector";
import {
  WorkspaceBranchChip,
  workspaceFooterRowClass,
  workspaceFooterTextClass,
  workspaceFooterTrailingGroupClass,
} from "../footer/WorkspaceFooterPrimitives";
import { ComposerModelPopover } from "./ComposerModelPopover";

type ComposerFooterProps = {
  availableModels: ComposerModel[];
  availableThinkingLevels: ComposerThinkingLevel[];
  composerPanelRef: RefObject<HTMLDivElement | null>;
  diffBaseline: ProjectDiffBaseline;
  model: ComposerModel | null;
  contextUsage: ComposerContextUsage | null;
  compactDisabled: boolean;
  isCompacting: boolean;
  modelButtonRef: RefObject<HTMLButtonElement | null>;
  modelMenuOpen: boolean;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  onOpenGitOps: () => void;
  onOpenTakeoverTerminal: () => void;
  onCompact: () => void;
  onSelectBaseline: (baseline: ProjectDiffBaseline) => void;
  onSelectModel: (model: ComposerModel) => void;
  onSelectThinkingLevel: (level: ComposerThinkingLevel) => void;
  onSetOpenMenu: Dispatch<SetStateAction<"model" | "picker" | null>>;
  onToggleArtifacts?: () => void;
  onToggleTerminal: () => void;
  projectGitState: ProjectGitState | null;
  projectId: string;
  showTerminalControls?: boolean;
  artifactsVisible?: boolean;
  artifactsAvailable?: boolean;
  terminalVisible: boolean;
  thinkingLevel: ComposerThinkingLevel;
  thinkingLevelLabels: Record<ComposerThinkingLevel, string>;
};

export function ComposerFooter({
  availableModels,
  availableThinkingLevels,
  composerPanelRef,
  diffBaseline,
  model,
  contextUsage,
  compactDisabled,
  isCompacting,
  modelButtonRef,
  modelMenuOpen,
  modelMenuRef,
  onCompact,
  onSelectBaseline,
  onSelectModel,
  onSelectThinkingLevel,
  onSetOpenMenu,
  onToggleArtifacts,
  projectGitState,
  projectId,
  showTerminalControls = true,
  artifactsVisible = false,
  artifactsAvailable = Boolean(onToggleArtifacts),
  thinkingLevel,
  thinkingLevelLabels,
}: ComposerFooterProps) {
  return (
    <div className={workspaceFooterRowClass}>
      <div className="relative inline-flex h-7 items-center">
        <ToolbarButton
          ref={modelButtonRef}
          label="Agente"
          icon={<Bot size={14} />}
          tooltip={null}
          className={cn(workspaceFooterTextClass, "pr-8")}
          onClick={() => onSetOpenMenu((current) => (current === "model" ? null : "model"))}
          aria-haspopup="menu"
          aria-expanded={modelMenuOpen}
          aria-controls="composer-model-menu"
        />
        <div className="absolute top-0 right-0">
          <ComposerContextMeter
            contextUsage={contextUsage}
            compactDisabled={compactDisabled}
            isCompacting={isCompacting}
            onCompact={onCompact}
          />
        </div>
        {modelMenuOpen ? (
          <ComposerModelPopover
            availableModels={availableModels}
            availableThinkingLevels={availableThinkingLevels}
            currentModel={model}
            currentThinkingLevel={thinkingLevel}
            panelRef={modelMenuRef}
            thinkingLevelLabels={thinkingLevelLabels}
            onSelectModel={onSelectModel}
            onSelectThinkingLevel={onSelectThinkingLevel}
          />
        ) : null}
      </div>
      <div className={workspaceFooterTrailingGroupClass}>
        {projectGitState?.isGitRepo ? (
          <ComposerDiffBaselineSelector
            composerPanelRef={composerPanelRef}
            projectId={projectId}
            projectGitState={projectGitState}
            selectedBaseline={diffBaseline}
            onSelectBaseline={onSelectBaseline}
          />
        ) : null}
        {projectGitState?.isGitRepo ? (
          <WorkspaceBranchChip branch={projectGitState.branch} />
        ) : null}
        {!showTerminalControls ? (
          <ToolbarButton
            label="Artifacts"
            icon={<FileCode2 size={14} />}
            trailing
            className={cn(
              workspaceFooterTextClass,
              iconActionButtonDisabledClass,
              artifactsVisible && "bg-[rgba(255,255,255,0.04)] text-[color:var(--text)]",
            )}
            onClick={onToggleArtifacts}
            disabled={!artifactsAvailable || !onToggleArtifacts}
            aria-disabled={!artifactsAvailable || !onToggleArtifacts}
          />
        ) : null}
      </div>
    </div>
  );
}
