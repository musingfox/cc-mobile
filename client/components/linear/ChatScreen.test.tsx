import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { type SessionCapabilitiesState, useAppStore } from "../../stores/app-store";
import ChatScreen from "./ChatScreen";

describe("ChatScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      inputDraft: "",
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders user and assistant messages with their role labels", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.addMessage("s1", { id: "m1", role: "user", content: "hi", timestamp: 0 });
    store.addMessage("s1", { id: "m2", role: "assistant", content: "hello", timestamp: 1 });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(getByText("YOU")).not.toBeNull();
    expect(getByText("CLAUDE")).not.toBeNull();
    expect(container.querySelector(".lin-msg--user .lin-msg-label")?.textContent).toBe("YOU");
  });

  test("renders user messages as right-aligned bubbles", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.addMessage("s1", { id: "m1", role: "user", content: "hi", timestamp: 0 });

    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const userBubble = container.querySelector(".lin-msg--user");
    expect(userBubble).not.toBeNull();

    const css = readFileSync("client/components/linear/chat.css", "utf-8");
    expect(css.includes(".lin-msg--user {")).toBe(true);
    expect(css.includes("align-self: flex-end;")).toBe(true);
    expect(css.includes("background: #1f1f23;")).toBe(true);
    expect(css.includes("border-radius: 14px;")).toBe(true);
  });

  test("terminal session shows the starting indicator until it is ready", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project", { ready: false });
    store.setActiveSession("s1");

    const { getByText, queryByText, rerender } = render(<ChatScreen onNavigate={() => {}} />);
    expect(getByText("Starting session…")).not.toBeNull();
    expect(queryByText("Type a message to start.")).toBeNull();

    useAppStore.getState().setTerminalReady("s1", true);
    rerender(<ChatScreen onNavigate={() => {}} />);

    expect(queryByText("Starting session…")).toBeNull();
    expect(getByText("Type a message to start.")).not.toBeNull();
  });

  test("slash button opens picker with commands", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setSessionCapabilities("s1", {
      status: "ready",
      commands: [{ name: "clear", description: "Clear chat" }],
      agents: [],
    });

    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));

    expect(getByText("clear")).not.toBeNull();
    expect(getByText("Clear chat")).not.toBeNull();
  });

  test("selecting a command inserts literal into composer and closes picker", async () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setSessionCapabilities("s1", {
      status: "ready",
      commands: [{ name: "clear", description: "Clear chat" }],
      agents: [],
    });

    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    fireEvent.click(getByText("clear"));

    await waitFor(() => {
      expect(useAppStore.getState().inputDraft).toContain("/clear");
    });

    await waitFor(
      () => {
        expect(queryByText("Clear chat")).toBeNull();
      },
      // vaul's drawer close resolves only after its transition fallback
      // (~5.1s under happy-dom), which overruns bun's 5s default timeout.
      { timeout: 8000 },
    );
  }, 15000);

  test("shows thinking card when streaming starts before streamed content exists", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card).not.toBeNull();
    expect(card?.classList.contains("lin-thinking--waiting")).toBe(false);
    expect(getByText("Thinking")).not.toBeNull();
  });

  test("thinking card still shows from isStreaming when assistant text is already on screen", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);
    store.addMessage("s1", { id: "m1", role: "assistant", content: "Hello", timestamp: 1 });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card).not.toBeNull();
    expect(getByText("Thinking")).not.toBeNull();
  });

  test("shows waiting card when pending permission exists", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setPermission("s1", {
      requestId: "p1",
      tool: { name: "Bash", parameters: {} },
    });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("waiting permission state overrides streaming state", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);
    store.addMessage("s1", { id: "m1", role: "assistant", content: "Hello", timestamp: 1 });
    store.setPermission("s1", {
      requestId: "p1",
      tool: { name: "Bash", parameters: {} },
    });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const cards = container.querySelectorAll(".lin-thinking");

    expect(cards.length).toBe(1);
    expect(cards[0]?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("hides thinking card when not streaming and no permission is pending", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.addMessage("s1", { id: "m1", role: "assistant", content: "done", timestamp: 1 });

    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    expect(container.querySelector(".lin-thinking")).toBeNull();
  });
});


describe("CapabilityRequestIssuedOnPickerOpen", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    const internal = wsService as unknown as { ws: WebSocket | null };
    prevWs = internal.ws;
    internal.ws = { send: mock((_data: string) => {}) } as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });

  afterEach(() => {
    (wsService as unknown as { ws: WebSocket | null }).ws = prevWs;
    cleanup();
  });

  test("T9: opening the slash sheet sends one capabilities_request", () => {
    const store = useAppStore.getState();
    store.addSession("w1:p1", "/tmp/project");
    store.setActiveSession("w1:p1");
    const { getByLabelText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    const send = (wsService as unknown as { ws: { send: ReturnType<typeof mock> } }).ws.send;
    const frames = send.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(frames).toEqual([{ type: "capabilities_request", sessionId: "w1:p1" }]);
  });
});


