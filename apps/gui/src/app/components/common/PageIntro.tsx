import type { ReactNode } from "react";

type PageIntroProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
};

export function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <div>
      <span className="text-[13px] uppercase tracking-[0.12em] text-[color:var(--muted)]">
        {eyebrow}
      </span>
      <h1 className="m-0 text-[clamp(37px,6vw,57px)] font-medium text-[color:var(--accent)]">
        {title}
      </h1>
      <p className="max-w-[720px] whitespace-normal text-[color:var(--muted)]">{description}</p>
    </div>
  );
}
