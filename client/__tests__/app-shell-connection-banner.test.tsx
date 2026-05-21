import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import AppShell from "../components/linear/AppShell";
import { useAppStore } from "../stores/app-store";

describe("AppShell connection banner", () => {
  beforeEach(() => {
    useAppStore.setState({
      connectionState: "connected",
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("shows reconnect banner when disconnected", () => {
    useAppStore.setState({ connectionState: "disconnected" });
    const { container } = render(<AppShell />);
    expect(container.querySelector(".lin-connection-banner")).toBeTruthy();
  });

  test("hides reconnect banner when connected", () => {
    useAppStore.setState({ connectionState: "connected" });
    const { container } = render(<AppShell />);
    expect(container.querySelector(".lin-connection-banner")).toBeNull();
  });

  test("hides reconnect banner while connecting", () => {
    useAppStore.setState({ connectionState: "connecting" });
    const { container } = render(<AppShell />);
    expect(container.querySelector(".lin-connection-banner")).toBeNull();
  });
});
