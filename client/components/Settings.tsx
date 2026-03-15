import { useSettingsStore } from "../stores/settings-store";
import type { Theme } from "../services/settings";

interface SettingsProps {
  onClose: () => void;
}

export default function Settings({ onClose }: SettingsProps) {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
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
        </div>
      </div>
    </div>
  );
}
