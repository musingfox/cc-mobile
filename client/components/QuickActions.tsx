import { useState, useEffect } from "react";
import { useAppStore, type Capabilities } from "../stores/app-store";

const PINS_KEY = "cc-touch-pinned-commands";

function loadPins(): string[] {
  try {
    const stored = localStorage.getItem(PINS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

type QuickActionsProps = {
  capabilities: Capabilities | null;
  disabled: boolean;
};

export default function QuickActions({
  capabilities,
  disabled,
}: QuickActionsProps) {
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const [pins, setPins] = useState<string[]>(loadPins);

  useEffect(() => {
    const handleStorageChange = () => {
      setPins(loadPins());
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(handleStorageChange, 500);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  if (!capabilities) return null;

  const allItems = [
    ...capabilities.commands.map((c) => ({ label: `/${c}`, value: `/${c}`, type: "command" as const })),
    ...capabilities.agents.map((a) => ({ label: `@${a}`, value: `@${a}`, type: "agent" as const })),
  ];

  const pinnedItems = allItems.filter((item) => pins.includes(item.value));

  return (
    <div className="quick-actions">
      <div className="quick-actions-row">
        {pinnedItems.map((item) => (
          <button
            key={item.value}
            className={`quick-action-btn ${item.type}`}
            onClick={() => setInputDraft(item.value + " ")}
            disabled={disabled}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
