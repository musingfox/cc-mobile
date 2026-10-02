import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
  };
}

describe("RateLimitChipRemoved stream handler", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = new FakeWebSocket() as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/tmp");
    useAppStore.getState().addMessage("s1", {
      id: "m1",
      role: "user",
      content: "hi",
      timestamp: 0,
    });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("T6: a rate_limit_event chunk does not throw or change messages", () => {
    const before = useAppStore.getState().sessions.get("s1")?.messages;
    expect(() =>
      getInternal().handleMessage({
        type: "stream_chunk",
        sessionId: "s1",
        chunk: { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
      }),
    ).not.toThrow();
    expect(useAppStore.getState().sessions.get("s1")?.messages).toEqual(before);
  });
});

// The server's only chunk producer is transcriptRecordToChunk, which emits
// `user` and `assistant` and nothing else. These are the SDK-era shapes the
// client used to dispatch on; one arriving anyway must leave the session and
// the toasts exactly as they were, not revive a handler for a stream that no
// longer exists.
describe("StreamEventPipelineRemoved: SDK-era chunks are inert", () => {
  const sdkChunks: Array<[string, Record<string, unknown>]> = [
    ["system/init", { type: "system", subtype: "init", session_id: "sdk-1" }],
    [
      "system/session_state_changed",
      { type: "system", subtype: "session_state_changed", state: "running" },
    ],
    [
      "system/hook_started",
      {
        type: "system",
        subtype: "hook_started",
        hook_id: "h1",
        hook_name: "Stop",
        hook_event: "Stop",
      },
    ],
    [
      "system/hook_response",
      {
        type: "system",
        subtype: "hook_response",
        hook_id: "h1",
        hook_name: "Stop",
        hook_event: "Stop",
      },
    ],
    [
      "system/api_retry",
      {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 1000,
        error_status: 529,
      },
    ],
    [
      "system/notification",
      { type: "system", subtype: "notification", key: "k1", text: "hello", priority: "high" },
    ],
    ["prompt_suggestion", { type: "prompt_suggestion", suggestion: "run the tests" }],
    [
      "result",
      {
        type: "result",
        subtype: "error",
        is_error: true,
        total_cost_usd: 0.5,
        usage: { input_tokens: 100_000 },
        terminal_reason: "max_turns",
      },
    ],
    [
      "system/task_started",
      {
        type: "system",
        subtype: "task_started",
        task_id: "t2",
        description: "explore",
        tool_use_id: "tu2",
      },
    ],
    [
      "system/task_progress",
      {
        type: "system",
        subtype: "task_progress",
        task_id: "t1",
        description: "explore",
        last_tool_name: "Read",
        usage: { total_tokens: 10, tool_uses: 1 },
      },
    ],
    [
      "system/task_notification",
      { type: "system", subtype: "task_notification", task_id: "t1", status: "completed" },
    ],
    [
      "system/memory_recall",
      { type: "system", subtype: "memory_recall", uuid: "u1", memories: [{ path: "/m.md" }] },
    ],
    [
      "system/compact_boundary",
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "u2",
        compact_metadata: { trigger: "auto", pre_tokens: 9 },
      },
    ],
    [
      "system/permission_denied",
      {
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
        tool_use_id: "tool-1",
        message: "denied",
      },
    ],
    [
      "stream_event",
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      },
    ],
  ];

  let prevWs: WebSocket | null;
  let infoSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = new FakeWebSocket() as unknown as WebSocket;
    infoSpy = spyOn(toastService, "info").mockImplementation(() => "" as never);
    errorSpy = spyOn(toastService, "error").mockImplementation(() => "" as never);
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/tmp");
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test.each(sdkChunks)("%s leaves the session untouched and raises no toast", (_label, chunk) => {
    const before = useAppStore.getState().sessions.get("s1");
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk });
    expect(useAppStore.getState().sessions.get("s1")).toBe(before);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
