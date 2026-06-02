import { cn } from "../../utils/cn";

type BotActivityMarkProps = {
  state: "active" | "complete";
  label?: string | null;
  className?: string;
};

export function BotActivityMark({ state, label, className }: BotActivityMarkProps) {
  return (
    <div
      className={cn(
        "bot-activity-mark",
        state === "active" ? "bot-activity-mark--active" : "bot-activity-mark--complete",
        className,
      )}
      aria-label={label ?? (state === "active" ? "El asistente está trabajando" : "Respuesta terminada")}
    >
      <span className="bot-activity-mark__logo-wrap" aria-hidden="true">
        <img src="/logo_white_no_letters.png" alt="" className="bot-activity-mark__logo" />
      </span>
      {label ? <span className="bot-activity-mark__label">{label}</span> : null}
    </div>
  );
}
