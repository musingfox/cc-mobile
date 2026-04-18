import type { ReactNode } from "react";

interface IconButtonProps {
  icon: ReactNode;
  onClick: () => void;
  label: string;
  variant?: "default" | "ghost" | "accent";
  disabled?: boolean;
  size?: number;
}

export default function IconButton({
  icon,
  onClick,
  label,
  variant = "default",
  disabled = false,
  size = 28,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`ember-icon-button ember-icon-button--${variant}`}
      style={{ "--icon-size": `${size}px` } as React.CSSProperties}
    >
      {icon}
    </button>
  );
}
