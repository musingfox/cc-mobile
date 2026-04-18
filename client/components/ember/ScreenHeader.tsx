import type { ReactNode } from "react";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  showPill?: boolean;
}

export default function ScreenHeader({
  title,
  subtitle,
  leftSlot,
  rightSlot,
  showPill = true,
}: ScreenHeaderProps) {
  return (
    <header className="ember-screen-header" role="banner">
      <div className="ember-screen-header-top">
        {leftSlot && <div className="ember-screen-header-left">{leftSlot}</div>}
        {showPill && <span className="ember-screen-header-pill">ember</span>}
        <h1 className="ember-screen-header-title">{title || ""}</h1>
        {rightSlot && <div className="ember-screen-header-right">{rightSlot}</div>}
      </div>
      {subtitle && <div className="ember-screen-header-subtitle">{subtitle}</div>}
    </header>
  );
}
