import { useEffect, useState } from "react";
import { loadPins } from "../services/pins";
import { type Capabilities, useAppStore } from "../stores/app-store";

type QuickActionsProps = {
  capabilities: Capabilities | null;
  disabled: boolean;
};

export default function QuickActions({ capabilities, disabled }: QuickActionsProps) {
  const inputDraft = useAppStore((s) => s.inputDraft);
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
    ...capabilities.commands.map((c) => ({
      label: `/${c}`,
      value: `/${c}`,
      type: "command" as const,
    })),
    ...capabilities.agents.map((a) => ({ label: `@${a}`, value: `@${a}`, type: "agent" as const })),
  ];

  const pinnedItems = allItems.filter((item) => pins.includes(item.value));
  const pinnedCommands = pinnedItems.filter((item) => item.type === "command");
  const pinnedAgents = pinnedItems.filter((item) => item.type === "agent");

  if (pinnedCommands.length === 0 && pinnedAgents.length === 0) return null;

  return (
    <div className="quick-actions">
      {pinnedCommands.length > 0 && (
        <div className="quick-actions-row">
          {pinnedCommands.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`quick-action-btn ${item.type}`}
              onClick={() => setInputDraft(`${inputDraft + item.value} `)}
              disabled={disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {pinnedAgents.length > 0 && (
        <div className="quick-actions-row">
          {pinnedAgents.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`quick-action-btn ${item.type}`}
              onClick={() => setInputDraft(`${inputDraft + item.value} `)}
              disabled={disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
