/**
 * ChatScreen-history.test.tsx — the history affordance as the reader meets it:
 * HistoryAffordanceFollowsReadable, LoadMoreOlderPage, ScrollAnchorOnPrepend,
 * and the rendering half of SessionOpenNewestPage.
 *
 * `wsService.requestTranscriptPage` is stubbed so a test can count requests,
 * and the scroller's layout is stubbed too — happy-dom lays nothing out, so
 * `scrollHeight` has to be supplied for anchoring to mean anything.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import type { Message, TranscriptCursor } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import ChatScreen from "./ChatScreen";

const CURSOR: TranscriptCursor = { epoch: "aaaa", seq: 400, recordId: "u9" };

let requests: Array<{ sessionId: string; before?: TranscriptCursor | null }> = [];
let originalRequest: typeof wsService.requestTranscriptPage;

/** Gives the scroller a layout happy-dom will not invent on its own. */
function stubScroller(
  container: HTMLElement,
  scrollHeight: number,
  scrollTop = 0,
  clientHeight = 0,
) {
  const el = container.querySelector(".lin-chat-scroll") as HTMLElement;
  if (!el) throw new Error("no scroller");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

function record(recordId: string, seq: number): Message {
  return { id: `id-${recordId}`, role: "assistant", content: recordId, timestamp: 0, recordId, seq };
}

function openSession(options: {
  readable?: boolean | undefined;
  messages?: Message[];
  pagingCursor?: TranscriptCursor | null;
  inFlight?: boolean;
}) {
  const store = useAppStore.getState();
  store.addSession("s1", "/tmp/project");
  store.setActiveSession("s1");
  for (const message of options.messages ?? []) store.addMessage("s1", message);
  useAppStore.setState((state) => {
    const sessions = new Map(state.sessions);
    const session = sessions.get("s1");
    if (!session) return state;
    sessions.set("s1", {
      ...session,
      ...(options.readable === undefined
        ? {}
        : {
            descriptor: {
              agent: "claude",
              origin: "self",
              drivable: true,
              readable: options.readable,
              gated: false,
            },
          }),
      pagingCursor: options.pagingCursor ?? null,
      transcriptPageRequest: options.inFlight ? { sentAt: Date.now() } : null,
    });
    return { sessions };
  });
}

beforeEach(() => {
  requests = [];
  originalRequest = wsService.requestTranscriptPage;
  wsService.requestTranscriptPage = mock((sessionId: string, before?: TranscriptCursor | null) => {
    requests.push({ sessionId, ...(before === undefined ? {} : { before }) });
    return true;
  }) as typeof wsService.requestTranscriptPage;
  useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
});

afterEach(() => {
  wsService.requestTranscriptPage = originalRequest;
  cleanup();
});

describe("HistoryAffordanceFollowsReadable", () => {
  test("T1: an unreadable session offers no affordance and issues no request, even at the top", () => {
    openSession({ readable: false, messages: [record("a", 10)], pagingCursor: CURSOR });
    const { container, queryByText } = render(<ChatScreen onNavigate={() => {}} />);

    expect(queryByText("Load earlier messages")).toBeNull();

    // The gesture that would fetch, on a session that must never fetch.
    const scroller = stubScroller(container, 1000, 0);
    fireEvent.scroll(scroller);

    expect(requests).toHaveLength(0);
  });

  test("T2: a session that becomes readable gains the affordance without being reopened", () => {
    openSession({ readable: false, messages: [record("a", 10)], pagingCursor: CURSOR });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Load earlier messages")).toBeNull();

    // What a later terminal_sessions listing does to the session.
    act(() => {
      useAppStore.setState((state) => {
        const sessions = new Map(state.sessions);
        const session = sessions.get("s1");
        if (!session?.descriptor) return state;
        sessions.set("s1", { ...session, descriptor: { ...session.descriptor, readable: true } });
        return { sessions };
      });
    });

    expect(queryByText("Load earlier messages")).not.toBeNull();
  });

  test("T3: a session with no descriptor at all offers no affordance", () => {
    openSession({ messages: [record("a", 10)], pagingCursor: CURSOR });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Load earlier messages")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("T4: an unreadable session with no messages keeps the existing empty state", () => {
    openSession({ readable: false });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Type a message to start.")).not.toBeNull();
  });

  test("T5: an agent exiting takes the affordance away and leaves the messages", () => {
    openSession({ readable: true, messages: [record("a", 10), record("b", 20)], pagingCursor: CURSOR });
    const { queryByText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Load earlier messages")).not.toBeNull();

    act(() => {
      useAppStore.setState((state) => {
        const sessions = new Map(state.sessions);
        const session = sessions.get("s1");
        if (!session?.descriptor) return state;
        sessions.set("s1", { ...session, descriptor: { ...session.descriptor, readable: false } });
        return { sessions };
      });
    });

    expect(queryByText("Load earlier messages")).toBeNull();
    expect(getByText("a")).not.toBeNull();
    expect(getByText("b")).not.toBeNull();
  });
});

describe("SessionOpenNewestPage — the rendering side", () => {
  test("T1: activating a readable session sends exactly one request, with no cursor", () => {
    openSession({ readable: true });
    render(<ChatScreen onNavigate={() => {}} />);
    expect(requests).toEqual([{ sessionId: "s1" }]);
  });

  test("T2: a session whose descriptor arrives late fetches then, without being reopened", () => {
    openSession({});
    render(<ChatScreen onNavigate={() => {}} />);
    expect(requests).toHaveLength(0);

    act(() => {
      useAppStore.setState((state) => {
        const sessions = new Map(state.sessions);
        const session = sessions.get("s1");
        if (!session) return state;
        sessions.set("s1", {
          ...session,
          descriptor: {
            agent: "claude",
            origin: "self",
            drivable: true,
            readable: true,
            gated: false,
          },
        });
        return { sessions };
      });
    });

    expect(requests).toEqual([{ sessionId: "s1" }]);
  });

  test("T3: an unreadable session never fetches, not even after a re-render", () => {
    openSession({ readable: false });
    const { rerender } = render(<ChatScreen onNavigate={() => {}} />);
    rerender(<ChatScreen onNavigate={() => {}} />);
    act(() => {
      useAppStore.getState().addMessage("s1", { id: "m", role: "user", content: "x", timestamp: 1 });
    });
    expect(requests).toHaveLength(0);
  });

  test("T6: while the first page is in flight the chat says so, and does not say it is empty", () => {
    openSession({ readable: true, inFlight: true });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Loading conversation…")).not.toBeNull();
    expect(queryByText("Type a message to start.")).toBeNull();
  });

  test("T7: a page with no records and nothing older shows the empty state", () => {
    openSession({ readable: true, pagingCursor: null });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Type a message to start.")).not.toBeNull();
    expect(queryByText("Load earlier messages")).toBeNull();
  });

  test("T8: a transcript_unavailable reply leaves the screen as it was", () => {
    openSession({ readable: true, messages: [record("a", 10)], inFlight: true });
    const { queryByText, getByText, rerender } = render(<ChatScreen onNavigate={() => {}} />);

    act(() => {
      useAppStore.getState().setTranscriptPageRequest("s1", null);
    });
    rerender(<ChatScreen onNavigate={() => {}} />);

    expect(getByText("a")).not.toBeNull();
    expect(queryByText("Loading earlier messages…")).toBeNull();
    // No cursor: nothing claims there is more, and nothing shouts about an error.
    expect(queryByText("Load earlier messages")).toBeNull();
  });
});

describe("LoadMoreOlderPage", () => {
  test("T1: scrolling to the top requests the page before the stored cursor", () => {
    openSession({ readable: true, messages: [record("a", 500)], pagingCursor: CURSOR });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    requests = [];

    const scroller = stubScroller(container, 1000, 0);
    fireEvent.scroll(scroller);

    expect(requests).toEqual([{ sessionId: "s1", before: CURSOR }]);
  });

  test("T2: two scroll-to-top events before the reply issue one request", () => {
    openSession({ readable: true, messages: [record("a", 500)], pagingCursor: CURSOR });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    requests = [];

    const scroller = stubScroller(container, 1000, 0);
    fireEvent.scroll(scroller);
    // What the service's in-flight guard does to the second one.
    act(() => {
      useAppStore.getState().setTranscriptPageRequest("s1", { sentAt: Date.now() });
    });
    fireEvent.scroll(scroller);

    expect(requests).toHaveLength(1);
  });

  test("T3: a page that reached the beginning removes the affordance", () => {
    openSession({ readable: true, messages: [record("a", 10)], pagingCursor: null });
    const { queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Load earlier messages")).toBeNull();
  });

  test("T4: a page with nothing visible in it keeps the affordance and fetches again", () => {
    // 50 tool_result-only records render no bubbles, but the server said
    // something older exists — that must not read as "the beginning".
    openSession({ readable: true, messages: [record("a", 500)], pagingCursor: CURSOR });
    const { container, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    requests = [];

    expect(queryByText("Load earlier messages")).not.toBeNull();
    const scroller = stubScroller(container, 1000, 0);
    fireEvent.scroll(scroller);
    expect(requests).toHaveLength(1);
  });

  test("T5: a request in flight shows an inline loading row and suppresses further requests", () => {
    openSession({
      readable: true,
      messages: [record("a", 500)],
      pagingCursor: CURSOR,
      inFlight: true,
    });
    const { container, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    requests = [];

    expect(queryByText("Loading earlier messages…")).not.toBeNull();
    expect(queryByText("Load earlier messages")).toBeNull();

    const scroller = stubScroller(container, 1000, 0);
    fireEvent.scroll(scroller);
    // The point of the contract: reaching the top again while the first request
    // is still out issues nothing.
    expect(requests).toHaveLength(0);
  });

  test("T6: an error reply brings the affordance back in its idle state, messages untouched", () => {
    openSession({
      readable: true,
      messages: [record("a", 500)],
      pagingCursor: CURSOR,
      inFlight: true,
    });
    const { getByText, queryByText, rerender } = render(<ChatScreen onNavigate={() => {}} />);
    expect(queryByText("Loading earlier messages…")).not.toBeNull();

    act(() => {
      useAppStore.getState().setTranscriptPageRequest("s1", null);
    });
    rerender(<ChatScreen onNavigate={() => {}} />);

    expect(queryByText("Load earlier messages")).not.toBeNull();
    expect(getByText("a")).not.toBeNull();
  });
});

describe("ScrollGeometryStub", () => {
  test("T1: a test can state all three numbers the viewport rule reads", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const el = stubScroller(container, 1000, 400, 600);
    expect(el.scrollHeight).toBe(1000);
    expect(el.scrollTop).toBe(400);
    expect(el.clientHeight).toBe(600);
  });

  test("T2: existing two-argument call sites keep their current meaning", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const el = stubScroller(container, 1000);
    expect(el.scrollHeight).toBe(1000);
    expect(el.scrollTop).toBe(0);
    expect(el.clientHeight).toBe(0);
  });
});

describe("ScrollAnchorOnPrepend", () => {
  test("T1: a prepend keeps the reader where they were", () => {
    openSession({ readable: true, messages: [record("tail", 1000)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);

    const scroller = stubScroller(container, 1000, 0);
    // The commit's own bookkeeping ran on mount; re-assert the pre-prepend view.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    Object.defineProperty(scroller, "scrollHeight", { value: 1600, configurable: true });
    act(() => {
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: Array.from({ length: 10 }, (_, i) => record(`old${i}`, i)),
      });
    });

    expect(scroller.scrollTop).toBe(600);
  });

  test("T2: an append at the bottom still scrolls to the bottom", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 400, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("b", 20)],
      });
    });

    expect(scroller.scrollTop).toBe(1200);
  });

  test("T3: a tail message growing in place does not drag a parked reader down", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 0, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1400, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [{ ...record("a", 10), content: "a much longer streamed body" }],
      });
    });

    expect(scroller.scrollTop).toBe(0);
  });

  test("T4: an epoch reset is not a prepend — the view goes to the bottom", () => {
    openSession({ readable: true, messages: [record("old1", 10), record("old2", 20)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    act(() => {
      useAppStore.getState().applyTranscriptMessages("s1", { epoch: "aaaa", messages: [] });
    });

    const scroller = stubScroller(container, 1000, 0);
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    Object.defineProperty(scroller, "scrollHeight", { value: 400, configurable: true });
    act(() => {
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "bbbb",
        messages: [record("new1", 0)],
      });
    });

    expect(scroller.scrollTop).toBe(400);
  });

  test("T5: a stay-put append still leaves a later prepend anchored", () => {
    openSession({ readable: true, messages: [record("tail", 1000)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 0, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1100, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("live", 1100)],
      });
    });
    expect(scroller.scrollTop).toBe(0);

    Object.defineProperty(scroller, "scrollHeight", { value: 1700, configurable: true });
    act(() => {
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: Array.from({ length: 10 }, (_, i) => record(`old${i}`, i)),
      });
    });

    expect(scroller.scrollTop).toBe(600);
  });
});

