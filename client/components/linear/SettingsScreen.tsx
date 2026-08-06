import { useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import { notificationService } from "../../services/notification";
import { toastService } from "../../services/toast-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import type { LinearScreen } from "./AppShell";
import "./settings.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

function Toggle({ on, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className={`lin-toggle ${on ? "is-on" : ""}`}
      onClick={() => {
        if (disabled) return;
        hapticService.tap();
        onChange(!on);
      }}
      aria-pressed={on}
      aria-disabled={disabled}
      disabled={disabled}
    >
      <span className="lin-toggle-knob" />
    </button>
  );
}

export default function SettingsScreen({ onNavigate }: Props) {
  const capabilities = useAppStore((s) => s.capabilities);

  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);

  const defaultCwd = useSettingsStore((s) => s.defaultCwd);

  const account = capabilities?.accountInfo;

  // Notification API only exists in iOS standalone PWAs (Add to Home Screen);
  // a plain Safari tab has no `Notification` at all.
  const notifSupported = typeof window !== "undefined" && "Notification" in window;
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(
    notifSupported ? Notification.permission : null,
  );
  const hapticSupported = hapticService.isSupported();

  const notifDesc = !notifSupported
    ? "Add to Home Screen to enable (iOS)"
    : notifPermission === "denied"
      ? "Blocked — allow notifications in system settings"
      : "Permission requests & completion";

  const handleNotificationsChange = async (next: boolean) => {
    if (next && notifSupported && Notification.permission !== "granted") {
      const result = await notificationService.requestPermission();
      setNotifPermission(result);
      if (result !== "granted") {
        toastService.error("Notification permission was not granted");
        return;
      }
    }
    setNotificationsEnabled(next);
  };

  return (
    <div className="lin-settings">
      <header className="lin-settings-header">
        <button
          type="button"
          className="lin-icon-btn"
          onClick={() => onNavigate("projects")}
          aria-label="Back"
        >
          <Icon name="chevronL" size={18} color={T.fg2} />
        </button>
        <div className="lin-settings-title">Settings</div>
      </header>

      <div className="lin-settings-body lin-scroll">
        {/* APPEARANCE */}
        <section className="lin-settings-group">
          <div className="lin-settings-group-label">APPEARANCE</div>
          <div className="lin-settings-card">
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Theme</div>
                <div className="lin-settings-row-desc">
                  Neutral greyscale (color themes coming later)
                </div>
              </div>
              <div className="lin-settings-row-value">Linear</div>
            </div>
            {/* Reported by the agent, not chosen here: cc-mobile stopped
                deciding an agent's settings, so this reads back rather than
                sets. */}
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Model</div>
                <div className="lin-settings-row-desc">Whatever the agent is running</div>
              </div>
              <div className="lin-settings-row-value is-mono">{capabilities?.model || "—"}</div>
            </div>
          </div>
        </section>

        {/* BEHAVIOR */}
        <section className="lin-settings-group">
          <div className="lin-settings-group-label">BEHAVIOR</div>
          <div className="lin-settings-card">
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Notifications</div>
                <div className="lin-settings-row-desc">{notifDesc}</div>
              </div>
              <Toggle
                on={notificationsEnabled}
                onChange={handleNotificationsChange}
                disabled={!notifSupported}
              />
            </div>
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Haptics</div>
                <div className="lin-settings-row-desc">
                  {hapticSupported
                    ? "Vibrate on taps and stream events"
                    : "Not supported on this device"}
                </div>
              </div>
              <Toggle
                on={hapticsEnabled}
                onChange={setHapticsEnabled}
                disabled={!hapticSupported}
              />
            </div>
          </div>
        </section>

        {/* WORKSPACE */}
        <section className="lin-settings-group">
          <div className="lin-settings-group-label">WORKSPACE</div>
          <div className="lin-settings-card">
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Default folder</div>
              </div>
              <div className="lin-settings-row-value is-mono">{defaultCwd || "—"}</div>
            </div>
            {account?.email && (
              <div className="lin-settings-row is-static">
                <div className="lin-settings-row-main">
                  <div className="lin-settings-row-title">Account</div>
                </div>
                <div className="lin-settings-row-value">{account.email}</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
