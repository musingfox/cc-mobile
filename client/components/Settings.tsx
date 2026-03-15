import { useState, useEffect } from "react";
import { useSettingsStore } from "../stores/settings-store";
import type { Theme } from "../services/settings";
import { useAppStore } from "../stores/app-store";

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

interface SettingsProps {
  onClose: () => void;
}

export default function Settings({ onClose }: SettingsProps) {
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const theme = useSettingsStore((s) => s.theme);
  const setDefaultCwd = useSettingsStore((s) => s.setDefaultCwd);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const capabilities = useAppStore((s) => s.capabilities);

  const [cwdInput, setCwdInput] = useState(defaultCwd);
  const [pins, setPins] = useState<string[]>(loadPins);

  useEffect(() => {
    savePins(pins);
  }, [pins]);

  const handleSaveCwd = () => {
    setDefaultCwd(cwdInput);
  };

  const togglePin = (value: string) => {
    setPins((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  const allItems = capabilities
    ? [
        ...capabilities.commands.map((c) => ({ label: `/${c}`, value: `/${c}`, type: "command" as const })),
        ...capabilities.agents.map((a) => ({ label: `@${a}`, value: `@${a}`, type: "agent" as const })),
      ]
    : [];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>Default Working Directory</h3>
            <div className="settings-cwd-input-group">
              <input
                className="settings-input"
                value={cwdInput}
                onChange={(e) => setCwdInput(e.target.value)}
                placeholder="e.g. ~/workspace/my-project"
              />
              <button className="settings-save-btn" onClick={handleSaveCwd}>
                Save
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Theme</h3>
            <div className="settings-theme-buttons">
              <button
                className={`settings-theme-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
              <button
                className={`settings-theme-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
              <button
                className={`settings-theme-btn ${theme === "claude" ? "active" : ""}`}
                onClick={() => setTheme("claude")}
              >
                Claude
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Pin Management</h3>
            {allItems.length === 0 ? (
              <p className="settings-no-items">No commands or agents available. Create a session first.</p>
            ) : (
              <div className="settings-pin-list">
                {allItems.map((item) => (
                  <button
                    key={item.value}
                    className={`settings-pin-item ${pins.includes(item.value) ? "pinned" : ""}`}
                    onClick={() => togglePin(item.value)}
                  >
                    <span className="settings-pin-label">{item.label}</span>
                    <span className="settings-pin-action">
                      {pins.includes(item.value) ? "Unpin" : "Pin"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
