import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../utils/cn";

type NavButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
};

export const NavButton = forwardRef<HTMLButtonElement, NavButtonProps>(function NavButton(
  {
    icon,
    label,
    active,
    onClick,
    type = "button",
    className,
    title,
    ...buttonProps
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("sidebar-nav-button", className)}
      onClick={onClick}
      data-active={active ? "true" : "false"}
      aria-current={active ? "page" : undefined}
      data-tooltip={typeof title === "string" ? title : undefined}
      {...buttonProps}
    >
      {icon}
      <span className="sidebar-nav-button__label">{label}</span>
    </button>
  );
});