describe("PickerSheetTerminates", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    const internal = wsService as unknown as { ws: WebSocket | null };
    prevWs = internal.ws;
    internal.ws = { send: mock((_data: string) => {}) } as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });

  afterEach(() => {
    (wsService as unknown as { ws: WebSocket | null }).ws = prevWs;
    cleanup();
  });

  function seed(cap: SessionCapabilitiesState | undefined) {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/cc-mobile");
    store.setActiveSession("s1");
    if (cap) store.setSessionCapabilities("s1", cap);
  }

  test("T1: loading slash sheet shows Loading…", () => {
    seed({ status: "loading", sentAt: 1 });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("Loading…")).not.toBeNull();
    expect(queryByText("No commands available.")).toBeNull();
  });

  test("T2: ready commands render name and description, not Loading…", () => {
    seed({ status: "ready", commands: [{ name: "help", description: "H" }], agents: [] });
    const { getByLabelText, getByText, queryByText } = render(
      <ChatScreen onNavigate={() => {}} />,
    );
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("help")).not.toBeNull();
    expect(getByText("H")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T3: ready with no agents shows No agents available", () => {
    seed({ status: "ready", commands: [{ name: "help", description: "H" }], agents: [] });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert agent mention"));
    expect(getByText("No agents available.")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T4: empty ready slash shows No commands available", () => {
    seed({ status: "ready", commands: [], agents: [] });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("No commands available.")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T5: unsupported slash shows the empty command copy", () => {
    seed({ status: "unavailable", reason: "unsupported" });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("No commands available.")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T6: failed agent sheet shows the empty agent copy", () => {
    seed({ status: "unavailable", reason: "failed" });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert agent mention"));
    expect(getByText("No agents available.")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T7: a bare command has no description row", () => {
    seed({ status: "ready", commands: [{ name: "bare" }], agents: [] });
    const { getByLabelText, getByText, container } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("bare")).not.toBeNull();
    expect(container.querySelector(".lin-settings-row-desc")).toBeNull();
  });

  test("T8: a disconnected socket opens to the empty command copy", () => {
    (wsService as unknown as { ws: WebSocket | null }).ws = null;
    seed(undefined);
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("No commands available.")).not.toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });

  test("T9: selecting help inserts /help", async () => {
    seed({ status: "ready", commands: [{ name: "help", description: "H" }], agents: [] });
    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    fireEvent.click(getByText("help"));
    await waitFor(() => {
      expect(useAppStore.getState().inputDraft).toContain("/help");
    });
  });
});


describe("ChatHeaderModelLabelRemoved", () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });
  afterEach(() => {
    cleanup();
  });

  test("T1: no model element", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/cc-mobile");
    store.setActiveSession("s1");
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    expect(container.querySelector(".lin-chat-model")).toBeNull();
  });

  test("T2: basename and context chip remain", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/cc-mobile");
    store.setActiveSession("s1");
    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(getByText("cc-mobile")).not.toBeNull();
    expect(container.querySelector(".lin-context-usage-chip")).not.toBeNull();
  });

  test("T3: header does not say claude when the descriptor has no agent", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const header = container.querySelector(".lin-chat-bar");
    expect(header?.textContent?.toLowerCase().includes("claude")).toBe(false);
  });
});


describe("RateLimitChipRemoved", () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });

  afterEach(() => {
    cleanup();
  });

  test("T1: the chip is gone from ChatScreen", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    expect(container.querySelector('[data-testid="rate-limit-chip"]')).toBeNull();
  });

  test("T2: store has no rateLimitInfo", () => {
    expect("rateLimitInfo" in useAppStore.getState()).toBe(false);
  });

  test("T3: store has no setRateLimitInfo", () => {
    expect("setRateLimitInfo" in useAppStore.getState()).toBe(false);
  });
});

describe("PickerSheetUnavailableRetry", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    const internal = wsService as unknown as { ws: WebSocket | null };
    prevWs = internal.ws;
    internal.ws = { send: mock((_data: string) => {}) } as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });

  afterEach(() => {
    (wsService as unknown as { ws: WebSocket | null }).ws = prevWs;
    cleanup();
  });

  function seed(cap: SessionCapabilitiesState) {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/cc-mobile");
    store.setActiveSession("s1");
    store.setSessionCapabilities("s1", cap);
  }

  function frames() {
    const send = (wsService as unknown as { ws: { send: ReturnType<typeof mock> } }).ws.send;
    return send.mock.calls.map((call) => JSON.parse(call[0] as string));
  }

  test("T1: a failed probe leaves a retry the user can press, and it re-probes", () => {
    seed({ status: "unavailable", reason: "failed" });
    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    fireEvent.click(getByText("Retry"));
    expect(frames()).toEqual([{ type: "capabilities_request", sessionId: "s1", refresh: true }]);
  });

  test("T2: unsupported gets the same retry — kind detection is snapshot-time", () => {
    seed({ status: "unavailable", reason: "unsupported" });
    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert agent mention"));
    fireEvent.click(getByText("Retry"));
    expect(frames()).toEqual([{ type: "capabilities_request", sessionId: "s1", refresh: true }]);
  });

  test("T3: an answered empty list is not a failure, so it offers no retry", () => {
    seed({ status: "ready", commands: [], agents: [] });
    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    expect(getByText("No commands available.")).not.toBeNull();
    expect(queryByText("Retry")).toBeNull();
  });

  test("T4: pressing retry puts the sheet back into Loading…", async () => {
    seed({ status: "unavailable", reason: "failed" });
    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    fireEvent.click(getByText("Retry"));
    await waitFor(() => {
      expect(getByText("Loading…")).not.toBeNull();
    });
  });
});
