import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import SettingsScreen from "./SettingsScreen";

/**
 * The settings screen after cc-mobile stopped deciding an agent's settings.
 *
 * What is left divides cleanly: client-side preferences it genuinely owns
 * (notifications, haptics, default folder) and read-backs of what the agent
 * reports. Nothing here sets anything on the agent, so the assertions below are
 * mostly about what is NOT offered.
 */
describe("SettingsScreen", () => {
  beforeEach(() => {
    useAppStore.setState({ capabilities: null });
    useSettingsStore.setState({
      defaultCwd: "/tmp/project",
      notificationsEnabled: true,
      hapticsEnabled: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("offers no permission mode at all — there is none to show", () => {
    const { queryByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(queryByText("PERMISSION MODE")).toBeNull();
    // The old vocabulary went with the control that used it.
    expect(queryByText("Bypass All")).toBeNull();
    expect(queryByText("Accept Edits")).toBeNull();
    expect(queryByText("Auto")).toBeNull();
  });

  test("shows the model the agent reports, as a static row", () => {
    useAppStore.setState({
      capabilities: { commands: [], agents: [], model: "claude-sonnet-4" },
    });

    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);

    const row = getByText("Model").closest(".lin-settings-row");
    expect(row).not.toBeNull();
    // Static: no sheet to open, nothing to pick, nothing sent.
    expect(row?.classList.contains("is-static")).toBe(true);
    expect(row?.tagName).not.toBe("BUTTON");
    expect(getByText("claude-sonnet-4")).not.toBeNull();
  });

  test("an agent that reports no model reads as unknown rather than as a default", () => {
    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(getByText("Model")).not.toBeNull();
    expect(getByText("—")).not.toBeNull();
  });

  test("offers no environment editor — nothing received what it wrote", () => {
    const { queryByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(queryByText("Environment")).toBeNull();
  });

  test("still owns the preferences that are genuinely the client's", () => {
    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);

    expect(getByText("Notifications")).not.toBeNull();
    expect(getByText("Haptics")).not.toBeNull();
    expect(getByText("/tmp/project")).not.toBeNull();
  });
});
