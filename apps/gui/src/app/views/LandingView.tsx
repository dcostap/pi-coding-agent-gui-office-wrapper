import type { AppSettings, DesktopActionInvoker } from "../desktop/types";
import type { Project } from "../types";
import { cn } from "../utils/cn";

type LandingViewProps = {
  appSettings: AppSettings;
  projectName: string;
  projects: Project[];
  selectedProjectId: string;
  className?: string;
  onAction: DesktopActionInvoker;
  onSelectProject: (projectId: string) => void;
};

const OFFICE_AGENT_VERSION = "0.1";

export function LandingView({ className }: LandingViewProps) {
  return (
    <section
      className={cn(
        "mx-auto flex min-h-full w-full select-none items-start justify-center px-6 pt-[clamp(1.75rem,5vh,3.5rem)]",
        className,
      )}
      aria-label="Bienvenida a Castrosua IA"
    >
      <div className="grid w-full max-w-[560px] justify-items-center gap-1 text-center">
        <img
          src="./office-agent-logo-white.png"
          alt="Castrosua"
          className="h-auto w-[min(390px,58vw)] select-none"
          draggable={false}
        />

        <p className="text-[14px] font-medium tracking-[0.08em] text-[color:var(--muted)]">
          v{OFFICE_AGENT_VERSION}
        </p>
      </div>
    </section>
  );
}
