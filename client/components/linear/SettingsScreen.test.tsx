import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import SettingsScreen, { PERMISSION_MODES } from "./SettingsScreen";

describe("SettingsScreen", () => {
  const originalTap = hapticService.tap;
  const originalSetModel = wsService.setModel;
  const originalSetPermissionMode = wsService.setPermissionMode;

  beforeEach(() => {
    useAppStore.setState({ capabilities: null, permissionMode: "auto" });
    useSettingsStore.setState({
      permissionMode: "auto",
      model: "claude-sonnet-4",
      defaultCwd: "/tmp/project",
      envVars: {},
      notificationsEnabled: true,
      hapticsEnabled: true,
    });
  });

  afterEach(() => {
    hapticService.tap = originalTap;
    wsService.setModel = originalSetModel;
    wsService.setPermissionMode = originalSetPermissionMode;
    cleanup();
  });

  test("renders model row showing current model displayName when capabilities loaded", () => {
    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "claude-sonnet-4",
        models: [
          { value: "claude-sonnet-4", displayName: "Sonnet 4", description: "Balanced" },
          { value: "claude-opus-4", displayName: "Opus 4", description: "Most capable" },
        ],
      },
    });

    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(getByText("Model")).not.toBeNull();
    expect(getByText("Sonnet 4")).not.toBeNull();
  });

  test("clicking the model row opens ModelSheet with all options", () => {
    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "claude-sonnet-4",
        models: [
          { value: "claude-sonnet-4", displayName: "Sonnet 4", description: "Balanced" },
          { value: "claude-opus-4", displayName: "Opus 4", description: "Most capable" },
        ],
      },
    });

    const { getByText, queryByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(queryByText("Opus 4")).toBeNull();

    fireEvent.click(getByText("Model").closest(".lin-settings-row") as HTMLElement);
    expect(getByText("Opus 4")).not.toBeNull();
  });

  test("model row opens sheet with fallback aliases when capabilities are null", () => {
    useAppStore.setState({ capabilities: null });

    const { getByText, queryByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(queryByText("Opus")).toBeNull();
    fireEvent.click(getByText("Model").closest(".lin-settings-row") as HTMLElement);

    expect(getByText("Opus")).not.toBeNull();
    expect(getByText("Sonnet")).not.toBeNull();
    expect(getByText("Haiku")).not.toBeNull();
  });

  test("model row opens sheet with fallback aliases when model list is empty", () => {
    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "x",
        models: [],
      },
    });

    const { getByText, queryByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(queryByText("Loading models…")).toBeNull();
    fireEvent.click(getByText("Model").closest(".lin-settings-row") as HTMLElement);
    expect(getByText("Opus")).not.toBeNull();
  });

  test("C3a-TC1: permission modes include auto entry", () => {
    const autoMode = PERMISSION_MODES.find((m) => m.id === "auto");
    expect(autoMode).toBeDefined();
    expect(autoMode?.title.length).toBeGreaterThan(0);
    expect(autoMode?.desc.length).toBeGreaterThan(0);
  });

  test("C3a-TC2: permission mode is a static display showing Auto, not a selector", () => {
    const setPermissionModeMock = mock(() => {});
    wsService.setPermissionMode = setPermissionModeMock as typeof wsService.setPermissionMode;

    const { getByText, queryByText } = render(<SettingsScreen onNavigate={() => {}} />);
    const autoTitle = getByText("Auto");

    // Display-only: row is static, no radios, other modes are not rendered
    const autoRow = autoTitle.closest(".lin-settings-row");
    expect(autoRow?.classList.contains("is-static")).toBe(true);
    expect(autoRow?.querySelector(".lin-radio")).toBeNull();
    expect(queryByText("Bypass All")).toBeNull();
    expect(queryByText("Accept Edits")).toBeNull();

    // Clicking it does nothing
    fireEvent.click(autoRow as HTMLElement);
    expect(setPermissionModeMock).toHaveBeenCalledTimes(0);
    expect(useSettingsStore.getState().permissionMode).toBe("auto");
  });

  test("opens env var sheet from workspace environment row", () => {
    const { getByText, getByPlaceholderText } = render(<SettingsScreen onNavigate={() => {}} />);

    fireEvent.click(getByText("Environment"));

    expect(getByPlaceholderText("Key")).not.toBeNull();
    expect(getByPlaceholderText("Value")).not.toBeNull();
  });
});
