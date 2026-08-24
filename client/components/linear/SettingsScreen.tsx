import { useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import { notificationService } from "../../services/notification";
import {
  getCachedPublicKey,
  uploadSubscription,
  urlBase64ToUint8Array,
} from "../../services/push-service";
import { swRegistrationManager } from "../../services/sw-registration";
import { toastService } from "../../services/toast-service";
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
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);
  const deviceName = useSettingsStore((s) => s.deviceName);
  const setDeviceName = useSettingsStore((s) => s.setDeviceName);

  const defaultCwd = useSettingsStore((s) => s.defaultCwd);

  // Notification API only exists in iOS standalone PWAs (Add to Home Screen);
  // a plain Safari tab has no `Notification` at all.
  const notifSupported = typeof window !== "undefined" && "Notification" in window;
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(
    notifSupported ? Notification.permission : null,
  );
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const hapticSupported = hapticService.isSupported();

  const notifDesc = isEnablingPush
    ? "Enabling…"
    : !notifSupported
      ? "Add to Home Screen to enable (iOS)"
      : notifPermission === "denied"
        ? "Blocked — allow notifications in system settings"
        : "Permission requests & completion";

  const handleNotificationsChange = async (next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      return;
    }

    // Enabling path
    const registration = swRegistrationManager.getRegistration();
    if (!registration) {
      toastService.error("Service worker not ready — reload and try again");
      return;
    }

    const hasPushManager =
      typeof window !== "undefined" && "PushManager" in window && registration.pushManager != null;

    if (!hasPushManager) {
      // T6 fallback: no PushManager, use legacy Notification.request only
      if (notifSupported && Notification.permission !== "granted") {
        const result = await notificationService.requestPermission();
        setNotifPermission(result);
        if (result !== "granted") {
          toastService.error("Notification permission was not granted");
          return;
        }
      }
      setNotificationsEnabled(true);
      return;
    }

    const publicKey = getCachedPublicKey();
    if (publicKey === null) {
      toastService.error("Push is not configured on the server");
      return;
    }

    // IMPORTANT: pushManager.subscribe() call must be the first statement
    // that can suspend after entering handler (no prior await on this path).
    // Transient activation for iOS must be live at subscribe() time.
    setIsEnablingPush(true);
    registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      .then(async (subscription) => {
        try {
          await uploadSubscription(subscription.toJSON() as any);
          setNotificationsEnabled(true);
          // no success toast (T8)
        } catch {
          toastService.error("Could not register this device for push");
          // enabled remains false
        }
      })
      .catch((err: any) => {
        if (err && err.name === "NotAllowedError") {
          toastService.error("Notification permission was not granted");
        } else {
          toastService.error("Could not enable notifications");
        }
      })
      .finally(() => {
        setIsEnablingPush(false);
      });
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
                disabled={!notifSupported || isEnablingPush}
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
            <label className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Device name</div>
                <div className="lin-settings-row-desc">Identifies this device in the audit log</div>
              </div>
              <input
                className="lin-settings-row-value"
                value={deviceName}
                maxLength={200}
                onChange={(event) => setDeviceName(event.target.value)}
                aria-label="Device name"
              />
            </label>
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Default folder</div>
              </div>
              <div className="lin-settings-row-value is-mono">{defaultCwd || "—"}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
