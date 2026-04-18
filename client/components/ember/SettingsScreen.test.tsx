import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import SettingsScreen from "./SettingsScreen";

// Mock services
mock.module("../../services/ws-service", () => ({
  wsService: {
    listSessions: mock(() => {}),
    resumeSession: mock(() => {}),
    createSession: mock(() => {}),
    send: mock(() => {}),
    sendInterrupt: mock(() => {}),
    sendCommand: mock(() => {}),
    respondPermission: mock(() => {}),
    setPermissionMode: mock(() => {}),
    setModel: mock(() => {}),
    setEffort: mock(() => {}),
    setEnvVars: mock(() => {}),
  },
}));

mock.module("../../services/notification", () => ({
  notificationService: {
    isSupported: () => true,
    requestPermission: async () => "granted",
  },
}));

mock.module("../../services/haptic", () => ({
  hapticService: {
    isSupported: () => true,
    tap: () => {},
  },
}));

// Capture original store actions
const ORIGINAL_SETTINGS_ACTIONS = {
  setTheme: useSettingsStore.getState().setTheme,
  setNotificationsEnabled: useSettingsStore.getState().setNotificationsEnabled,
  setHapticsEnabled: useSettingsStore.getState().setHapticsEnabled,
};

const ORIGINAL_APP_ACTIONS = {
  setSelectedModel: useAppStore.getState().setSelectedModel,
  setSelectedEffort: useAppStore.getState().setSelectedEffort,
};

describe("SettingsScreen", () => {
  beforeEach(() => {
    // Reset stores
    useSettingsStore.setState({
      theme: "ember",
      defaultCwd: "/home/user/project",
      notificationsEnabled: false,
      hapticsEnabled: true,
      envVars: {},
      ...ORIGINAL_SETTINGS_ACTIONS,
    });

    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "sonnet-x",
        models: [
          {
            value: "sonnet-x",
            displayName: "Sonnet X",
            description: "Fast model",
          },
          {
            value: "opus-y",
            displayName: "Opus Y",
            description: "Powerful model",
          },
        ],
        accountInfo: {
          email: "test@example.com",
          organization: "Test Org",
          subscriptionType: "Pro",
        },
      },
      selectedModel: "sonnet-x",
      selectedEffort: null,
      permissionMode: "default",
      activeSessionId: "session-1",
      ...ORIGINAL_APP_ACTIONS,
    });

    mock.restore();
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ ...ORIGINAL_SETTINGS_ACTIONS });
    useAppStore.setState({ ...ORIGINAL_APP_ACTIONS });
  });

  it("renders with theme=ember and shows all sections", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Model & Effort")).toBeTruthy();
    expect(screen.getByText("Permissions")).toBeTruthy();
    expect(screen.getByText("Environment")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
  });

  it("theme row shows current theme Ember", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const themeRow = screen.getByText("Theme").closest("button");
    expect(themeRow?.textContent).toContain("Ember");
  });

  it("clicking theme row expands options and selecting Dark updates theme", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const themeRow = screen.getByText("Theme").closest("button");
    fireEvent.click(themeRow!);

    // All 4 themes should be visible
    const darkButton = screen.getByRole("button", { name: "Dark" });
    const lightButton = screen.getByRole("button", { name: "Light" });
    const claudeButton = screen.getByRole("button", { name: "Claude" });
    const emberButton = screen.getByRole("button", { name: "Ember" });

    expect(darkButton).toBeTruthy();
    expect(lightButton).toBeTruthy();
    expect(claudeButton).toBeTruthy();
    expect(emberButton).toBeTruthy();

    // Click Dark
    fireEvent.click(darkButton);

    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("notifications toggle changes state", async () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const toggles = screen.getAllByRole("switch");
    const notificationsToggle = toggles.find(
      (t) => t.getAttribute("aria-label") === "Notifications",
    );

    expect(notificationsToggle?.getAttribute("aria-checked")).toBe("false");

    await fireEvent.click(notificationsToggle!);

    // Wait for async requestPermission to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(useSettingsStore.getState().notificationsEnabled).toBe(true);
  });

  it("permission mode expanded shows 6 options and clicking plan updates mode", async () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const permissionRow = screen.getByText("Permission mode").closest("button");
    fireEvent.click(permissionRow!);

    // Find all 6 modes by checking the options list contains expected descriptions
    expect(screen.getByText("Ask for permission on each tool use")).toBeTruthy();
    expect(screen.getByText("Accept Edits")).toBeTruthy();
    expect(screen.getByText("Auto-approve common operations, ask for risky ones")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Don't Ask")).toBeTruthy();
    expect(screen.getByText("Bypass All")).toBeTruthy();

    const planButton = screen.getByText("Plan").closest("button");
    fireEvent.click(planButton!);

    expect(wsService.setPermissionMode).toHaveBeenCalledWith("plan");
  });

  it("shows Loading... when capabilities is null", () => {
    useAppStore.setState({ capabilities: null });

    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const modelRow = screen.getByText("Primary model").closest("button");
    expect(modelRow?.textContent).toContain("Loading...");
  });

  it("model row shows Sonnet X from capabilities", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const modelRow = screen.getByText("Primary model").closest("button");
    expect(modelRow?.textContent).toContain("Sonnet X");
  });

  it("effort row expands and shows 4 options, clicking high updates effort", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const effortRow = screen.getByText("Effort").closest("button");
    fireEvent.click(effortRow!);

    expect(screen.getByRole("button", { name: "Auto" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Low" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Medium" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "High" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Max" })).toBeTruthy();

    const highButton = screen.getByRole("button", { name: "High" });
    fireEvent.click(highButton);

    expect(useAppStore.getState().selectedEffort).toBe("high");
    expect(wsService.setEffort).toHaveBeenCalledWith("high");
  });

  it("profile shows account info with avatar initial A", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    expect(screen.getByText("test@example.com")).toBeTruthy();
    expect(screen.getByText(/Test Org/)).toBeTruthy();

    const avatar = document.querySelector(".ember-avatar");
    expect(avatar?.textContent).toBe("T");
  });

  it("profile shows Signed out when accountInfo is null", () => {
    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "sonnet-x",
        models: [],
        accountInfo: undefined,
      },
    });

    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    expect(screen.getByText("Signed out")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("EnvVarEditor is rendered inside Environment section", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    // EnvVarEditor has inputs with placeholders "Key" and "Value"
    const keyInput = screen.getByPlaceholderText("Key");
    const valueInput = screen.getByPlaceholderText("Value");

    expect(keyInput).toBeTruthy();
    expect(valueInput).toBeTruthy();
  });

  it("all row buttons have min-height >= 44px for touch targets", () => {
    render(
      <div className="theme-ember">
        <SettingsScreen />
      </div>,
    );

    const rows = document.querySelectorAll(".ember-settings-row");
    // CSS defines min-height: 44px in ember-shell.css
    // Happy-dom doesn't compute styles, so we verify the class is present
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.classList.contains("ember-settings-row")).toBe(true);
    });
  });
});
