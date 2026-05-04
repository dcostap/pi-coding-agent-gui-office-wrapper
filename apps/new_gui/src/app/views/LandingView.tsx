import { type PointerEvent, useState } from "react";
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
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50, active: false });

  const updateSpotlight = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSpotlight({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  };

  return (
    <section
      className={cn(
        "group/landing relative mx-auto flex min-h-full w-full items-start justify-center overflow-hidden px-6 pt-[clamp(4.5rem,20vh,12rem)]",
        className,
      )}
      style={{
        "--landing-spotlight-x": `${spotlight.x}%`,
        "--landing-spotlight-y": `${spotlight.y}%`,
      } as React.CSSProperties}
      onPointerMove={updateSpotlight}
      onPointerEnter={updateSpotlight}
      onPointerLeave={() => setSpotlight((current) => ({ ...current, active: false }))}
      data-spotlight={spotlight.active ? "true" : "false"}
      aria-label="Bienvenida a IA corporativa"
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 ease-out group-data-[spotlight=true]/landing:opacity-100">
        <div className="landing-orbit-field absolute inset-0" />
        <div className="landing-spotlight absolute inset-0" />
      </div>

      <div className="relative grid w-full max-w-[760px] justify-items-center gap-1.5 text-center">
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

        <p className="-mt-1 text-[18px] font-medium tracking-[0.08em] text-[#6f7f98]">
          v{OFFICE_AGENT_VERSION}
        </p>
      </div>
    </section>
  );
}
