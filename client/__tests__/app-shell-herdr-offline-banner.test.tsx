import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import AppShell from "../components/linear/AppShell";
import { type HerdrStatus, useAppStore } from "../stores/app-store";

const banner = (c: HTMLElement) => c.querySelector(".lin-herdr-offline-banner");

function renderWith(herdrStatus: HerdrStatus | null, connectionState = "connected") {
  useAppStore.setState({ herdrStatus, connectionState: connectionState as "connected" });
  return render(<AppShell />).container;
}

describe("AppShell herdr offline banner", () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, herdrStatus: null });
  });
  afterEach(() => {
    cleanup();
    useAppStore.setState({ herdrStatus: null, connectionState: "connecting" });
  });

  test("T1 hangar offline", () => {
    const c = renderWith({ cockpit: { online: true }, hangar: { name: "fleet", online: false } });
    expect(banner(c)?.textContent).toBe("Hangar offline");
    expect(banner(c)?.getAttribute("role")).toBe("status");
  });

  test("T2 cockpit offline", () => {
    const c = renderWith({ cockpit: { online: false }, hangar: { name: "fleet", online: true } });
    expect(banner(c)?.textContent).toBe("Cockpit offline");
  });

  test("T3 both offline", () => {
    const c = renderWith({ cockpit: { online: false }, hangar: { name: "fleet", online: false } });
    expect(banner(c)?.textContent).toBe("Cockpit and hangar offline");
  });

  test("T4 no hangar configured", () => {
    const c = renderWith({ cockpit: { online: false } });
    expect(banner(c)?.textContent).toBe("herdr offline");
  });

  test("T5 both online shows nothing", () => {
    const c = renderWith({ cockpit: { online: true }, hangar: { name: "fleet", online: true } });
    expect(banner(c)).toBeNull();
  });

  test("T6 no status while connecting shows nothing", () => {
    expect(banner(renderWith(null, "connecting"))).toBeNull();
  });

  test("T7 a lost connection shows only the connection banner", () => {
    const c = renderWith(
      { cockpit: { online: true }, hangar: { name: "fleet", online: false } },
      "disconnected",
    );
    expect(c.querySelector(".lin-connection-banner")).toBeTruthy();
    expect(banner(c)).toBeNull();
  });
});
