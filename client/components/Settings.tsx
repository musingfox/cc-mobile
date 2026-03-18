import { hapticService } from "../services/haptic";
import { notificationService } from "../services/notification";
import { voiceInputService } from "../services/voice-input";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import DrawerBase from "./drawers/DrawerBase";
import EnvVarEditor from "./EnvVarEditor";

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

  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const voiceInputEnabled = useSettingsStore((s) => s.voiceInputEnabled);
  const setVoiceInputEnabled = useSettingsStore((s) => s.setVoiceInputEnabled);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);

  const handlePermissionModeChange = (mode: string) => {
    wsService.setPermissionMode(mode);
  };

  const handleNotificationsToggle = async () => {
    if (!notificationsEnabled) {
      const permission = await notificationService.requestPermission();
      if (permission === "granted") {
        setNotificationsEnabled(true);
      }
    } else {
      setNotificationsEnabled(false);
    }
  };

  const handleVoiceInputToggle = () => {
    setVoiceInputEnabled(!voiceInputEnabled);
  };

  const handleHapticsToggle = () => {
    setHapticsEnabled(!hapticsEnabled);
  };

  return (
    <DrawerBase
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Settings"
    >
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

        <section className="settings-section">
          <h3>PWA Features</h3>
          <div className="settings-theme-buttons">
            <button
              type="button"
              className={`settings-theme-btn ${notificationsEnabled ? "active" : ""}`}
              onClick={handleNotificationsToggle}
              disabled={!notificationService.isSupported()}
            >
              Notifications
            </button>
            <button
              type="button"
              className={`settings-theme-btn ${voiceInputEnabled ? "active" : ""}`}
              onClick={handleVoiceInputToggle}
              disabled={!voiceInputService.isSupported()}
            >
              Voice Input
            </button>
            <button
              type="button"
              className={`settings-theme-btn ${hapticsEnabled ? "active" : ""}`}
              onClick={handleHapticsToggle}
              disabled={!hapticService.isSupported()}
            >
              Haptic Feedback
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3>Environment Variables</h3>
          <EnvVarEditor />
        </section>
      </div>
    </DrawerBase>
  );
}
