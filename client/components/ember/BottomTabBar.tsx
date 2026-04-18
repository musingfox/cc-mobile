import { Bot, List, MessageSquare, Settings, Terminal } from "lucide-react";
import type { ScreenName } from "../../stores/app-store";

interface BottomTabBarProps {
  activeTab: ScreenName;
  onChange: (tab: ScreenName) => void;
}

const tabs: Array<{ id: ScreenName; label: string; Icon: typeof MessageSquare }> = [
  { id: "sessions", label: "Sessions", Icon: List },
  { id: "agents", label: "Agents", Icon: Bot },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "commands", label: "Commands", Icon: Terminal },
  { id: "settings", label: "Settings", Icon: Settings },
];

export default function BottomTabBar({ activeTab, onChange }: BottomTabBarProps) {
  return (
    <nav className="ember-tab-bar">
      {tabs.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            className={`ember-tab-button ${isActive ? "ember-tab-button--active" : ""}`}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => onChange(id)}
          >
            {isActive && <div className="ember-tab-accent" />}
            <Icon size={18} strokeWidth={2} />
            <span className="ember-tab-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
