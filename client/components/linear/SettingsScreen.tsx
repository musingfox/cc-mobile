import { useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import type { LinearScreen } from "./AppShell";
import EnvVarSheet from "./EnvVarSheet";
import "./settings.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

interface PermissionMode {
  id: string;
  title: string;
  desc: string;
  warn?: boolean;
}

const PERMISSION_MODES: PermissionMode[] = [
  { id: "default", title: "Default", desc: "Ask for permission on each tool use" },
  {
    id: "acceptEdits",
    title: "Accept Edits",
    desc: "Auto-approve file edits, ask for others",
  },
  {
    id: "plan",
    title: "Plan",
    desc: "Require plan approval before implementation",
  },
  {
    id: "bypassPermissions",
    title: "Bypass All",
    desc: "Auto-approve everything (use with caution)",
    warn: true,
  },
];

interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
}

function Toggle({ on, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      className={`lin-toggle ${on ? "is-on" : ""}`}
      onClick={() => {
        hapticService.tap();
        onChange(!on);
      }}
      aria-pressed={on}
    >
      <span className="lin-toggle-knob" />
    </button>
  );
}

export default function SettingsScreen({ onNavigate }: Props) {
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const setPermissionMode = useSettingsStore((s) => s.setPermissionMode);
  const setStorePermMode = useAppStore((s) => s.setPermissionMode);

  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const capabilities = useAppStore((s) => s.capabilities);

  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);

  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const envVars = useSettingsStore((s) => s.envVars);

  const account = capabilities?.accountInfo;
  const models = capabilities?.models ?? [];
  const [envOpen, setEnvOpen] = useState(false);

  const handleSelectMode = (id: string) => {
    hapticService.tap();
    setPermissionMode(id);
    setStorePermMode(id);
    wsService.setPermissionMode(id);
  };

  const handleSelectModel = (value: string) => {
    hapticService.tap();
    setModel(value);
    wsService.setModel(value);
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
        {/* PERMISSION MODE */}
        <section className="lin-settings-group">
          <div className="lin-settings-group-label">PERMISSION MODE</div>
          <div className="lin-settings-card">
            {PERMISSION_MODES.map((m) => {
              const selected = permissionMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="lin-settings-row"
                  onClick={() => handleSelectMode(m.id)}
                >
                  <span className={`lin-radio ${selected ? "is-selected" : ""}`} aria-hidden>
                    {selected && <span className="lin-radio-dot" />}
                  </span>
                  <div className="lin-settings-row-main">
                    <div
                      className="lin-settings-row-title"
                      style={m.warn ? { color: T.diffRemoveText } : undefined}
                    >
                      {m.title}
                    </div>
                    <div className="lin-settings-row-desc">{m.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

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
            {capabilities === null ? (
              <div className="lin-settings-row is-static">
                <div className="lin-settings-row-main">
                  <div className="lin-settings-row-title">Model</div>
                  <div className="lin-settings-row-desc">Loading models…</div>
                </div>
                <div className="lin-settings-row-value is-mono">{model || "—"}</div>
              </div>
            ) : models.length === 0 ? (
              <div className="lin-settings-row is-static">
                <div className="lin-settings-row-main">
                  <div className="lin-settings-row-title">Model</div>
                </div>
                <div className="lin-settings-row-value is-mono">{model || "—"}</div>
              </div>
            ) : (
              models.map((m) => {
                const selected = m.value === model;
                return (
                  <button
                    key={m.value}
                    type="button"
                    className="lin-settings-row"
                    onClick={() => handleSelectModel(m.value)}
                  >
                    <span className={`lin-radio ${selected ? "is-selected" : ""}`} aria-hidden>
                      {selected && <span className="lin-radio-dot" />}
                    </span>
                    <div className="lin-settings-row-main">
                      <div className="lin-settings-row-title">{m.displayName}</div>
                      {m.description && <div className="lin-settings-row-desc">{m.description}</div>}
                    </div>
                    <div className="lin-settings-row-value is-mono">{m.value}</div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* BEHAVIOR */}
        <section className="lin-settings-group">
          <div className="lin-settings-group-label">BEHAVIOR</div>
          <div className="lin-settings-card">
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Notifications</div>
                <div className="lin-settings-row-desc">Permission requests &amp; completion</div>
              </div>
              <Toggle on={notificationsEnabled} onChange={setNotificationsEnabled} />
            </div>
            <div className="lin-settings-row is-static">
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Haptics</div>
                <div className="lin-settings-row-desc">Vibrate on taps and stream events</div>
              </div>
              <Toggle on={hapticsEnabled} onChange={setHapticsEnabled} />
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
            <button
              type="button"
              className="lin-settings-row"
              onClick={() => setEnvOpen(true)}
            >
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">Environment</div>
              </div>
              <div className="lin-settings-row-value">{Object.keys(envVars).length} vars</div>
            </button>
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
      <EnvVarSheet open={envOpen} onClose={() => setEnvOpen(false)} />
    </div>
  );
}
