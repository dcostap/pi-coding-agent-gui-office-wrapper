import { useRef, useState } from "react";
import type { ComposerContextUsage } from "../../../desktop/types";
import { useAnimatedDisclosure } from "../../../hooks/useAnimatedPresence";
import { useDismissibleLayer } from "../../../hooks/useDismissibleLayer";
import { ghostButtonClass } from "../../../ui/classes";
import { cn } from "../../../utils/cn";

type ComposerContextMeterProps = {
  contextUsage: ComposerContextUsage | null;
  isCompacting: boolean;
  compactDisabled: boolean;
  onCompact: () => void;
};

const tokenFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numberFormatter = new Intl.NumberFormat("en");

function formatTokens(value: number | null | undefined, options: { compact?: boolean } = {}) {
  if (value === null || value === undefined) {
    return "Unknown";
  }

  return options.compact ? tokenFormatter.format(value) : numberFormatter.format(value);
}

function getMeterTone(percent: number | null | undefined) {
  if (percent === null || percent === undefined) {
    return "var(--muted)";
  }

  if (percent > 90) {
    return "#ff9f9f";
  }

  if (percent > 70) {
    return "#f2c27f";
  }

  return "var(--accent)";
}

export function ComposerContextMeter({
  contextUsage,
  isCompacting,
  compactDisabled,
  onCompact,
}: ComposerContextMeterProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const percent = contextUsage?.percent ?? null;
  const tokens = contextUsage?.tokens ?? null;
  const contextWindow = contextUsage?.contextWindow ?? null;
  const availableTokens =
    tokens !== null && contextWindow !== null ? Math.max(0, contextWindow - tokens) : null;
  const meterPercent = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const tone = getMeterTone(percent);
  const open = hovered || pinned;
  const popoverDisclosure = useAnimatedDisclosure(open, 180);
  const label = isCompacting
    ? "Compacting context"
    : percent === null || percent === undefined
      ? "Context unknown"
      : `${percent.toFixed(0)}% context`;

  useDismissibleLayer({
    open: pinned,
    onDismiss: () => setPinned(false),
    refs: [buttonRef, popoverRef],
  });

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--text)]"
        onClick={() => setPinned((current) => !current)}
        aria-label={label}
        aria-expanded={open}
      >
        <span
          className={cn("absolute inset-[7px] rounded-full", isCompacting && "animate-pulse")}
          style={{
            background: `conic-gradient(${tone} ${meterPercent * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          }}
        />
        <span className="absolute inset-[11px] rounded-full bg-[color:var(--panel)]" />
      </button>

      {popoverDisclosure.present ? (
        <div
          ref={popoverRef}
          data-open={popoverDisclosure.visible ? "true" : "false"}
          className="motion-popover composer-context-popover absolute bottom-full left-0 z-[130] grid w-48 gap-1.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--panel)] px-3 py-2 text-center text-[12px] text-[color:var(--muted)] shadow-[var(--shadow)]"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="font-medium text-[color:var(--muted)]">Ventana de contexto:</div>
          <div className="font-semibold text-[color:var(--text)]">
            {percent === null || percent === undefined
              ? "Uso desconocido"
              : `${percent.toFixed(0)}% usado (${formatTokens(availableTokens, { compact: true })} disp.)`}
          </div>
          <div className="font-semibold text-[color:var(--text)]">
            {formatTokens(tokens, { compact: true })} / {formatTokens(contextWindow, { compact: true })} tokens usados
          </div>
          {tokens === null ? (
            <div className="text-[11px] text-[color:var(--muted-2)]">
              Se actualizará tras la siguiente respuesta.
            </div>
          ) : null}
          {isCompacting ? (
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-2)] px-2 py-1.5 text-[11px] text-[color:var(--text)]">
              Compactando contexto de la sesión…
            </div>
          ) : null}
          <button
            type="button"
            className={cn(
              ghostButtonClass,
              "mt-1 justify-center border-[color:var(--border)] text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-45",
            )}
            disabled={compactDisabled}
            onClick={() => {
              if (compactDisabled) {
                return;
              }

              setHovered(false);
              setPinned(false);
              onCompact();
            }}
          >
            Compactar contexto
          </button>
        </div>
      ) : null}
    </div>
  );
}
