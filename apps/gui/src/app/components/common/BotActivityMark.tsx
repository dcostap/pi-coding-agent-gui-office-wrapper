import { cn } from "../../utils/cn";

type BotActivityMarkProps = {
  state: "active" | "complete";
  label?: string | null;
  className?: string;
};

export function BotActivityMark({ state, label, className }: BotActivityMarkProps) {
  if (!label) {
    return null;
  }

  return (
    <div
      className={cn(
        "bot-activity-mark",
        state === "active" ? "bot-activity-mark--active" : "bot-activity-mark--complete",
        className,
      )}
    >
      <span className="bot-activity-mark__label">{label}</span>
    </div>
  );
}
