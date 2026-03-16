import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";

interface SettingsProps {
  onClose: () => void;
}

const PERMISSION_MODES = [
  {
    id: "default",
    label: "Default",
    description: "Ask for permission on each tool use",
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-approve file edits, ask for others",
  },
  {
    id: "bypassPermissions",
    label: "Bypass All",
    description: "Auto-approve everything (use with caution)",
  },
] as const;

export default function Settings({ onClose }: SettingsProps) {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const permissionMode = useAppStore((s) => s.permissionMode);

  const handlePermissionModeChange = (mode: string) => {
    wsService.setPermissionMode(mode);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="modal-content"
        role="document"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>Theme</h3>
            <div className="settings-theme-buttons">
              <button
                type="button"
                className={`settings-theme-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${theme === "claude" ? "active" : ""}`}
                onClick={() => setTheme("claude")}
              >
                Claude
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Permission Mode</h3>
            <div className="settings-permission-modes">
              {PERMISSION_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  className={`settings-permission-btn ${permissionMode === mode.id ? "active" : ""}`}
                  onClick={() => handlePermissionModeChange(mode.id)}
                >
                  <span className="settings-permission-label">{mode.label}</span>
                  <span className="settings-permission-desc">{mode.description}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
