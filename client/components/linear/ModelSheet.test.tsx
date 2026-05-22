import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import ModelSheet from "./ModelSheet";

describe("ModelSheet", () => {
  const originalTap = hapticService.tap;
  const originalSetModel = wsService.setModel;

  beforeEach(() => {
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
    useSettingsStore.setState({ model: "claude-sonnet-4" });
  });

  afterEach(() => {
    hapticService.tap = originalTap;
    wsService.setModel = originalSetModel;
    cleanup();
  });

  test("renders all models with current one selected", () => {
    const { getByText } = render(<ModelSheet open={true} onClose={() => {}} />);

    const sonnetTitle = getByText("Sonnet 4");
    const opusTitle = getByText("Opus 4");
    const sonnetRow = sonnetTitle.closest(".lin-settings-row");
    const opusRow = opusTitle.closest(".lin-settings-row");

    expect(sonnetRow?.querySelector(".lin-radio.is-selected")).not.toBeNull();
    expect(opusRow?.querySelector(".lin-radio.is-selected")).toBeNull();
  });

  test("clicking a model updates store, notifies server, and closes sheet", () => {
    const tapMock = mock(() => {});
    const setModelMock = mock(() => {});
    const onCloseMock = mock(() => {});
    hapticService.tap = tapMock;
    wsService.setModel = setModelMock as typeof wsService.setModel;

    const { getByText } = render(<ModelSheet open={true} onClose={onCloseMock} />);
    fireEvent.click(getByText("Opus 4"));

    expect(tapMock).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().model).toBe("claude-opus-4");
    expect(setModelMock).toHaveBeenCalledWith("claude-opus-4");
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
});
