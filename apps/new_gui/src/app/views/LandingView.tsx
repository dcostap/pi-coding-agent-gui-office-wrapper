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
        "mx-auto flex min-h-full w-full items-start justify-center px-6 pt-[clamp(4.5rem,20vh,12rem)]",
        className,
      )}
      aria-label="Bienvenida a IA corporativa"
    >
      <div className="grid w-full max-w-[760px] justify-items-center gap-1.5 text-center">
        <img
          src="/office-agent-logo-white.png"
          alt="Castrosua"
          className="h-auto w-[min(650px,82vw)] select-none"
          draggable={false}
        />

        <div className="-mt-2 grid w-full max-w-[430px] grid-cols-[1fr_auto_1fr] items-center gap-4 text-[#f2bf20]">
          <span className="h-px bg-current opacity-75" />
          <p className="text-[clamp(20px,3.1vw,30px)] font-light tracking-wide">IA corporativa</p>
          <span className="h-px bg-current opacity-75" />
        </div>

        <p className="-mt-1 text-[18px] font-medium tracking-[0.08em] text-[#6f7f98]">v{OFFICE_AGENT_VERSION}</p>
      </div>
    </section>
  );
}
