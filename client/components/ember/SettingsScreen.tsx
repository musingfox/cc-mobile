import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { hapticService } from "../../services/haptic";
import { notificationService } from "../../services/notification";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import EnvVarEditor from "../EnvVarEditor";
import Avatar from "./Avatar";
import ScreenHeader from "./ScreenHeader";
import ToggleSwitch from "./ToggleSwitch";

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
    id: "auto",
    label: "Auto",
    description: "Auto-approve common operations, ask for risky ones",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Require plan approval before implementation",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Never ask — deny instead of prompting (CI/non-interactive)",
  },
  {
    id: "bypassPermissions",
    label: "Bypass All",
    description: "Auto-approve everything (use with caution)",
  },
] as const;

const THEMES = [
  { value: "dark" as const, label: "Dark" },
  { value: "light" as const, label: "Light" },
  { value: "claude" as const, label: "Claude" },
  { value: "ember" as const, label: "Ember" },
];

const EFFORT_LEVELS = [
  { value: null, label: "Auto" },
  { value: "low" as const, label: "Low" },
  { value: "medium" as const, label: "Medium" },
  { value: "high" as const, label: "High" },
  { value: "max" as const, label: "Max" },
];

type ExpandableRow = "theme" | "model" | "effort" | "permissionMode" | null;

