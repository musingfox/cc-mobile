import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import PermissionModeSheet from "./PermissionModeSheet";

describe("PermissionModeSheet", () => {
  const originalTap = hapticService.tap;
  const originalSetPermissionMode = wsService.setPermissionMode;

  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useSettingsStore.setState({ permissionMode: "default" });
  });

  afterEach(() => {
    hapticService.tap = originalTap;
    wsService.setPermissionMode = originalSetPermissionMode;
    cleanup();
  });

  test("tapping a row calls wsService.setPermissionMode with (mode, sessionId) and updates session store", () => {
    const tapMock = mock(() => {});
    const setPermissionModeMock = mock(() => {});
    hapticService.tap = tapMock;
    wsService.setPermissionMode = setPermissionModeMock as typeof wsService.setPermissionMode;

    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");

    const onClose = mock(() => {});
    const { getByText } = render(
      <PermissionModeSheet open onClose={onClose} sessionId="s1" />,
    );

    fireEvent.click(getByText("Accept Edits"));

    expect(tapMock).toHaveBeenCalledTimes(1);
    expect(setPermissionModeMock).toHaveBeenCalledTimes(1);
    expect(setPermissionModeMock).toHaveBeenCalledWith("acceptEdits", "s1");
    expect(useAppStore.getState().sessions.get("s1")?.permissionMode).toBe("acceptEdits");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not write to global settings store when picking a session-scoped mode", () => {
    wsService.setPermissionMode = mock(() => {}) as typeof wsService.setPermissionMode;

    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");

    const { getByText } = render(
      <PermissionModeSheet open onClose={() => {}} sessionId="s1" />,
    );
    fireEvent.click(getByText("Plan"));

    expect(useSettingsStore.getState().permissionMode).toBe("default");
    expect(useAppStore.getState().sessions.get("s1")?.permissionMode).toBe("plan");
  });

  test("pre-selects current effective mode (override wins over global)", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setSessionPermissionMode("s1", "plan");
    useSettingsStore.setState({ permissionMode: "acceptEdits" });

    const { getByText } = render(
      <PermissionModeSheet open onClose={() => {}} sessionId="s1" />,
    );

    const planRow = getByText("Plan").closest(".lin-settings-row");
    const acceptRow = getByText("Accept Edits").closest(".lin-settings-row");
    expect(planRow?.querySelector(".lin-radio.is-selected")).not.toBeNull();
    expect(acceptRow?.querySelector(".lin-radio.is-selected")).toBeNull();
  });
});
