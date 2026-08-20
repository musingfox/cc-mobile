import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
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

  test("T1: retired model copy is gone", () => {
    const { queryByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(queryByText("Whatever the agent is running")).toBeNull();
  });

  test("T2: no Account row", () => {
    const { queryByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(queryByText("Account")).toBeNull();
  });

  test("T3: Default folder remains", () => {
    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(getByText("Default folder")).not.toBeNull();
  });

  test("T4: Haptics remains", () => {
    const { getByText } = render(<SettingsScreen onNavigate={() => {}} />);
    expect(getByText("Haptics")).not.toBeNull();
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
