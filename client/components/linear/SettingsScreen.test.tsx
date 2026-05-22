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
    useAppStore.setState({ capabilities: null, permissionMode: "default" });
    useSettingsStore.setState({
      permissionMode: "default",
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

  test("shows loading model row when capabilities are null", () => {
    const setModelMock = mock(() => {});
    wsService.setModel = setModelMock as typeof wsService.setModel;

    useAppStore.setState({ capabilities: null });

    const { container, getByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(getByText("Loading models…")).not.toBeNull();
    const staticRows = container.querySelectorAll(".lin-settings-row.is-static");
    expect(staticRows.length > 0).toBe(true);

    fireEvent.click(getByText("Loading models…"));
    expect(setModelMock).toHaveBeenCalledTimes(0);
  });

  test("shows static model row when model list is empty", () => {
    useAppStore.setState({
      capabilities: {
        commands: [],
        agents: [],
        model: "x",
        models: [],
      },
    });

    const { queryByText, getByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(getByText("Model")).not.toBeNull();
    expect(queryByText("Loading models…")).toBeNull();
  });

  test("C3a-TC1: permission modes include auto entry", () => {
    const autoMode = PERMISSION_MODES.find((m) => m.id === "auto");
    expect(autoMode).toBeDefined();
    expect(autoMode?.title.length).toBeGreaterThan(0);
    expect(autoMode?.desc.length).toBeGreaterThan(0);
  });

  test("C3a-TC2: tapping auto updates radio and sends set_permission_mode", () => {
    const tapMock = mock(() => {});
    const setPermissionModeMock = mock(() => {});
    hapticService.tap = tapMock;
    wsService.setPermissionMode = setPermissionModeMock as typeof wsService.setPermissionMode;

    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);
    const autoTitle = getByText("Auto");

    fireEvent.click(autoTitle.closest(".lin-settings-row") as HTMLElement);

    expect(tapMock).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().permissionMode).toBe("auto");
    expect(setPermissionModeMock).toHaveBeenCalledWith("auto");

    const autoRow = autoTitle.closest(".lin-settings-row");
    expect(autoRow?.querySelector(".lin-radio.is-selected")).not.toBeNull();
  });

  test("opens env var sheet from workspace environment row", () => {
    const { getByText, getByPlaceholderText } = render(<SettingsScreen onNavigate={() => {}} />);

    fireEvent.click(getByText("Environment"));

    expect(getByPlaceholderText("Key")).not.toBeNull();
    expect(getByPlaceholderText("Value")).not.toBeNull();
  });
});