export default function SettingsScreen() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);

  const capabilities = useAppStore((s) => s.capabilities);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const selectedEffort = useAppStore((s) => s.selectedEffort);
  const setSelectedEffort = useAppStore((s) => s.setSelectedEffort);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [expandedRow, setExpandedRow] = useState<ExpandableRow>(null);

  const models = capabilities?.models ?? [];
  const currentModelInfo = models.find((m) => m.value === selectedModel);

  const handleThemeSelect = (value: typeof theme) => {
    hapticService.tap();
    setTheme(value);
    setExpandedRow(null);
  };

  const handleModelSelect = (modelValue: string) => {
    if (modelValue === selectedModel) return;
    hapticService.tap();
    setSelectedModel(modelValue);
    wsService.setModel(modelValue, activeSessionId ?? undefined);
    setExpandedRow(null);
  };

  const handleEffortSelect = (effort: string | null) => {
    hapticService.tap();
    setSelectedEffort(effort);
    wsService.setEffort(effort as "low" | "medium" | "high" | "max" | null);
    setExpandedRow(null);
  };

  const handlePermissionModeSelect = (mode: string) => {
    hapticService.tap();
    wsService.setPermissionMode(mode);
    setExpandedRow(null);
  };

  const handleNotificationsToggle = async () => {
    hapticService.tap();
    if (!notificationsEnabled) {
      const permission = await notificationService.requestPermission();
      if (permission === "granted") {
        setNotificationsEnabled(true);
      }
    } else {
      setNotificationsEnabled(false);
    }
  };

  const handleHapticsToggle = () => {
    hapticService.tap();
    setHapticsEnabled(!hapticsEnabled);
  };

  const toggleRow = (row: ExpandableRow) => {
    hapticService.tap();
    setExpandedRow(expandedRow === row ? null : row);
  };

  const accountInfo = capabilities?.accountInfo;
  const accountEmail = accountInfo?.email ?? "Signed out";
  const accountInitial =
    accountEmail === "Signed out" ? "?" : accountEmail[0]?.toUpperCase() || "?";
  const accountSubtitle = accountInfo
    ? [accountInfo.organization, accountInfo.subscriptionType].filter(Boolean).join(" · ") || "Free"
    : "Not connected";

  const currentThemeLabel = THEMES.find((t) => t.value === theme)?.label ?? "Unknown";
  const currentModelLabel = currentModelInfo?.displayName ?? "Loading...";
  const currentEffortLabel = selectedEffort
    ? selectedEffort.charAt(0).toUpperCase() + selectedEffort.slice(1)
    : "Auto";
  const currentPermissionModeLabel =
    PERMISSION_MODES.find((m) => m.id === permissionMode)?.label ?? "Unknown";

  return (
    <div className="ember-settings-screen">
      <ScreenHeader
        title="Settings"
        subtitle="Local preferences — stored in this browser"
        showPill={false}
      />

      <div className="ember-settings-scroll">
        {/* Profile Card */}
        <div className="ember-profile-card">
          <Avatar label={accountInitial} size={44} variant="gradient" shape="circle" />
          <div className="ember-profile-info">
            <div className="ember-profile-name">{accountEmail}</div>
            <div className="ember-profile-sub">{accountSubtitle}</div>
          </div>
        </div>

        {/* Appearance Section */}
        <section className="ember-settings-section">
          <h2 className="ember-settings-section-title">Appearance</h2>
          <div className="ember-settings-section-content">
            <button
              type="button"
              className="ember-settings-row ember-settings-row--expandable"
              onClick={() => toggleRow("theme")}
            >
              <span className="ember-settings-row-label">Theme</span>
              <span className="ember-settings-row-value">
                {currentThemeLabel}
                <ChevronRight size={14} />
              </span>
            </button>
            {expandedRow === "theme" && (
              <div className="ember-options-list">
                {THEMES.map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    className={`ember-option-chip ${theme === t.value ? "active" : ""}`}
                    onClick={() => handleThemeSelect(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="ember-settings-row ember-settings-row--disabled">
              <span className="ember-settings-row-label">Accent color</span>
              <span className="ember-settings-row-value">Amber</span>
            </div>

            <div className="ember-settings-row ember-settings-row--disabled">
              <span className="ember-settings-row-label">Density</span>
              <span className="ember-settings-row-value">Medium</span>
            </div>
          </div>
        </section>

        {/* Model & Effort Section */}
        <section className="ember-settings-section">
          <h2 className="ember-settings-section-title">Model & Effort</h2>
          <div className="ember-settings-section-content">
            <button
              type="button"
              className="ember-settings-row ember-settings-row--expandable"
              onClick={() => toggleRow("model")}
            >
              <span className="ember-settings-row-label">Primary model</span>
              <span className="ember-settings-row-value">
                {currentModelLabel}
                <ChevronRight size={14} />
              </span>
            </button>
            {expandedRow === "model" && (
              <div className="ember-options-list ember-options-list--vertical">
                {models.length === 0 ? (
                  <div className="ember-option-placeholder">Loading...</div>
                ) : (
                  models.map((model) => (
                    <button
                      type="button"
                      key={model.value}
                      className={`ember-option-row ${selectedModel === model.value ? "active" : ""}`}
                      onClick={() => handleModelSelect(model.value)}
                    >
                      <span className="ember-option-row-label">{model.displayName}</span>
                      {selectedModel === model.value && (
                        <span className="ember-option-row-check">✓</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            <button
              type="button"
              className="ember-settings-row ember-settings-row--expandable"
              onClick={() => toggleRow("effort")}
            >
              <span className="ember-settings-row-label">Effort</span>
              <span className="ember-settings-row-value">
                {currentEffortLabel}
                <ChevronRight size={14} />
              </span>
            </button>
            {expandedRow === "effort" && (
              <div className="ember-options-list">
                {EFFORT_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level.label}
                    className={`ember-option-chip ${selectedEffort === level.value ? "active" : ""}`}
                    onClick={() => handleEffortSelect(level.value)}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Permissions Section */}
        <section className="ember-settings-section">
          <h2 className="ember-settings-section-title">Permissions</h2>
          <div className="ember-settings-section-content">
            <button
              type="button"
              className="ember-settings-row ember-settings-row--expandable"
              onClick={() => toggleRow("permissionMode")}
            >
              <span className="ember-settings-row-label">Permission mode</span>
              <span className="ember-settings-row-value">
                {currentPermissionModeLabel}
                <ChevronRight size={14} />
              </span>
            </button>
            {expandedRow === "permissionMode" && (
              <div className="ember-options-list ember-options-list--vertical">
                {PERMISSION_MODES.map((mode) => (
                  <button
                    type="button"
                    key={mode.id}
                    className={`ember-option-row ${permissionMode === mode.id ? "active" : ""}`}
                    onClick={() => handlePermissionModeSelect(mode.id)}
                  >
                    <div className="ember-option-row-content">
                      <span className="ember-option-row-label">{mode.label}</span>
                      <span className="ember-option-row-desc">{mode.description}</span>
                    </div>
                    {permissionMode === mode.id && (
                      <span className="ember-option-row-check">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="ember-settings-row">
              <span className="ember-settings-row-label">Notifications</span>
              <ToggleSwitch
                checked={notificationsEnabled}
                onChange={handleNotificationsToggle}
                disabled={!notificationService.isSupported()}
                label="Notifications"
              />
            </div>

            <div className="ember-settings-row">
              <span className="ember-settings-row-label">Haptics</span>
              <ToggleSwitch
                checked={hapticsEnabled}
                onChange={handleHapticsToggle}
                disabled={!hapticService.isSupported()}
                label="Haptic Feedback"
              />
            </div>
          </div>
        </section>

        {/* Environment Section */}
        <section className="ember-settings-section">
          <h2 className="ember-settings-section-title">Environment</h2>
          <div className="ember-settings-section-content">
            <EnvVarEditor />
          </div>
        </section>

        {/* Project Section */}
        <section className="ember-settings-section">
          <h2 className="ember-settings-section-title">Project</h2>
          <div className="ember-settings-section-content">
            <div className="ember-settings-row">
              <span className="ember-settings-row-label">Default project</span>
              <span className="ember-settings-row-value">{defaultCwd || "Not set"}</span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="ember-settings-footer">cc-mobile · Ember preview</footer>
      </div>
    </div>
  );
}
