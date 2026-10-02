import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import AppShell from "../components/linear/AppShell";
import { readStack } from "../components/linear/screen-history";
import { swUpdater } from "../services/sw-update";
import { useAppStore } from "../stores/app-store";

function screens() {
  return readStack(window.history.state)?.map((e) => e.screen);
}

describe("AppShell browser history", () => {
  beforeEach(() => {
    window.history.replaceState(null, "");
    useAppStore.setState({
      connectionState: "connected",
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "");
  });

  test("a cold start on the root seeds a single root entry", () => {
    render(<AppShell />);
    expect(screens()).toEqual(["projects"]);
  });

  test("a cold start in chat puts the root entry under it", () => {
    useAppStore.setState({ activeSessionId: "pane-1" });
    const before = window.history.length;
    render(<AppShell />);
    expect(screens()).toEqual(["projects", "chat"]);
    expect(window.history.length).toBe(before + 1);
  });

  test("opening a screen pushes an entry, and the browser's back returns to the root", async () => {
    const { container, getByLabelText } = render(<AppShell />);
    fireEvent.click(getByLabelText("Add project"));
    expect(screens()).toEqual(["projects", "addProject"]);
    expect(title(container)).toBe("Add Project");

    act(() => window.history.back());
    await waitFor(() => expect(title(container)).toBe("Projects"));
    expect(screens()).toEqual(["projects"]);
  });

  test("the in-app Back steps back over the entry instead of pushing another", async () => {
    const { container, getByLabelText } = render(<AppShell />);
    const before = window.history.length;
    fireEvent.click(getByLabelText("Add project"));
    fireEvent.click(getByLabelText("Cancel"));
    await waitFor(() => expect(title(container)).toBe("Projects"));
    expect(screens()).toEqual(["projects"]);
    expect(window.history.length).toBe(before + 1);
  });

  test("every screen change, pushed or popped, is offered to the service-worker updater", async () => {
    const safeMoment = spyOn(swUpdater, "atSafeMoment");
    try {
      const { container, getByLabelText } = render(<AppShell />);
      expect(safeMoment).not.toHaveBeenCalled();
      fireEvent.click(getByLabelText("Add project"));
      expect(safeMoment).toHaveBeenCalledTimes(1);
      act(() => window.history.back());
      await waitFor(() => expect(title(container)).toBe("Projects"));
      expect(safeMoment).toHaveBeenCalledTimes(2);
    } finally {
      safeMoment.mockRestore();
    }
  });
});

function title(container: HTMLElement) {
  return container.querySelector(".lin-projects-title")?.textContent;
}
