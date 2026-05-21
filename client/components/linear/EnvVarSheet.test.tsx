import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useSettingsStore } from "../../stores/settings-store";
import EnvVarSheet from "./EnvVarSheet";

describe("EnvVarSheet", () => {
  const originalSetEnvVars = wsService.setEnvVars;

  beforeEach(() => {
    useSettingsStore.setState({
      envVars: {},
      model: "claude-sonnet-4",
      defaultCwd: "/tmp/project",
      theme: "dark",
      notificationsEnabled: true,
      hapticsEnabled: true,
      permissionMode: "default",
      effort: null,
    });
  });

  afterEach(() => {
    wsService.setEnvVars = originalSetEnvVars;
    cleanup();
  });

  test("shows existing env vars with delete action", () => {
    useSettingsStore.setState({ envVars: { FOO: "bar" } });

    const { getByText, getByLabelText } = render(<EnvVarSheet open onClose={() => {}} />);

    expect(getByText("FOO")).not.toBeNull();
    expect(getByText("bar")).not.toBeNull();
    expect(getByLabelText("Delete FOO")).not.toBeNull();
  });

  test("adds valid env var, syncs ws, clears form", () => {
    const setEnvVarsMock = mock(() => {});
    wsService.setEnvVars = setEnvVarsMock as typeof wsService.setEnvVars;

    const { getByPlaceholderText, getByLabelText } = render(<EnvVarSheet open onClose={() => {}} />);

    fireEvent.change(getByPlaceholderText("Key"), { target: { value: "MY_VAR" } });
    fireEvent.change(getByPlaceholderText("Value"), { target: { value: "42" } });
    fireEvent.click(getByLabelText("Add"));

    expect(useSettingsStore.getState().envVars).toEqual({ MY_VAR: "42" });
    expect(setEnvVarsMock).toHaveBeenCalledWith({ MY_VAR: "42" });
    expect((getByPlaceholderText("Key") as HTMLInputElement).value).toBe("");
    expect((getByPlaceholderText("Value") as HTMLInputElement).value).toBe("");
  });

  test("blocks invalid env key with inline error", () => {
    const setEnvVarsMock = mock(() => {});
    wsService.setEnvVars = setEnvVarsMock as typeof wsService.setEnvVars;

    const { getByPlaceholderText, getByLabelText, getByText } = render(
      <EnvVarSheet open onClose={() => {}} />,
    );

    fireEvent.change(getByPlaceholderText("Key"), { target: { value: "MY VAR" } });
    fireEvent.change(getByPlaceholderText("Value"), { target: { value: "x" } });
    fireEvent.click(getByLabelText("Add"));

    expect(getByText("Key cannot contain whitespace")).not.toBeNull();
    expect(useSettingsStore.getState().envVars).toEqual({});
    expect(setEnvVarsMock).toHaveBeenCalledTimes(0);
  });

  test("deletes env var and syncs ws", () => {
    const setEnvVarsMock = mock(() => {});
    wsService.setEnvVars = setEnvVarsMock as typeof wsService.setEnvVars;
    useSettingsStore.setState({ envVars: { FOO: "bar" } });

    const { getByLabelText } = render(<EnvVarSheet open onClose={() => {}} />);
    fireEvent.click(getByLabelText("Delete FOO"));

    expect(useSettingsStore.getState().envVars).toEqual({});
    expect(setEnvVarsMock).toHaveBeenCalledWith({});
  });
});
