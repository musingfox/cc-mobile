import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import InputBarA from "../components/linear/InputBarA";
import { loadDraft } from "../services/draft-persistence";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * A half-typed message must outlive the page: iOS evicts a backgrounded PWA,
 * and the service-worker updater reloads it. Each session keeps its own draft.
 */

function freshPage() {
  cleanup();
  useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
}

function composer() {
  const textarea = document.querySelector("textarea");
  if (!textarea) throw new Error("textarea missing");
  return textarea;
}

describe("ComposerDraftSurvivesReload", () => {
  const originalTerminalSend = wsService.terminalSend;

  beforeEach(() => {
    localStorage.clear();
    freshPage();
    wsService.terminalSend = (() => {}) as typeof wsService.terminalSend;
    useAppStore.getState().addSession("p1", "/repo/proj", { ready: true });
  });

  afterEach(() => {
    wsService.terminalSend = originalTerminalSend;
    cleanup();
    localStorage.clear();
  });

  test("typed, reloaded, restored with the session it was typed into", () => {
    render(<InputBarA sessionId="p1" />);
    fireEvent.change(composer(), { target: { value: "half a thought" } });
    useAppStore.getState().persistAllSessions();

    freshPage();
    useAppStore.getState().restoreAllSessions();
    render(<InputBarA sessionId="p1" />);

    expect(composer().value).toBe("half a thought");
  });

  test("reopening a session's chat brings back its own draft, not another's", () => {
    useAppStore.getState().setInputDraft("for p1");
    useAppStore.getState().addSession("p2", "/repo/proj", { ready: true });
    expect(useAppStore.getState().inputDraft).toBe("");
    useAppStore.getState().setInputDraft("for p2");

    freshPage();
    useAppStore.getState().upsertListedSession({
      sessionId: "p1",
      cwd: "/repo/proj",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
    });
    useAppStore.getState().setActiveSession("p1");
    expect(useAppStore.getState().inputDraft).toBe("for p1");
    useAppStore.getState().setActiveSession("p2");
    expect(useAppStore.getState().inputDraft).toBe("for p2");
  });

  test("a sent message is no longer a draft", () => {
    render(<InputBarA sessionId="p1" />);
    fireEvent.change(composer(), { target: { value: "send me" } });
    expect(loadDraft("p1")).toBe("send me");

    fireEvent.click(document.querySelector('[aria-label="Send"]') as HTMLButtonElement);

    expect(loadDraft("p1")).toBe("");
    expect(localStorage.getItem("ccm:draft:p1")).toBeNull();
  });

  test("what was typed while the session started follows it onto the pane id", () => {
    useAppStore.getState().addSession("uuid-1", "/repo/proj", { ready: false });
    useAppStore.getState().setInputDraft("typed early");

    useAppStore.getState().rekeySession("uuid-1", "w1:p9");

    expect(loadDraft("w1:p9")).toBe("typed early");
    expect(localStorage.getItem("ccm:draft:uuid-1")).toBeNull();
  });

  test("a session that is gone takes its draft with it", () => {
    useAppStore.getState().setInputDraft("never sent");

    useAppStore.getState().removeSession("p1");

    expect(localStorage.getItem("ccm:draft:p1")).toBeNull();
  });
});
