import { useState, useEffect } from "react";
import type { Capabilities } from "../stores/app-store";

const PINS_KEY = "cc-touch-pinned-commands";

function loadPins(): string[] {
  try {
    const stored = localStorage.getItem(PINS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePins(pins: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
}

type QuickActionsProps = {
  capabilities: Capabilities | null;
  onCommand: (command: string) => void;
  disabled: boolean;
};

export default function QuickActions({
  capabilities,
  onCommand,
  disabled,
}: QuickActionsProps) {
  const [pins, setPins] = useState<string[]>(loadPins);
  const [showManager, setShowManager] = useState(false);

  useEffect(() => {
    savePins(pins);
  }, [pins]);

  if (!capabilities) return null;

  const allItems = [
    ...capabilities.commands.map((c) => ({ label: `/${c}`, value: `/${c}`, type: "command" as const })),
    ...capabilities.agents.map((a) => ({ label: `@${a}`, value: `@${a}`, type: "agent" as const })),
  ];

  const pinnedItems = allItems.filter((item) => pins.includes(item.value));

  const togglePin = (value: string) => {
    setPins((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  return (
    <>
      <div className="quick-actions">
        <div className="quick-actions-row">
          {pinnedItems.map((item) => (
            <button
              key={item.value}
              className={`quick-action-btn ${item.type}`}
              onClick={() => onCommand(item.value)}
              disabled={disabled}
            >
              {item.label}
            </button>
          ))}
          <button
            className="quick-action-btn manage"
            onClick={() => setShowManager(!showManager)}
          >
            {showManager ? "Done" : "..."}
          </button>
        </div>
      </div>

      {showManager && (
        <div className="command-manager">
          {allItems.map((item) => (
            <button
              key={item.value}
              className={`manager-item ${pins.includes(item.value) ? "pinned" : ""}`}
              onClick={() => togglePin(item.value)}
            >
              <span className="manager-item-label">{item.label}</span>
              <span className="manager-item-pin">
                {pins.includes(item.value) ? "Unpin" : "Pin"}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