describe("StayPutOnLiveArrival", () => {
  test("T1: a reply while scrolled up leaves the page where the reader left it", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 0, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("b", 20)],
      });
    });

    expect(scroller.scrollTop).toBe(0);
  });

  test("T2: one pixel outside the near-bottom band stays put", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 335, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("b", 20)],
      });
    });

    expect(scroller.scrollTop).toBe(335);
  });

  test("T3: a transcript-borne user record while parked stays put", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 0, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [{ id: "id-u1", role: "user", content: "from terminal", timestamp: 0, recordId: "u1", seq: 30 }],
      });
    });

    expect(scroller.scrollTop).toBe(0);
  });

  test("T4: a reader 64px from the end still follows an append", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 336, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("b", 20)],
      });
    });

    expect(scroller.scrollTop).toBe(1200);
  });

  test("T5: rubber-band overscroll past the end still follows an append", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 408, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
      useAppStore.getState().applyTranscriptMessages("s1", {
        epoch: "aaaa",
        messages: [record("b", 20)],
      });
    });

    expect(scroller.scrollTop).toBe(1200);
  });

  test("T6: streaming growth from the bottom still tracks the answer", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 400, 600);
    fireEvent.scroll(scroller);

    act(() => {
      useAppStore.setState((state) => {
        const sessions = new Map(state.sessions);
        const session = sessions.get("s1");
        if (!session) return state;
        sessions.set("s1", { ...session, currentStreamMessageId: "id-a" });
        return { sessions };
      });
      Object.defineProperty(scroller, "scrollHeight", { value: 1400, configurable: true });
      useAppStore.getState().appendToLastAssistantMessage("s1", " …more tokens");
    });

    expect(scroller.scrollTop).toBe(1400);
  });

  test("T7: sending from the composer jumps to the bottom even when parked", () => {
    openSession({ readable: true, messages: [record("a", 10)] });
    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const scroller = stubScroller(container, 1000, 0, 600);
    fireEvent.scroll(scroller);

    act(() => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1100, configurable: true });
      useAppStore.getState().addMessage("s1", {
        id: "user-1",
        role: "user",
        content: "hi",
        timestamp: Date.now(),
      });
    });

    expect(scroller.scrollTop).toBe(1100);
  });
});
