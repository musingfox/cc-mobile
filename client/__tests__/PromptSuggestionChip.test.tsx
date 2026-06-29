import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import PromptSuggestionChip from "../components/linear/PromptSuggestionChip";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as { ws: WebSocket | null };
}

function setSuggestion(sessionId: string, suggestion: string | null) {
  useAppStore.getState().setPromptSuggestion(sessionId, suggestion);
}

function resetStore() {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    inputDraft: "",
  });
  useAppStore.getState().addSession("s1", "/cwd");
}

describe("PromptSuggestionChip", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      inputDraft: "",
    });
  });

  test("non-null suggestion → chip rendered with text and is tappable", () => {
    setSuggestion("s1", "try compacting the older messages");
    const { getByTestId } = render(<PromptSuggestionChip sessionId="s1" />);
    const chip = getByTestId("prompt-suggestion-chip");
    expect(chip).not.toBeNull();
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.textContent ?? "").toContain("try compacting the older messages");
  });

  test("tap → inputDraft set to suggestion, promptSuggestion cleared", () => {
    setSuggestion("s1", "try compacting");
    const { getByTestId } = render(<PromptSuggestionChip sessionId="s1" />);
    fireEvent.click(getByTestId("prompt-suggestion-chip"));

    expect(useAppStore.getState().inputDraft).toBe("try compacting");
    expect(useAppStore.getState().sessions.get("s1")?.promptSuggestion).toBeNull();
  });

  test("null suggestion → chip not in DOM", () => {
    setSuggestion("s1", null);
    const { container } = render(<PromptSuggestionChip sessionId="s1" />);
    expect(container.querySelector('[data-testid="prompt-suggestion-chip"]')).toBeNull();
  });

  test("empty-string suggestion → treated as null, chip absent", () => {
    setSuggestion("s1", "");
    const { container } = render(<PromptSuggestionChip sessionId="s1" />);
    expect(container.querySelector('[data-testid="prompt-suggestion-chip"]')).toBeNull();
  });

  test("long suggestion is truncated visually but full text preserved in title attr", () => {
    const long =
      "this is a very long suggestion that should be truncated because it exceeds the eighty character limit";
    setSuggestion("s1", long);
    const { getByTestId } = render(<PromptSuggestionChip sessionId="s1" />);
    const chip = getByTestId("prompt-suggestion-chip");
    expect(chip.getAttribute("title")).toBe(long);
    // Visible text contains an ellipsis
    expect(chip.textContent ?? "").toContain("…");
  });
});

describe("wsService.send clears promptSuggestion (D4)", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    resetStore();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      inputDraft: "",
    });
  });

  test("calling wsService.send when promptSuggestion is set → promptSuggestion is null after", () => {
    setSuggestion("s1", "try this");
    expect(useAppStore.getState().sessions.get("s1")?.promptSuggestion).toBe("try this");

    wsService.send("s1", "user message");

    expect(useAppStore.getState().sessions.get("s1")?.promptSuggestion).toBeNull();
  });

  test("calling wsService.sendCommand also clears promptSuggestion", () => {
    setSuggestion("s1", "try a command");
    wsService.sendCommand("s1", "/help");
    expect(useAppStore.getState().sessions.get("s1")?.promptSuggestion).toBeNull();
  });
});
